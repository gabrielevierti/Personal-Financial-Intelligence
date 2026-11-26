/**
 * Analisi e previsioni deterministiche. I numeri vengono calcolati qui, non dal modello linguistico:
 * i modelli piccoli sbagliano facilmente i conti, quindi ricevono risultati già pronti da spiegare.
 */
import type { Category, Cents, ISODate, ISOMonth, Transaction } from '../../types';
import { addMonths, daysBetween, monthEnd, monthOf, todayISO } from '../../utils/date';
import { merchantKey } from '../merchant';
import { isInvestmentFlow, makeConverter, monthlySeries, netWorthSnapshot, type Converter } from '../finance';
import type { DataSet } from '../reports';

export interface Recurring {
  merchant: string;
  description: string;
  categoryId: string | null;
  kind: 'income' | 'expense';
  /** importo tipico (mediana), positivo */
  amount: Cents;
  months: number;
  lastDate: ISODate;
  nextExpected: ISODate;
  chargedThisMonth: boolean;
}

export interface CategoryTrend {
  categoryId: string | null;
  name: string;
  thisMonth: Cents;
  average: Cents;
  /** proiezione a fine mese al ritmo attuale */
  projected: Cents;
}

export interface MonthForecast {
  month: ISOMonth;
  dayOfMonth: number;
  daysInMonth: number;
  incomeSoFar: Cents;
  expenseSoFar: Cents;
  expectedRecurringExpense: Cents;
  expectedRecurringIncome: Cents;
  expectedVariableExpense: Cents;
  projectedIncome: Cents;
  projectedExpense: Cents;
  projectedNet: Cents;
  liquidityNow: Cents;
  projectedLiquidity: Cents;
  /** Spesa variabile media giornaliera (ultimi mesi, esclusi i ricorrenti). */
  dailyVariable: number;
}

