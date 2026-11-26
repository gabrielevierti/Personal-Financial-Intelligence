/**
 * Registro dei fornitori con fallback: per ogni dato si prova la fonte migliore, poi le altre.
 * Ogni tentativo viene registrato, così l'interfaccia può dire perché un dato manca.
 */
import { alphaVantage, finnhub, tiingo } from './providers';
import { secProvider } from './sec';
import { ProviderError, type AnalystData, type CompanyProfile, type Filing, type FinancialYear, type NewsItem, type PriceHistory, type Quote, type SearchResult, type Sourced } from './types';

export interface Attempt {
  provider: string;
  what: string;
  ok: boolean;
  message?: string;
}

async function attempt<T>(attempts: Attempt[], provider: string, what: string, fn: () => Promise<T | null>): Promise<T | null> {
  try {
    const v = await fn();
    attempts.push({ provider, what, ok: v !== null && !(Array.isArray(v) && v.length === 0), message: v === null ? 'nessun dato per questo titolo' : undefined });
    return v;
  } catch (e) {
    attempts.push({ provider, what, ok: false, message: e instanceof ProviderError ? e.message : (e as Error).message });
    return null;
  }
}

async function first<T>(attempts: Attempt[], what: string, steps: Array<[string, () => Promise<T | null>]>): Promise<T | null> {
  for (const [p, fn] of steps) {
    const v = await attempt(attempts, p, what, fn);
    if (v !== null && !(Array.isArray(v) && v.length === 0)) return v;
  }
  return null;
}

export const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

export async function searchCompanies(query: string): Promise<{ results: SearchResult[]; attempts: Attempt[] }> {
  const attempts: Attempt[] = [];
  const q = query.trim();
  if (!q) return { results: [], attempts };
  const isin = ISIN_RE.test(q.toUpperCase());
  const lists = await Promise.all([
    isin ? Promise.resolve(null) : attempt(attempts, 'SEC EDGAR', 'ricerca', () => secProvider.searchCompany!(q)),
    attempt(attempts, 'Finnhub', 'ricerca', () => finnhub.searchCompany!(q)),
    isin ? Promise.resolve(null) : attempt(attempts, 'Alpha Vantage', 'ricerca', () => alphaVantage.searchCompany!(q)),
  ]);
  const seen = new Map<string, SearchResult>();
  for (const r of lists.flat()) {
    if (!r) continue;
    const k = r.symbol.toUpperCase();
    const cur = seen.get(k);
    seen.set(k, cur ? { ...r, ...cur, cik: cur.cik ?? r.cik, exchange: cur.exchange ?? r.exchange, isin: cur.isin ?? r.isin } : r);
  }
  return { results: [...seen.values()].slice(0, 25), attempts };
}

export interface CompanyData {
  symbol: string;
  profile: CompanyProfile | null;
  quote: Quote | null;
  ratios: Record<string, Sourced<number>>;
  statements: FinancialYear[];
  analysts: AnalystData;
  filings: Filing[];
  news: NewsItem[];
  attempts: Attempt[];
  loadedAt: string;
}

function mergeProfiles(list: Array<CompanyProfile | null>): CompanyProfile | null {
  const ps = list.filter((p): p is CompanyProfile => !!p);
  if (!ps.length) return null;
  const out: CompanyProfile = { ...ps[0], sources: [] };
  for (const p of ps) {
    for (const [k, v] of Object.entries(p) as Array<[keyof CompanyProfile, unknown]>) {
      if (k === 'sources') continue;
      if ((out[k] === undefined || out[k] === '') && v !== undefined) (out as unknown as Record<string, unknown>)[k] = v;
    }
    out.sources.push(...p.sources);
  }
  return out;
}

