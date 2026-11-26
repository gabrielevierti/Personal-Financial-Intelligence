/**
 * Proxy di sola lettura per i dati di mercato (Investment Research).
 *
 * Perché passa dal bridge:
 *  - le chiavi API (Alpha Vantage, Finnhub, Tiingo) restano in bridge/config.json e non arrivano mai al browser;
 *  - SEC EDGAR richiede un User-Agent dichiarato, che il browser non può impostare;
 *  - i limiti di frequenza dei piani gratuiti vengono rispettati qui, in un solo punto.
 *
 * Il bridge non salva nulla: la cache è nel browser (IndexedDB). Nessun dato finanziario personale
 * viene inviato a questi servizi: solo simboli e codici delle aziende cercate.
 */

const AV_FUNCTIONS = new Set(['OVERVIEW', 'INCOME_STATEMENT', 'BALANCE_SHEET', 'CASH_FLOW', 'EARNINGS', 'DIVIDENDS', 'SYMBOL_SEARCH', 'GLOBAL_QUOTE', 'TIME_SERIES_DAILY', 'TIME_SERIES_WEEKLY', 'NEWS_SENTIMENT']);
const FINNHUB_PATHS = new Set(['quote', 'search', 'stock/profile2', 'stock/recommendation', 'stock/metric', 'stock/peers', 'company-news']);
const SYMBOL_RE = /^[A-Za-z0-9.\-^=:]{1,24}$/;

export function researchConfig(file = {}, env = process.env) {
  const r = file.research ?? {};
  return {
    secUserAgent: env.PFI_SEC_USER_AGENT ?? r.secUserAgent ?? '',
    alphaVantageKey: env.ALPHAVANTAGE_KEY ?? r.alphaVantageKey ?? '',
    finnhubKey: env.FINNHUB_KEY ?? r.finnhubKey ?? '',
    tiingoKey: env.TIINGO_KEY ?? r.tiingoKey ?? '',
    secWww: (r.secWww ?? env.PFI_SEC_WWW ?? 'https://www.sec.gov').replace(/\/$/, ''),
    secData: (r.secData ?? env.PFI_SEC_DATA ?? 'https://data.sec.gov').replace(/\/$/, ''),
    avBase: (r.avBase ?? env.PFI_AV_BASE ?? 'https://www.alphavantage.co').replace(/\/$/, ''),
    finnhubBase: (r.finnhubBase ?? env.PFI_FINNHUB_BASE ?? 'https://finnhub.io/api/v1').replace(/\/$/, ''),
    tiingoBase: (r.tiingoBase ?? env.PFI_TIINGO_BASE ?? 'https://api.tiingo.com').replace(/\/$/, ''),
  };
}

/** Limitatore a finestra scorrevole. */
export function rateLimiter(max, windowMs, now = () => Date.now()) {
  const hits = [];
  return {
    take() {
      const t = now();
      while (hits.length && t - hits[0] >= windowMs) hits.shift();
      if (hits.length >= max) return false;
      hits.push(t);
      return true;
    },
    used() {
      const t = now();
      return hits.filter((h) => t - h < windowMs).length;
    },
  };
}