export interface Insights {
  generatedAt: ISODate;
  currency: string;
  recurring: Recurring[];
  subscriptionsMonthly: Cents;
  forecast: MonthForecast;
  trends: CategoryTrend[];
  avgMonthlyIncome: Cents;
  avgMonthlyExpense: Cents;
  avgMonthlyNet: Cents;
  netWorth: Cents;
  netWorthEndOfYear: Cents;
  monthsOfData: number;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/** Movimenti che si ripetono ogni mese con importo simile (abbonamenti, stipendio, affitto, bollette). */
export function findRecurring(txs: Transaction[], today: ISODate = todayISO(), conv?: Converter): Recurring[] {
  const since = addMonths(monthOf(today), -6);
  const groups = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.type === 'transfer' || t.pending || monthOf(t.date) < since) continue;
    const key = `${t.type}|${merchantKey(t.description)}`;
    const l = groups.get(key) ?? [];
    l.push(t);
    groups.set(key, l);
  }
  const out: Recurring[] = [];
  for (const [key, list] of groups) {
    const kind = key.split('|')[0] as 'income' | 'expense';
    const months = new Set(list.map((t) => monthOf(t.date)));
    if (months.size < 3) continue;
    // al massimo un paio di addebiti al mese: altrimenti è spesa frequente (es. supermercato), non ricorrente
    if (list.length > months.size * 1.5) continue;
    const amounts = list.map((t) => Math.abs(conv ? conv(t.amount, t.currency) : t.amount));
    const med = median(amounts);
    const consistent = amounts.filter((a) => Math.abs(a - med) <= Math.max(100, med * 0.15)).length / amounts.length;
    if (consistent < 0.7) continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const last = sorted[sorted.length - 1];
    const next = addMonths(monthOf(last.date), 1);
    const day = Math.min(Number(last.date.slice(8, 10)), Number(monthEnd(next).slice(8, 10)));
    out.push({
      merchant: key.split('|')[1],
      description: last.description,
      categoryId: last.categoryId,
      kind,
      amount: med,
      months: months.size,
      lastDate: last.date,
      nextExpected: `${next}-${String(day).padStart(2, '0')}`,
      chargedThisMonth: months.has(monthOf(today)),
    });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

export function buildInsights(ds: DataSet, today: ISODate = todayISO()): Insights {
  // acquisti e vendite di titoli non sono spese né entrate
  const flows = ds.transactions.filter((t) => !isInvestmentFlow(t));
  const conv = makeConverter(ds.settings);
  const month = monthOf(today);
  const prev = [addMonths(month, -3), addMonths(month, -2), addMonths(month, -1)];
  const series = monthlySeries(flows, prev, conv).filter((p) => p.income || p.expense);
  const avgIncome = series.length ? Math.round(series.reduce((s, p) => s + p.income, 0) / series.length) : 0;
  const avgExpense = series.length ? Math.round(series.reduce((s, p) => s + p.expense, 0) / series.length) : 0;

  const recurring = findRecurring(flows, today, conv);
  const recurringKeys = new Set(recurring.map((r) => `${r.kind}|${r.merchant}`));
  const subscriptionsMonthly = recurring.filter((r) => r.kind === 'expense' && r.categoryId === 'exp-subscriptions').reduce((s, r) => s + r.amount, 0);

  // mese corrente
  const cur = flows.filter((t) => monthOf(t.date) === month && t.type !== 'transfer');
  const incomeSoFar = cur.filter((t) => t.type === 'income').reduce((s, t) => s + conv(t.amount, t.currency), 0);
  const expenseSoFar = cur.filter((t) => t.type === 'expense').reduce((s, t) => s - conv(t.amount, t.currency), 0);
  const daysInMonth = Number(monthEnd(month).slice(8, 10));
  const dayOfMonth = Number(today.slice(8, 10));
  const expectedRecurringExpense = recurring.filter((r) => r.kind === 'expense' && !r.chargedThisMonth && monthOf(r.nextExpected) <= month).reduce((s, r) => s + r.amount, 0);
  const expectedRecurringIncome = recurring.filter((r) => r.kind === 'income' && !r.chargedThisMonth && monthOf(r.nextExpected) <= month).reduce((s, r) => s + r.amount, 0);
  // spesa variabile media giornaliera degli ultimi 3 mesi, esclusi i ricorrenti
  const varTx = flows.filter((t) => t.type === 'expense' && prev.includes(monthOf(t.date)) && !recurringKeys.has(`expense|${merchantKey(t.description)}`));
  const varDays = series.length * 30.4;
  const dailyVariable = varDays ? varTx.reduce((s, t) => s - conv(t.amount, t.currency), 0) / varDays : 0;
  const expectedVariableExpense = Math.round(dailyVariable * (daysInMonth - dayOfMonth));
  const projectedIncome = incomeSoFar + expectedRecurringIncome;
  const projectedExpense = expenseSoFar + expectedRecurringExpense + expectedVariableExpense;
  const snap = netWorthSnapshot(ds.accounts, ds.transactions, ds.assets, conv);
  const forecast: MonthForecast = {
    month,
    dayOfMonth,
    daysInMonth,
    incomeSoFar,
    expenseSoFar,
    expectedRecurringExpense,
    expectedRecurringIncome,
    expectedVariableExpense,
    projectedIncome,
    projectedExpense,
    projectedNet: projectedIncome - projectedExpense,
    liquidityNow: snap.liquidity,
    projectedLiquidity: snap.liquidity + expectedRecurringIncome - expectedRecurringExpense - expectedVariableExpense,
    dailyVariable,
  };

  // categorie: questo mese (proiettato) rispetto alla media
  const catName = new Map<string, Category>(ds.categories.map((c) => [c.id, c]));
  const byCat = (txs: Transaction[]) => {
    const m = new Map<string | null, Cents>();
    for (const t of txs) if (t.type === 'expense') m.set(t.categoryId, (m.get(t.categoryId) ?? 0) - conv(t.amount, t.currency));
    return m;
  };
  const nowCat = byCat(cur);
  const prevCat = byCat(flows.filter((t) => prev.includes(monthOf(t.date))));
  const keys = new Set([...nowCat.keys(), ...prevCat.keys()]);
  const trends: CategoryTrend[] = [...keys]
    .map((k) => {
      const thisMonth = nowCat.get(k) ?? 0;
      const average = series.length ? Math.round((prevCat.get(k) ?? 0) / series.length) : 0;
      return { categoryId: k, name: k ? (catName.get(k)?.name ?? 'Senza categoria') : 'Senza categoria', thisMonth, average, projected: Math.round((thisMonth / Math.max(1, dayOfMonth)) * daysInMonth) };
    })
    .filter((t) => t.thisMonth > 0 || t.average > 0)
    .sort((a, b) => b.projected - b.average - (a.projected - a.average));

  const monthsLeft = 12 - Number(month.slice(5, 7));
  const avgNet = avgIncome - avgExpense;
  const firstTx = ds.transactions.reduce<string | null>((m, t) => (!m || t.date < m ? t.date : m), null);
  return {
    generatedAt: today,
    currency: ds.settings.baseCurrency,
    recurring,
    subscriptionsMonthly,
    forecast,
    trends,
    avgMonthlyIncome: avgIncome,
    avgMonthlyExpense: avgExpense,
    avgMonthlyNet: avgNet,
    netWorth: snap.netWorth,
    netWorthEndOfYear: snap.netWorth + forecast.projectedNet - (incomeSoFar - expenseSoFar) + avgNet * monthsLeft,
    monthsOfData: firstTx ? Math.max(1, Math.round(daysBetween(firstTx, today) / 30.4)) : 0,
  };
}

