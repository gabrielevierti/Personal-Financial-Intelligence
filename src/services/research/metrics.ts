/**
 * Calcoli di analisi aziendale. Funzioni pure: stessi input, stessi output.
 * Se un dato necessario manca il risultato è null: non si stima mai un valore mancante.
 */
import type { FinancialYear, PricePoint } from './types';

const ok = (...xs: Array<number | null | undefined>): boolean => xs.every((x) => x !== null && x !== undefined && Number.isFinite(x));
const div = (a: number | null | undefined, b: number | null | undefined): number | null => (ok(a, b) && b !== 0 ? (a as number) / (b as number) : null);

// ============================================================================ metriche per esercizio

export interface YearMetrics {
  fiscalYear: number;
  periodEnd: string;
  currency: string;
  revenue: number | null;
  ebitda: number | null;
  ebit: number | null;
  netIncome: number | null;
  fcf: number | null;
  grossDebt: number | null;
  /** Debito netto = debito finanziario lordo − cassa − investimenti a breve. */
  netDebt: number | null;
  netDebtToEbitda: number | null;
  debtToEquity: number | null;
  interestCoverage: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  fcfMargin: number | null;
  roe: number | null;
  roa: number | null;
  roic: number | null;
  /** Aliquota effettiva usata per il ROIC (calcolata dal bilancio o ipotesi del 21%). */
  taxRate: number;
  taxRateAssumed: boolean;
  revenueGrowth: number | null;
  netIncomeGrowth: number | null;
  fcfGrowth: number | null;
  dividendsPerShare: number | null;
}

/** Free cash flow = flusso di cassa operativo − investimenti in immobilizzazioni (capex). */
export function freeCashFlow(y: Pick<FinancialYear, 'operatingCashFlow' | 'capex'>): number | null {
  return ok(y.operatingCashFlow, y.capex) ? y.operatingCashFlow! - Math.abs(y.capex!) : null;
}

/** EBITDA = utile operativo + ammortamenti (se la fonte non lo riporta già). */
export function ebitdaOf(y: Pick<FinancialYear, 'ebitda' | 'operatingIncome' | 'depreciation'>): number | null {
  if (ok(y.ebitda)) return y.ebitda;
  return ok(y.operatingIncome, y.depreciation) ? y.operatingIncome! + y.depreciation! : null;
}

export function grossDebtOf(y: Pick<FinancialYear, 'shortTermDebt' | 'longTermDebt'>): number | null {
  if (!ok(y.shortTermDebt) && !ok(y.longTermDebt)) return null;
  return (y.shortTermDebt ?? 0) + (y.longTermDebt ?? 0);
}

export function netDebtOf(y: Pick<FinancialYear, 'shortTermDebt' | 'longTermDebt' | 'cash' | 'shortTermInvestments'>): number | null {
  const gross = grossDebtOf(y);
  if (gross === null || !ok(y.cash)) return null;
  return gross - y.cash! - (y.shortTermInvestments ?? 0);
}

export function effectiveTaxRate(y: Pick<FinancialYear, 'incomeTax' | 'pretaxIncome'>): number | null {
  const r = div(y.incomeTax, y.pretaxIncome);
  return r !== null && r >= 0 && r <= 0.5 ? r : null;
}

const growth = (cur: number | null, prev: number | null | undefined) => (ok(cur, prev) && prev !== 0 ? (cur! - prev!) / Math.abs(prev!) : null);

