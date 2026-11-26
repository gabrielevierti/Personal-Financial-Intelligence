/**
 * Adattatori dei fornitori con piano gratuito: Alpha Vantage, Finnhub, Tiingo.
 * Ogni adattatore converte la risposta nel formato comune e dichiara fonte, data e ritardo.
 */
import { bridgeGet, TTL } from './bridge';
import type { AnalystData, CompanyProfile, FinancialYear, MarketDataProvider, NewsItem, PriceHistory, PricePoint, Provenance, Quote, SearchResult, Sourced } from './types';

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '' || v === 'None' || v === '-') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ============================================================================ Alpha Vantage

type AvReport = Record<string, string>;

export function parseAvStatements(income: { annualReports?: AvReport[] }, balance: { annualReports?: AvReport[] }, cash: { annualReports?: AvReport[] }, fetchedAt: string): FinancialYear[] {
  const byEnd = new Map<string, { i?: AvReport; b?: AvReport; c?: AvReport }>();
  const add = (list: AvReport[] | undefined, k: 'i' | 'b' | 'c') => {
    for (const r of list ?? []) {
      const e = r.fiscalDateEnding;
      if (!e) continue;
      const cur = byEnd.get(e) ?? {};
      cur[k] = r;
      byEnd.set(e, cur);
    }
  };
  add(income.annualReports, 'i');
  add(balance.annualReports, 'b');
  add(cash.annualReports, 'c');
  return [...byEnd.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([end, { i = {}, b = {}, c = {} }]) => {
      const currency = i.reportedCurrency ?? b.reportedCurrency ?? c.reportedCurrency ?? 'USD';
      const capex = num(c.capitalExpenditures);
      const y: FinancialYear = {
        fiscalYear: Number(end.slice(0, 4)),
        periodEnd: end,
        currency,
        revenue: num(i.totalRevenue),
        costOfRevenue: num(i.costOfRevenue) ?? num(i.costofGoodsAndServicesSold),
        grossProfit: num(i.grossProfit),
        operatingIncome: num(i.operatingIncome),
        netIncome: num(i.netIncome),
        ebitda: num(i.ebitda),
        depreciation: num(i.depreciationAndAmortization) ?? num(c.depreciationDepletionAndAmortization),
        interestExpense: num(i.interestExpense),
        incomeTax: num(i.incomeTaxExpense),
        pretaxIncome: num(i.incomeBeforeTax),
        epsDiluted: null,
        sharesDiluted: num(b.commonStockSharesOutstanding),
        totalAssets: num(b.totalAssets),
        totalLiabilities: num(b.totalLiabilities),
        equity: num(b.totalShareholderEquity),
        cash: num(b.cashAndCashEquivalentsAtCarryingValue),
        shortTermInvestments: num(b.shortTermInvestments),
        currentAssets: num(b.totalCurrentAssets),
        currentLiabilities: num(b.totalCurrentLiabilities),
        inventory: num(b.inventory),
        receivables: num(b.currentNetReceivables),
        shortTermDebt: num(b.shortTermDebt) ?? num(b.currentDebt),
        longTermDebt: num(b.longTermDebtNoncurrent) ?? num(b.longTermDebt),
        operatingCashFlow: num(c.operatingCashflow),
        capex: capex === null ? null : Math.abs(capex),
        dividendsPaid: num(c.dividendPayout) === null ? null : Math.abs(num(c.dividendPayout)!),
        buybacks: num(c.paymentsForRepurchaseOfCommonStock) === null ? null : Math.abs(num(c.paymentsForRepurchaseOfCommonStock)!),
        prov: { source: 'Alpha Vantage (bilanci annuali)', fetchedAt, period: `Esercizio chiuso il ${end}`, currency, unit: 'unità di valuta', status: 'fornitore' },
        derived: [],
      };
      return y;
    });
}