export async function loadCompany(symbol: string, hint?: SearchResult): Promise<CompanyData> {
  const attempts: Attempt[] = [];
  const sym = symbol.toUpperCase();
  const cik = hint?.cik ?? (await attempt(attempts, 'SEC EDGAR', 'CIK', async () => (await secProvider.tickers()).find((t) => t.symbol.toUpperCase() === sym)?.cik ?? null)) ?? undefined;
  const [fhProfile, avProfile, secProfile, quote, fhRatios, avRatios, statements, fhAnalysts, avAnalysts, filings, news] = await Promise.all([
    attempt(attempts, 'Finnhub', 'profilo', () => finnhub.getCompanyProfile!(sym)),
    attempt(attempts, 'Alpha Vantage', 'profilo', () => alphaVantage.getCompanyProfile!(sym)),
    cik ? attempt(attempts, 'SEC EDGAR', 'profilo', () => secProvider.getCompanyProfile!(sym, { ...hint, symbol: sym, name: hint?.name ?? sym, source: 'SEC EDGAR', cik })) : Promise.resolve(null),
    first<Quote>(attempts, 'quotazione', [
      ['Finnhub', () => finnhub.getQuote!(sym)],
      ['Alpha Vantage', () => alphaVantage.getQuote!(sym)],
    ]),
    attempt(attempts, 'Finnhub', 'indicatori', () => finnhub.getFinancialRatios!(sym)),
    attempt(attempts, 'Alpha Vantage', 'indicatori', () => alphaVantage.getFinancialRatios!(sym)),
    first<FinancialYear[]>(attempts, 'bilanci', [
      ...(cik ? ([['SEC EDGAR', () => secProvider.getFinancialStatements!(sym, { cik })]] as Array<[string, () => Promise<FinancialYear[] | null>]>) : []),
      ['Alpha Vantage', () => alphaVantage.getFinancialStatements!(sym)],
    ]),
    attempt(attempts, 'Finnhub', 'analisti', () => finnhub.getAnalystEstimates!(sym)),
    attempt(attempts, 'Alpha Vantage', 'analisti', () => alphaVantage.getAnalystEstimates!(sym)),
    cik ? attempt(attempts, 'SEC EDGAR', 'documenti', () => secProvider.getFilings!(sym, { cik })) : Promise.resolve(null),
    attempt(attempts, 'Finnhub', 'notizie', () => finnhub.getNews!(sym)),
  ]);
  const analysts: AnalystData = { unavailable: [] };
  analysts.recommendations = fhAnalysts?.recommendations ?? avAnalysts?.recommendations;
  analysts.priceTarget = avAnalysts?.priceTarget ?? fhAnalysts?.priceTarget;
  if (!analysts.recommendations) analysts.unavailable.push('Raccomandazioni degli analisti: nessuna fonte configurata le ha restituite.');
  if (!analysts.priceTarget) analysts.unavailable.push('Prezzo obiettivo: non disponibile dalle fonti gratuite configurate.');
  const profile = mergeProfiles([fhProfile, avProfile, secProfile]);
  if (profile && cik) profile.cik = cik;
  return {
    symbol: sym,
    profile,
    quote,
    ratios: { ...(avRatios ?? {}), ...(fhRatios ?? {}) },
    statements: statements ?? [],
    analysts,
    filings: filings ?? [],
    news: news ?? [],
    attempts,
    loadedAt: new Date().toISOString(),
  };
}

export async function loadHistory(symbol: string, _exchange?: string): Promise<{ daily: PriceHistory | null; weekly: PriceHistory | null; attempts: Attempt[] }> {
  const attempts: Attempt[] = [];
  const daily = await first<PriceHistory>(attempts, 'storico giornaliero', [
    ['Tiingo', () => tiingo.history(symbol, 'daily')],
    ['Alpha Vantage', () => alphaVantage.getHistoricalPrices!(symbol, 'daily')],
  ]);
  // se lo storico giornaliero copre già 5 anni non serve il settimanale
  const covers5y = daily && daily.points.length && Date.parse(daily.points[0].date) < Date.now() - 5 * 365 * 86_400_000;
  const weekly = covers5y
    ? null
    : await first<PriceHistory>(attempts, 'storico settimanale', [
        ['Tiingo', () => tiingo.history(symbol, 'weekly')],
        ['Alpha Vantage', () => alphaVantage.getHistoricalPrices!(symbol, 'weekly')],
      ]);
  return { daily, weekly, attempts };
}

export async function loadQuote(symbol: string): Promise<{ quote: Quote | null; attempts: Attempt[] }> {
  const attempts: Attempt[] = [];
  const quote = await first<Quote>(attempts, 'quotazione', [
    ['Finnhub', () => finnhub.getQuote!(symbol)],
    ['Alpha Vantage', () => alphaVantage.getQuote!(symbol)],
  ]);
  return { quote, attempts };
}