/** Metriche per esercizio, dal più recente al più vecchio (come l'input). */
export function yearMetrics(years: FinancialYear[]): YearMetrics[] {
  return years.map((y, i) => {
    const prev = years[i + 1];
    const ebitda = ebitdaOf(y);
    const fcf = freeCashFlow(y);
    const grossDebt = grossDebtOf(y);
    const netDebt = netDebtOf(y);
    const tax = effectiveTaxRate(y);
    const taxRate = tax ?? 0.21;
    const investedCapital = ok(grossDebt, y.equity, y.cash) ? grossDebt! + y.equity! - y.cash! : null;
    const nopat = ok(y.operatingIncome) ? y.operatingIncome! * (1 - taxRate) : null;
    const avgEquity = ok(y.equity, prev?.equity) ? (y.equity! + prev!.equity!) / 2 : y.equity;
    const prevFcf = prev ? freeCashFlow(prev) : null;
    return {
      fiscalYear: y.fiscalYear,
      periodEnd: y.periodEnd,
      currency: y.currency,
      revenue: y.revenue,
      ebitda,
      ebit: y.operatingIncome,
      netIncome: y.netIncome,
      fcf,
      grossDebt,
      netDebt,
      netDebtToEbitda: ebitda !== null && ebitda > 0 ? div(netDebt, ebitda) : null,
      debtToEquity: y.equity !== null && y.equity > 0 ? div(grossDebt, y.equity) : null,
      interestCoverage: y.interestExpense !== null && y.interestExpense !== 0 ? div(y.operatingIncome, Math.abs(y.interestExpense)) : null,
      currentRatio: div(y.currentAssets, y.currentLiabilities),
      quickRatio: ok(y.currentAssets, y.currentLiabilities) ? div(y.currentAssets! - (y.inventory ?? 0), y.currentLiabilities) : null,
      grossMargin: div(y.grossProfit, y.revenue),
      operatingMargin: div(y.operatingIncome, y.revenue),
      netMargin: div(y.netIncome, y.revenue),
      fcfMargin: div(fcf, y.revenue),
      roe: avgEquity !== null && avgEquity > 0 ? div(y.netIncome, avgEquity) : null,
      roa: div(y.netIncome, y.totalAssets),
      roic: investedCapital !== null && investedCapital > 0 ? div(nopat, investedCapital) : null,
      taxRate,
      taxRateAssumed: tax === null,
      revenueGrowth: growth(y.revenue, prev?.revenue),
      netIncomeGrowth: growth(y.netIncome, prev?.netIncome),
      fcfGrowth: growth(fcf, prevFcf),
      dividendsPerShare: ok(y.dividendsPaid, y.sharesDiluted) && y.sharesDiluted! > 0 ? Math.abs(y.dividendsPaid!) / y.sharesDiluted! : null,
    };
  });
}

/** Tasso di crescita annuo composto tra due valori positivi in n anni. */
export function cagr(first: number | null, last: number | null, years: number): number | null {
  if (!ok(first, last) || first! <= 0 || last! <= 0 || years <= 0) return null;
  return Math.pow(last! / first!, 1 / years) - 1;
}

export interface Anomaly {
  fiscalYear: number;
  field: string;
  message: string;
  severity: 'attenzione' | 'info';
}

/** Variazioni insolite da evidenziare (non giudizi: segnali da approfondire). */
export function findAnomalies(m: YearMetrics[]): Anomaly[] {
  const out: Anomaly[] = [];
  for (let i = 0; i < m.length; i++) {
    const y = m[i];
    const p = m[i + 1];
    if (y.revenueGrowth !== null && Math.abs(y.revenueGrowth) > 0.4) out.push({ fiscalYear: y.fiscalYear, field: 'revenue', message: `Ricavi ${y.revenueGrowth > 0 ? '+' : ''}${(y.revenueGrowth * 100).toFixed(0)}% rispetto all'anno prima`, severity: 'attenzione' });
    if (y.netIncome !== null && y.netIncome < 0) out.push({ fiscalYear: y.fiscalYear, field: 'netIncome', message: 'Utile netto negativo', severity: 'attenzione' });
    if (y.fcf !== null && y.fcf < 0) out.push({ fiscalYear: y.fiscalYear, field: 'fcf', message: 'Free cash flow negativo', severity: 'attenzione' });
    if (p && y.operatingMargin !== null && p.operatingMargin !== null && Math.abs(y.operatingMargin - p.operatingMargin) > 0.08) out.push({ fiscalYear: y.fiscalYear, field: 'operatingMargin', message: `Margine operativo cambiato di ${((y.operatingMargin - p.operatingMargin) * 100).toFixed(1)} punti`, severity: 'info' });
    if (y.netDebtToEbitda !== null && y.netDebtToEbitda > 3.5) out.push({ fiscalYear: y.fiscalYear, field: 'netDebtToEbitda', message: `Debito netto pari a ${y.netDebtToEbitda.toFixed(1)} volte l'EBITDA`, severity: 'attenzione' });
    if (y.interestCoverage !== null && y.interestCoverage < 3) out.push({ fiscalYear: y.fiscalYear, field: 'interestCoverage', message: `Copertura degli interessi bassa (${y.interestCoverage.toFixed(1)}x)`, severity: 'attenzione' });
    if (y.netIncome !== null && y.fcf !== null && y.netIncome > 0 && y.fcf < y.netIncome * 0.5) out.push({ fiscalYear: y.fiscalYear, field: 'fcf', message: 'Free cash flow molto inferiore all\'utile netto', severity: 'info' });
  }
  return out;
}