export function createResearch(rc, { fetchImpl = fetch, log = console.log, now = () => Date.now() } = {}) {
  const limits = {
    sec: rateLimiter(8, 1000, now),
    avMinute: rateLimiter(5, 60_000, now),
    avDay: rateLimiter(25, 86_400_000, now),
    finnhub: rateLimiter(55, 60_000, now),
    tiingo: rateLimiter(45, 3_600_000, now),
  };

  const status = () => ({
    providers: {
      sec: { configured: !!rc.secUserAgent, needs: 'secUserAgent (nome ed email, richiesto dalla SEC)', coverage: 'Bilanci delle società quotate USA (10-K, 10-Q, 20-F)' },
      alphavantage: { configured: !!rc.alphaVantageKey, needs: 'alphaVantageKey (gratuita, 25 richieste al giorno)', coverage: 'Profilo, bilanci, quotazioni giornaliere ritardate', usedToday: limits.avDay.used() },
      finnhub: { configured: !!rc.finnhubKey, needs: 'finnhubKey (gratuita, uso personale)', coverage: 'Ricerca anche per ISIN, quotazione, profilo, raccomandazioni degli analisti, notizie' },
      tiingo: { configured: !!rc.tiingoKey, needs: 'tiingoKey (gratuita, registrazione su tiingo.com)', coverage: 'Storico prezzi di fine giornata rettificato per dividendi e frazionamenti' },
    },
  });

  async function upstream(name, url, headers = {}) {
    const r = await fetchImpl(url, { headers });
    const text = await r.text();
    log(`${new Date().toISOString()} research ${name} → ${r.status}`);
    return { status: r.status, text, type: r.headers.get('content-type') ?? '' };
  }

  /** Restituisce { status, body, contentType } oppure null se la rotta non è di ricerca. */
  return async function handle(url) {
    const p = url.pathname;
    if (!p.startsWith('/research/')) return null;
    const q = url.searchParams;
    const bad = (message, status = 400) => ({ status, body: { error: 'BAD_REQUEST', message } });
    const limited = (who) => ({ status: 429, body: { error: 'RATE_LIMIT', message: `Limite di richieste di ${who} raggiunto: riprova più tardi (i dati già scaricati restano in cache).` } });
    const missing = (who, field) => ({ status: 503, body: { error: 'NOT_CONFIGURED', provider: who, message: `${who} non è configurato: aggiungi "${field}" nella sezione "research" di bridge/config.json.` } });

    if (p === '/research/status') return { status: 200, body: status() };

    // ---------------------------------------------------------------- SEC EDGAR
    if (p.startsWith('/research/sec/')) {
      if (!rc.secUserAgent) return missing('SEC EDGAR', 'secUserAgent');
      if (!limits.sec.take()) return limited('SEC EDGAR');
      const h = { 'User-Agent': rc.secUserAgent, Accept: 'application/json' };
      if (p === '/research/sec/tickers') {
        const r = await upstream('sec tickers', `${rc.secWww}/files/company_tickers_exchange.json`, h);
        return { status: r.status, body: r.text };
      }
      const m = p.match(/^\/research\/sec\/(facts|submissions)\/(\d{1,10})$/);
      if (!m) return bad('Rotta SEC non valida');
      const cik = m[2].padStart(10, '0');
      const path = m[1] === 'facts' ? `/api/xbrl/companyfacts/CIK${cik}.json` : `/submissions/CIK${cik}.json`;
      const r = await upstream(`sec ${m[1]}`, `${rc.secData}${path}`, h);
      return { status: r.status, body: r.text };
    }

    // ---------------------------------------------------------------- Alpha Vantage
    if (p.startsWith('/research/av/')) {
      const fn = p.slice('/research/av/'.length).toUpperCase();
      if (!AV_FUNCTIONS.has(fn)) return bad('Funzione Alpha Vantage non consentita');
      if (!rc.alphaVantageKey) return missing('Alpha Vantage', 'alphaVantageKey');
      const params = new URLSearchParams({ function: fn, apikey: rc.alphaVantageKey });
      for (const k of ['symbol', 'keywords', 'tickers', 'outputsize']) {
        const v = q.get(k);
        if (v === null) continue;
        if (k !== 'keywords' && !SYMBOL_RE.test(v) && k !== 'outputsize') return bad(`Parametro ${k} non valido`);
        params.set(k, v.slice(0, 64));
      }
      if (!limits.avMinute.take() || !limits.avDay.take()) return limited('Alpha Vantage (piano gratuito: 5 al minuto, 25 al giorno)');
      const r = await upstream(`av ${fn}`, `${rc.avBase}/query?${params}`);
      // Alpha Vantage segnala i limiti con status 200 e un campo "Note"/"Information"
      try {
        const j = JSON.parse(r.text);
        if (j.Note || j.Information) return { status: 429, body: { error: 'RATE_LIMIT', message: `Alpha Vantage: ${String(j.Note ?? j.Information).slice(0, 240)}` } };
        if (j['Error Message']) return { status: 404, body: { error: 'NOT_FOUND', message: `Alpha Vantage: ${String(j['Error Message']).slice(0, 240)}` } };
      } catch {
        /* non JSON */
      }
      return { status: r.status, body: r.text };
    }

    // ---------------------------------------------------------------- Finnhub
    if (p.startsWith('/research/finnhub/')) {
      const path = p.slice('/research/finnhub/'.length);
      if (!FINNHUB_PATHS.has(path)) return bad('Endpoint Finnhub non consentito');
      if (!rc.finnhubKey) return missing('Finnhub', 'finnhubKey');
      const params = new URLSearchParams();
      for (const k of ['symbol', 'q', 'from', 'to', 'metric']) {
        const v = q.get(k);
        if (v !== null) params.set(k, v.slice(0, 64));
      }
      if (!limits.finnhub.take()) return limited('Finnhub');
      const r = await upstream(`finnhub ${path}`, `${rc.finnhubBase}/${path}?${params}`, { 'X-Finnhub-Token': rc.finnhubKey });
      if (r.status === 403) return { status: 403, body: { error: 'PREMIUM', message: 'Questo dato di Finnhub non è incluso nel piano gratuito.' } };
      return { status: r.status, body: r.text };
    }

    // ---------------------------------------------------------------- Logo (proxy: il browser non contatta domini esterni)
    if (p === '/research/logo') {
      let u;
      try {
        u = new URL(q.get('url') ?? '');
      } catch {
        return bad('URL non valido');
      }
      if (u.protocol !== 'https:' || !/(^|\.)finnhub\.io$/.test(u.hostname)) return bad('Dominio del logo non consentito');
      const r = await fetchImpl(u.toString());
      const type = r.headers.get('content-type') ?? '';
      if (!r.ok || !/^image\/(png|jpeg|svg\+xml|webp|gif)/.test(type)) return { status: 404, body: { error: 'NOT_FOUND', message: 'Logo non disponibile' } };
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 300_000) return { status: 413, body: { error: 'TOO_LARGE', message: 'Logo troppo grande' } };
      return { status: 200, body: { dataUrl: `data:${type.split(';')[0]};base64,${buf.toString('base64')}` } };
    }

    // ---------------------------------------------------------------- Tiingo (storico prezzi di fine giornata)
    if (p === '/research/tiingo/prices') {
      if (!rc.tiingoKey) return missing('Tiingo', 'tiingoKey');
      const sym = q.get('symbol') ?? '';
      const freq = q.get('freq') === 'weekly' ? 'weekly' : 'daily';
      const start = q.get('startDate') ?? '';
      if (!SYMBOL_RE.test(sym) || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return bad('Simbolo o data non validi');
      if (!limits.tiingo.take()) return limited('Tiingo');
      const r = await upstream('tiingo', `${rc.tiingoBase}/tiingo/daily/${encodeURIComponent(sym.toLowerCase())}/prices?startDate=${start}&resampleFreq=${freq}`, { Authorization: `Token ${rc.tiingoKey}`, Accept: 'application/json' });
      if (r.status === 404) return { status: 404, body: { error: 'NOT_FOUND', message: 'Tiingo non ha dati per questo simbolo.' } };
      return { status: r.status, body: r.text };
    }

    return bad('Rotta di ricerca sconosciuta', 404);
  };
}