export const alphaVantage: MarketDataProvider & { overview(symbol: string): Promise<{ data: Record<string, string>; fetchedAt: string } | null> } = {
  id: 'alphavantage',
  label: 'Alpha Vantage',
  async searchCompany(query) {
    const r = await bridgeGet<{ bestMatches?: Array<Record<string, string>> }>(`/research/av/SYMBOL_SEARCH?keywords=${encodeURIComponent(query)}`, 'Alpha Vantage', TTL.week);
    return (r.data.bestMatches ?? []).map((m) => ({ symbol: m['1. symbol'], name: m['2. name'], type: m['3. type'], region: m['4. region'], currency: m['8. currency'], source: 'Alpha Vantage' }));
  },
  async overview(symbol) {
    const r = await bridgeGet<Record<string, string>>(`/research/av/OVERVIEW?symbol=${encodeURIComponent(symbol)}`, 'Alpha Vantage', TTL.day);
    if (!r.data?.Symbol) return null;
    return { data: r.data, fetchedAt: r.fetchedAt };
  },
  async getCompanyProfile(symbol) {
    const o = await this.overview(symbol);
    if (!o) return null;
    const d = o.data;
    const prov: Provenance = { source: 'Alpha Vantage (OVERVIEW)', fetchedAt: o.fetchedAt, period: d.LatestQuarter ? `trimestre al ${d.LatestQuarter}` : undefined, currency: d.Currency, status: 'fornitore' };
    const mc = num(d.MarketCapitalization);
    const so = num(d.SharesOutstanding);
    return {
      symbol: d.Symbol,
      name: d.Name,
      exchange: d.Exchange,
      currency: d.Currency,
      country: d.Country,
      sector: d.Sector,
      industry: d.Industry,
      description: d.Description,
      website: d.OfficialSite || undefined,
      cik: d.CIK || undefined,
      fiscalYearEnd: d.FiscalYearEnd,
      marketCap: mc === null ? undefined : { value: mc, prov: { ...prov, unit: d.Currency, delay: 'ritardato' } },
      sharesOutstanding: so === null ? undefined : { value: so, prov: { ...prov, unit: 'azioni' } },
      sources: [prov],
    };
  },
  async getFinancialRatios(symbol) {
    const o = await this.overview(symbol);
    if (!o) return null;
    const prov: Provenance = { source: 'Alpha Vantage (OVERVIEW)', fetchedAt: o.fetchedAt, status: 'fornitore', period: o.data.LatestQuarter ? `TTM al ${o.data.LatestQuarter}` : 'TTM' };
    const map: Record<string, string> = { pe: 'PERatio', forwardPe: 'ForwardPE', peg: 'PEGRatio', pb: 'PriceToBookRatio', ps: 'PriceToSalesRatioTTM', evEbitda: 'EVToEBITDA', evRevenue: 'EVToRevenue', beta: 'Beta', dividendYield: 'DividendYield', high52: '52WeekHigh', low52: '52WeekLow', roe: 'ReturnOnEquityTTM', roa: 'ReturnOnAssetsTTM', profitMargin: 'ProfitMargin', operatingMargin: 'OperatingMarginTTM' };
    const out: Record<string, Sourced<number>> = {};
    for (const [k, f] of Object.entries(map)) {
      const v = num(o.data[f]);
      if (v !== null) out[k] = { value: v, prov };
    }
    return out;
  },
  async getAnalystEstimates(symbol) {
    const o = await this.overview(symbol);
    if (!o) return null;
    const d = o.data;
    const prov: Provenance = { source: 'Alpha Vantage (OVERVIEW)', fetchedAt: o.fetchedAt, status: 'fornitore', period: 'data del consenso non indicata dalla fonte', currency: d.Currency };
    const target = num(d.AnalystTargetPrice);
    const votes = ['AnalystRatingStrongBuy', 'AnalystRatingBuy', 'AnalystRatingHold', 'AnalystRatingSell', 'AnalystRatingStrongSell'].map((k) => num(d[k]));
    const res: AnalystData = { unavailable: [] };
    if (target !== null) res.priceTarget = { value: { mean: target, high: null, low: null }, prov };
    if (votes.every((v) => v !== null)) res.recommendations = { value: [{ period: 'attuale', strongBuy: votes[0]!, buy: votes[1]!, hold: votes[2]!, sell: votes[3]!, strongSell: votes[4]! }], prov };
    return res;
  },
  async getQuote(symbol) {
    const r = await bridgeGet<{ 'Global Quote'?: Record<string, string> }>(`/research/av/GLOBAL_QUOTE?symbol=${encodeURIComponent(symbol)}`, 'Alpha Vantage', TTL.hour);
    const q = r.data['Global Quote'];
    const price = num(q?.['05. price']);
    if (!q || price === null) return null;
    const day = q['07. latest trading day'];
    return {
      symbol,
      price,
      change: num(q['09. change']) ?? undefined,
      changePct: num(String(q['10. change percent'] ?? '').replace('%', '')) ?? undefined,
      previousClose: num(q['08. previous close']) ?? undefined,
      open: num(q['02. open']) ?? undefined,
      high: num(q['03. high']) ?? undefined,
      low: num(q['04. low']) ?? undefined,
      volume: num(q['06. volume']) ?? undefined,
      asOf: day,
      prov: { source: 'Alpha Vantage (GLOBAL_QUOTE)', fetchedAt: r.fetchedAt, period: day, status: 'fornitore', delay: 'fine giornata o ritardato: non in tempo reale' },
    };
  },
  async getHistoricalPrices(symbol, interval) {
    const fn = interval === 'weekly' ? 'TIME_SERIES_WEEKLY' : 'TIME_SERIES_DAILY';
    const r = await bridgeGet<Record<string, Record<string, Record<string, string>>>>(`/research/av/${fn}?symbol=${encodeURIComponent(symbol)}`, 'Alpha Vantage', TTL.day);
    const key = Object.keys(r.data).find((k) => k.startsWith('Time Series') || k.startsWith('Weekly'));
    if (!key) return null;
    const points: PricePoint[] = Object.entries(r.data[key])
      .map(([date, v]) => ({ date, open: num(v['1. open']) ?? undefined, high: num(v['2. high']) ?? undefined, low: num(v['3. low']) ?? undefined, close: num(v['4. close'])!, volume: num(v['5. volume']) ?? undefined }))
      .filter((p) => p.close !== null)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    return { symbol, interval, points, prov: { source: `Alpha Vantage (${fn}${interval === 'daily' ? ', ultimi 100 giorni nel piano gratuito' : ''})`, fetchedAt: r.fetchedAt, status: 'fornitore', delay: 'dati di fine giornata', unit: 'prezzo non rettificato per dividendi' } };
  },
  async getFinancialStatements(symbol) {
    const [i, b, c] = await Promise.all(['INCOME_STATEMENT', 'BALANCE_SHEET', 'CASH_FLOW'].map((f) => bridgeGet<{ annualReports?: AvReport[] }>(`/research/av/${f}?symbol=${encodeURIComponent(symbol)}`, 'Alpha Vantage', TTL.week)));
    const out = parseAvStatements(i.data, b.data, c.data, i.fetchedAt);
    return out.length ? out : null;
  },
};