// ============================================================================ valutazione

export interface MarketInputs {
  price: number | null;
  /** Numero di azioni (diluite se disponibili). */
  shares: number | null;
  marketCap: number | null;
}

export interface Multiples {
  marketCap: number | null;
  enterpriseValue: number | null;
  pe: number | null;
  ps: number | null;
  pb: number | null;
  evEbitda: number | null;
  evSales: number | null;
  fcfYield: number | null;
  dividendYield: number | null;
}

export function marketCapOf(m: MarketInputs): number | null {
  if (ok(m.marketCap)) return m.marketCap;
  return ok(m.price, m.shares) ? m.price! * m.shares! : null;
}

/** EV = capitalizzazione + debito lordo − cassa e investimenti a breve. */
export function enterpriseValue(marketCap: number | null, y: FinancialYear | undefined): number | null {
  if (!y || !ok(marketCap)) return null;
  const nd = netDebtOf(y);
  return nd === null ? null : marketCap! + nd;
}

export function multiples(m: MarketInputs, y: FinancialYear | undefined): Multiples {
  const mc = marketCapOf(m);
  const ev = enterpriseValue(mc, y);
  const ebitda = y ? ebitdaOf(y) : null;
  const fcf = y ? freeCashFlow(y) : null;
  return {
    marketCap: mc,
    enterpriseValue: ev,
    pe: y?.netIncome && y.netIncome > 0 ? div(mc, y.netIncome) : null,
    ps: div(mc, y?.revenue),
    pb: y?.equity && y.equity > 0 ? div(mc, y.equity) : null,
    evEbitda: ebitda !== null && ebitda > 0 ? div(ev, ebitda) : null,
    evSales: div(ev, y?.revenue),
    fcfYield: div(fcf, mc),
    dividendYield: y?.dividendsPaid !== null && y?.dividendsPaid !== undefined ? div(Math.abs(y.dividendsPaid), mc) : null,
  };
}

export interface DcfInputs {
  baseRevenue: number;
  /** Crescita annua dei ricavi nel periodo esplicito (es. 0.05). */
  revenueGrowth: number;
  /** Margine operativo (EBIT/ricavi). */
  operatingMargin: number;
  taxRate: number;
  /** Quota del NOPAT reinvestita (capex netti e capitale circolante). */
  reinvestmentRate: number;
  wacc: number;
  terminalGrowth: number;
  years: number;
  netDebt: number;
  shares: number;
}

export interface DcfResult {
  rows: Array<{ year: number; revenue: number; nopat: number; fcff: number; discount: number; pv: number }>;
  terminalValue: number;
  pvTerminal: number;
  enterpriseValue: number;
  equityValue: number;
  perShare: number;
  /** Quota del valore che viene dal valore terminale: alta = valutazione molto sensibile alle ipotesi. */
  terminalShare: number;
}

export function validateDcf(i: DcfInputs): string[] {
  const e: string[] = [];
  if (!(i.baseRevenue > 0)) e.push('Servono ricavi di partenza positivi.');
  if (!(i.shares > 0)) e.push('Serve il numero di azioni.');
  if (!(i.wacc > 0 && i.wacc < 0.5)) e.push('Il WACC deve essere tra 0% e 50%.');
  if (!(i.terminalGrowth < i.wacc)) e.push('La crescita terminale deve essere inferiore al WACC.');
  if (i.terminalGrowth > 0.05) e.push('Una crescita terminale oltre il 5% supera la crescita di lungo periodo di un\'economia.');
  if (!(i.years >= 1 && i.years <= 20)) e.push('Il periodo esplicito va da 1 a 20 anni.');
  if (i.reinvestmentRate < 0 || i.reinvestmentRate > 1) e.push('Il tasso di reinvestimento va da 0% a 100%.');
  return e;
}

