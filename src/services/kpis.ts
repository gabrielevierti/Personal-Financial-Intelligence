/**
 * KPI della dashboard con confronto col periodo precedente e storico mensile (sparkline).
 * Patrimonio netto, liquidità e capitale investito sono grandezze distinte:
 *  - patrimonio netto = tutto ciò che possiedi meno i debiti (anche beni fisici);
 *  - liquidità        = saldi positivi di conti correnti, depositi, contanti, carte di debito;
 *  - investito        = conti investimento + asset finanziari + titoli acquistati (al costo).
 */
import type { Cents, ISODate, ISOMonth, Period } from '../types';
import { addDays, addMonths, monthEnd, monthOf, monthsBetween, previousPeriod, todayISO } from '../utils/date';
import { averageMonthlyExpense, dataCoverageStart, makeConverter, monthlySeries, netWorthSnapshot, summarize, type NetWorthOptions } from './finance';
import type { DataSet } from './reports';

export type KpiKey = 'netWorth' | 'liquidity' | 'investments' | 'income' | 'expense' | 'net' | 'savingsRate' | 'autonomy';

export interface Kpi {
  key: KpiKey;
  /** 'money' in centesimi, 'ratio' (0–1), 'months' (numero di mesi) */
  unit: 'money' | 'ratio' | 'months';
  value: number | null;
  previous: number | null;
  delta: number | null;
  /** Storico a fine mese; null dove i dati non sono completi. */
  series: Array<{ month: ISOMonth; value: number | null }>;
}

export interface KpiResult {
  kpis: Record<KpiKey, Kpi>;
  /** Investito netto nel periodo: non conta tra le uscite. */
  investedInPeriod: Cents;
  avgMonthlyExpense: Cents;
  previousPeriod: Period;
  coverageFrom: ISODate | null;
}

export function computeKpis(ds: DataSet, period: Period, opts: NetWorthOptions & { today?: ISODate; months?: number } = {}): KpiResult {
  const today = opts.today ?? todayISO();
  const conv = makeConverter(ds.settings);
  const nwOpts: NetWorthOptions = { costBasis: opts.costBasis, valuations: ds.valuations };
  const cur = summarize(ds.transactions, period, conv);
  const prevP = previousPeriod(period);
  const prev = summarize(ds.transactions, prevP, conv);
  const now = netWorthSnapshot(ds.accounts, ds.transactions, ds.assets, conv, nwOpts);
  const coverageFrom = dataCoverageStart(ds.accounts, ds.transactions);
  const prevEnd = addDays(period.start, -1);
  const before = coverageFrom && prevEnd >= coverageFrom ? netWorthSnapshot(ds.accounts, ds.transactions, ds.assets, conv, { ...nwOpts, asOf: prevEnd }) : null;

  const lastMonth = monthOf(today);
  const months = monthsBetween(`${addMonths(lastMonth, -((opts.months ?? 12) - 1))}-01`, today);
  const snaps = months.map((m) => {
    if (monthEnd(m) >= today) return now;
    const end = monthEnd(m);
    return coverageFrom && end >= coverageFrom ? netWorthSnapshot(ds.accounts, ds.transactions, ds.assets, conv, { ...nwOpts, asOf: end }) : null;
  });
  const flows = monthlySeries(ds.transactions, months, conv);
  const avgExp = averageMonthlyExpense(ds.transactions, conv, 6, lastMonth);
  const prevAvgExp = averageMonthlyExpense(ds.transactions, conv, 6, monthOf(prevEnd));

  const mk = (key: KpiKey, unit: Kpi['unit'], value: number | null, previous: number | null, series: Array<number | null>): Kpi => ({
    key,
    unit,
    value,
    previous,
    delta: value !== null && previous !== null ? value - previous : null,
    series: months.map((month, i) => ({ month, value: series[i] })),
  });
  const autonomy = (liq: number, exp: number) => (exp > 0 ? liq / exp : null);
  const kpis: Record<KpiKey, Kpi> = {
    netWorth: mk('netWorth', 'money', now.netWorth, before?.netWorth ?? null, snaps.map((s) => s?.netWorth ?? null)),
    liquidity: mk('liquidity', 'money', now.liquidity, before?.liquidity ?? null, snaps.map((s) => s?.liquidity ?? null)),
    investments: mk('investments', 'money', now.investments, before?.investments ?? null, snaps.map((s) => s?.investments ?? null)),
    income: mk('income', 'money', cur.income, prev.transactionCount ? prev.income : null, flows.map((f) => f.income)),
    expense: mk('expense', 'money', cur.expense, prev.transactionCount ? prev.expense : null, flows.map((f) => f.expense)),
    net: mk('net', 'money', cur.net, prev.transactionCount ? prev.net : null, flows.map((f) => f.net)),
    savingsRate: mk('savingsRate', 'ratio', cur.savingRate, prev.savingRate, flows.map((f) => f.savingRate)),
    autonomy: mk('autonomy', 'months', autonomy(now.liquidity, avgExp), before ? autonomy(before.liquidity, prevAvgExp) : null, snaps.map((s) => (s ? autonomy(s.liquidity, avgExp) : null))),
  };
  return { kpis, investedInPeriod: cur.invested, avgMonthlyExpense: avgExp, previousPeriod: prevP, coverageFrom };
}