// ============================================================================ Finnhub

export const finnhub: MarketDataProvider = {
  id: 'finnhub',
  label: 'Finnhub',
  async searchCompany(query) {
    const r = await bridgeGet<{ result?: Array<{ symbol: string; description: string; type: string; displaySymbol: string }> }>(`/research/finnhub/search?q=${encodeURIComponent(query)}`, 'Finnhub', TTL.week);
    const isIsin = /^[A-Z]{2}[A-Z0-9]{9}\d$/i.test(query.trim());
    return (r.data.result ?? []).slice(0, 15).map((x) => ({ symbol: x.symbol, name: x.description, type: x.type, isin: isIsin ? query.trim().toUpperCase() : undefined, source: 'Finnhub' }));
  },
  async getQuote(symbol) {
    const r = await bridgeGet<{ c: number; d: number | null; dp: number | null; h: number; l: number; o: number; pc: number; t: number }>(`/research/finnhub/quote?symbol=${encodeURIComponent(symbol)}`, 'Finnhub', TTL.quote);
    const q = r.data;
    if (!q || !q.c) return null;
    const asOf = q.t ? new Date(q.t * 1000).toISOString() : r.fetchedAt;
    return {
      symbol,
      price: q.c,
      change: q.d ?? undefined,
      changePct: q.dp ?? undefined,
      previousClose: q.pc,
      open: q.o,
      high: q.h,
      low: q.l,
      asOf,
      prov: { source: 'Finnhub (quote)', fetchedAt: r.fetchedAt, period: asOf, status: 'fornitore', delay: 'può essere ritardato; aggiornato al massimo ogni 15 minuti in PFI' },
    };
  },
  async getCompanyProfile(symbol) {
    const r = await bridgeGet<{ name?: string; ticker?: string; exchange?: string; currency?: string; country?: string; finnhubIndustry?: string; logo?: string; weburl?: string; ipo?: string; marketCapitalization?: number; shareOutstanding?: number }>(`/research/finnhub/stock/profile2?symbol=${encodeURIComponent(symbol)}`, 'Finnhub', TTL.day);
    const d = r.data;
    if (!d?.name) return null;
    const prov: Provenance = { source: 'Finnhub (profile2)', fetchedAt: r.fetchedAt, status: 'fornitore', currency: d.currency };
    return {
      symbol: d.ticker ?? symbol,
      name: d.name,
      exchange: d.exchange,
      currency: d.currency,
      country: d.country,
      industry: d.finnhubIndustry,
      logo: d.logo || undefined,
      website: d.weburl || undefined,
      ipo: d.ipo,
      marketCap: d.marketCapitalization ? { value: d.marketCapitalization * 1e6, prov: { ...prov, unit: d.currency, delay: 'ritardato' } } : undefined,
      sharesOutstanding: d.shareOutstanding ? { value: d.shareOutstanding * 1e6, prov: { ...prov, unit: 'azioni' } } : undefined,
      sources: [prov],
    };
  },
  async getFinancialRatios(symbol) {
    const r = await bridgeGet<{ metric?: Record<string, number | null> }>(`/research/finnhub/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all`, 'Finnhub', TTL.day);
    const m = r.data.metric ?? {};
    const prov: Provenance = { source: 'Finnhub (metric)', fetchedAt: r.fetchedAt, status: 'fornitore', period: 'TTM / ultimi dati della fonte' };
    const map: Record<string, string> = { high52: '52WeekHigh', low52: '52WeekLow', avgVolume3m: '3MonthAverageTradingVolume', beta: 'beta', pe: 'peTTM', pb: 'pbAnnual', dividendYield: 'dividendYieldIndicatedAnnual' };
    const out: Record<string, Sourced<number>> = {};
    for (const [k, f] of Object.entries(map)) {
      const v = m[f];
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = { value: k === 'avgVolume3m' ? v * 1e6 : k === 'dividendYield' ? v / 100 : v, prov };
    }
    return out;
  },
  async getAnalystEstimates(symbol) {
    const r = await bridgeGet<Array<{ period: string; strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }>>(`/research/finnhub/stock/recommendation?symbol=${encodeURIComponent(symbol)}`, 'Finnhub', TTL.day);
    const res: AnalystData = { unavailable: ['Prezzo obiettivo: nel piano gratuito di Finnhub non è disponibile.'] };
    if (Array.isArray(r.data) && r.data.length) res.recommendations = { value: r.data.slice(0, 6), prov: { source: 'Finnhub (recommendation trends)', fetchedAt: r.fetchedAt, period: `mese ${r.data[0].period}`, status: 'fornitore' } };
    return res;
  },
  async getNews(symbol) {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const r = await bridgeGet<Array<{ headline: string; url: string; source: string; datetime: number; summary?: string }>>(`/research/finnhub/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}`, 'Finnhub', TTL.hour * 6);
    return (Array.isArray(r.data) ? r.data : []).slice(0, 20).map((n): NewsItem => ({ headline: n.headline, url: n.url, source: n.source, datetime: new Date(n.datetime * 1000).toISOString(), summary: n.summary }));
  },
};