/** DCF a flussi di cassa per l'impresa (FCFF = NOPAT × (1 − reinvestimento)), valore terminale di Gordon. */
export function dcf(i: DcfInputs): DcfResult | null {
  if (validateDcf(i).length) return null;
  const rows: DcfResult['rows'] = [];
  let revenue = i.baseRevenue;
  let pvSum = 0;
  let lastFcff = 0;
  for (let t = 1; t <= i.years; t++) {
    revenue *= 1 + i.revenueGrowth;
    const nopat = revenue * i.operatingMargin * (1 - i.taxRate);
    const fcff = nopat * (1 - i.reinvestmentRate);
    const discount = Math.pow(1 + i.wacc, t);
    const pv = fcff / discount;
    pvSum += pv;
    lastFcff = fcff;
    rows.push({ year: t, revenue, nopat, fcff, discount, pv });
  }
  const terminalValue = (lastFcff * (1 + i.terminalGrowth)) / (i.wacc - i.terminalGrowth);
  const pvTerminal = terminalValue / Math.pow(1 + i.wacc, i.years);
  const ev = pvSum + pvTerminal;
  const equity = ev - i.netDebt;
  return { rows, terminalValue, pvTerminal, enterpriseValue: ev, equityValue: equity, perShare: equity / i.shares, terminalShare: ev !== 0 ? pvTerminal / ev : 0 };
}

/** Sensibilità del valore per azione a WACC e crescita terminale. */
export function dcfSensitivity(i: DcfInputs, waccSteps = [-0.01, 0, 0.01], gSteps = [-0.005, 0, 0.005]): Array<{ wacc: number; g: number; perShare: number | null }> {
  const out: Array<{ wacc: number; g: number; perShare: number | null }> = [];
  for (const dw of waccSteps) for (const dg of gSteps) {
    const r = dcf({ ...i, wacc: i.wacc + dw, terminalGrowth: i.terminalGrowth + dg });
    out.push({ wacc: i.wacc + dw, g: i.terminalGrowth + dg, perShare: r ? r.perShare : null });
  }
  return out;
}

/** Modello di Gordon: valore = D1 / (r − g). null se l'azienda non paga dividendi o r ≤ g. */
export function ddm(dividendPerShare: number | null, requiredReturn: number, growthRate: number): number | null {
  if (!ok(dividendPerShare) || dividendPerShare! <= 0 || requiredReturn <= growthRate) return null;
  return (dividendPerShare! * (1 + growthRate)) / (requiredReturn - growthRate);
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Valore per azione dai multipli mediani dei comparabili scelti dall'utente. */
export function comparablesValue(peersPe: number[], eps: number | null, peersEvEbitda: number[], ebitda: number | null, netDebt: number | null, shares: number | null): { byPe: number | null; byEvEbitda: number | null; medianPe: number | null; medianEvEbitda: number | null } {
  const mPe = median(peersPe.filter((x) => x > 0 && Number.isFinite(x)));
  const mEv = median(peersEvEbitda.filter((x) => x > 0 && Number.isFinite(x)));
  return {
    medianPe: mPe,
    medianEvEbitda: mEv,
    byPe: mPe !== null && eps !== null && eps > 0 ? mPe * eps : null,
    byEvEbitda: mEv !== null && ok(ebitda, netDebt, shares) && ebitda! > 0 && shares! > 0 ? (mEv * ebitda! - netDebt!) / shares! : null,
  };
}

/** P/E storico: prezzo di fine esercizio (dallo storico prezzi) diviso EPS diluito dell'esercizio. */
export function historicalPe(years: FinancialYear[], prices: PricePoint[]): Array<{ fiscalYear: number; price: number | null; eps: number | null; pe: number | null }> {
  return years.map((y) => {
    const p = priceOn(prices, y.periodEnd);
    const eps = y.epsDiluted ?? (ok(y.netIncome, y.sharesDiluted) && y.sharesDiluted! > 0 ? y.netIncome! / y.sharesDiluted! : null);
    return { fiscalYear: y.fiscalYear, price: p, eps, pe: p !== null && eps !== null && eps > 0 ? p / eps : null };
  });
}

// ============================================================================ prezzi

/** Ultimo prezzo di chiusura disponibile entro una data. */
export function priceOn(points: PricePoint[], date: string): number | null {
  let best: PricePoint | null = null;
  for (const p of points) if (p.date <= date && (!best || p.date > best.date)) best = p;
  if (!best) return null;
  // oltre 10 giorni di distanza il prezzo non rappresenta quella data
  return (Date.parse(date) - Date.parse(best.date)) / 86_400_000 <= 10 ? best.close : null;
}

export interface PricePerformance {
  last: { date: string; close: number } | null;
  returns: Record<'1W' | '1M' | 'YTD' | '1Y' | '3Y' | '5Y', number | null>;
  high52: number | null;
  low52: number | null;
  avgVolume3m: number | null;
  maxDrawdown: number | null;
}

const shiftDate = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86_400_000).toISOString().slice(0, 10);

export function pricePerformance(points: PricePoint[]): PricePerformance {
  const pts = [...points].sort((a, b) => (a.date < b.date ? -1 : 1));
  const last = pts[pts.length - 1];
  const empty = { '1W': null, '1M': null, YTD: null, '1Y': null, '3Y': null, '5Y': null };
  if (!last) return { last: null, returns: empty, high52: null, low52: null, avgVolume3m: null, maxDrawdown: null };
  const ret = (from: string) => {
    if (pts[0].date > from) return null;
    const p = priceOn(pts, from);
    return p ? last.close / p - 1 : null;
  };
  const yStart = `${Number(last.date.slice(0, 4)) - 1}-12-31`;
  const yearAgo = shiftDate(last.date, -365);
  const lastYear = pts.filter((p) => p.date > yearAgo);
  const vol = pts.filter((p) => p.date > shiftDate(last.date, -91) && p.volume !== undefined);
  return {
    last: { date: last.date, close: last.close },
    returns: { '1W': ret(shiftDate(last.date, -7)), '1M': ret(shiftDate(last.date, -30)), YTD: ret(yStart), '1Y': ret(yearAgo), '3Y': ret(shiftDate(last.date, -1095)), '5Y': ret(shiftDate(last.date, -1826)) },
    high52: lastYear.length ? Math.max(...lastYear.map((p) => p.high ?? p.close)) : null,
    low52: lastYear.length ? Math.min(...lastYear.map((p) => p.low ?? p.close)) : null,
    avgVolume3m: vol.length ? vol.reduce((s, p) => s + (p.volume ?? 0), 0) / vol.length : null,
    maxDrawdown: maxDrawdown(pts.filter((p) => p.date > yearAgo)),
  };
}

/** Serie del drawdown (distanza dal massimo precedente) e massimo drawdown. */
export function drawdownSeries(points: PricePoint[]): Array<{ date: string; drawdown: number }> {
  let peak = -Infinity;
  return points.map((p) => {
    peak = Math.max(peak, p.close);
    return { date: p.date, drawdown: peak > 0 ? p.close / peak - 1 : 0 };
  });
}

export function maxDrawdown(points: PricePoint[]): number | null {
  if (!points.length) return null;
  return Math.min(...drawdownSeries(points).map((d) => d.drawdown));
}

/** Due serie normalizzate a 100 sulle date comuni (titolo e indice di riferimento). */
export function normalizeTogether(a: PricePoint[], b: PricePoint[]): Array<{ date: string; a: number; b: number }> {
  const bm = new Map(b.map((p) => [p.date, p.close]));
  const common = a.filter((p) => bm.has(p.date));
  if (!common.length) return [];
  const a0 = common[0].close;
  const b0 = bm.get(common[0].date)!;
  return common.map((p) => ({ date: p.date, a: (p.close / a0) * 100, b: (bm.get(p.date)! / b0) * 100 }));
}

export function filterRange(points: PricePoint[], range: '1M' | '6M' | 'YTD' | '1Y' | '3Y' | '5Y' | 'MAX'): PricePoint[] {
  if (!points.length || range === 'MAX') return points;
  const last = points[points.length - 1].date;
  const from = range === 'YTD' ? `${last.slice(0, 4)}-01-01` : shiftDate(last, -{ '1M': 30, '6M': 182, '1Y': 365, '3Y': 1095, '5Y': 1826 }[range]);
  return points.filter((p) => p.date >= from);
}