// ============================================================================ Tiingo

interface TiingoBar { date: string; adjOpen?: number; adjHigh?: number; adjLow?: number; adjClose: number; adjVolume?: number; close: number }

export function parseTiingo(rows: TiingoBar[]): PricePoint[] {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && typeof r.date === 'string' && Number.isFinite(r.adjClose ?? r.close))
    .map((r) => ({ date: r.date.slice(0, 10), open: r.adjOpen, high: r.adjHigh, low: r.adjLow, close: r.adjClose ?? r.close, volume: r.adjVolume }));
}

export const tiingo: MarketDataProvider & { history(symbol: string, interval: 'daily' | 'weekly'): Promise<PriceHistory | null> } = {
  id: 'tiingo',
  label: 'Tiingo',
  async history(symbol, interval) {
    // giornaliero: 5 anni; settimanale: 20 anni
    const years = interval === 'daily' ? 5 : 20;
    const start = new Date(Date.now() - years * 365.25 * 86_400_000).toISOString().slice(0, 10);
    const r = await bridgeGet<TiingoBar[]>(`/research/tiingo/prices?symbol=${encodeURIComponent(symbol)}&freq=${interval}&startDate=${start}`, 'Tiingo', TTL.day);
    const points = parseTiingo(r.data);
    if (!points.length) return null;
    return { symbol, interval, points, prov: { source: 'Tiingo (prezzi di fine giornata)', fetchedAt: r.fetchedAt, status: 'fornitore', delay: 'dati di fine giornata', unit: 'rettificati per dividendi e frazionamenti' } };
  },
  getHistoricalPrices(symbol, interval) {
    return this.history(symbol, interval);
  },
};

export type { CompanyProfile, Quote, SearchResult };
