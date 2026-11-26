import type { Account, AppSettings, Asset, AssetValuation, Budget, Category, Cents, ISOMonth, Period, Transaction } from '../types';
import { formatDate, formatMonth, monthsBetween, previousPeriod } from '../utils/date';
import { formatMoney, formatPercent } from '../utils/money';
import {
  dataCoverageStart,
  makeConverter,
  monthlySeries,
  netWorthSeries,
  summarize,
  totalsByCategory,
  type CategoryTotal,
  type MonthPoint,
  type NetWorthPoint,
  type PeriodSummary,
} from './finance';
import { downloadText, exportPdf, toCsv, transactionsToCsv } from './exporters';

export interface DataSet {
  accounts: Account[];
  transactions: Transaction[];
  categories: Category[];
  budgets: Budget[];
  assets: Asset[];
  valuations: AssetValuation[];
  settings: AppSettings;
}

export interface BudgetMonth {
  month: ISOMonth;
  budget: Cents;
  spent: Cents;
}

export interface Report {
  period: Period;
  previous: Period;
  summary: PeriodSummary;
  previousSummary: PeriodSummary;
  expenseByCategory: CategoryTotal[];
  incomeByCategory: CategoryTotal[];
  previousExpenseByCategory: CategoryTotal[];
  months: MonthPoint[];
  netWorth: NetWorthPoint[];
  budgets: BudgetMonth[];
  transactions: Transaction[];
  missingRates: string[];
}

export function buildReport(ds: DataSet, period: Period): Report {
  const conv = makeConverter(ds.settings);
  const previous = previousPeriod(period);
  const months = monthsBetween(period.start, period.end);
  const tx = ds.transactions.filter((t) => t.date >= period.start && t.date <= period.end);
  const monthsData = monthlySeries(tx, months, conv);
  const budgets: BudgetMonth[] = months.map((m) => {
    const monthBudgets = ds.budgets.filter((b) => b.month === m);
    const total = monthBudgets.find((b) => b.categoryId === null);
    const budget = total ? total.limit : monthBudgets.reduce((s, b) => s + b.limit, 0);
    const point = monthsData.find((p) => p.month === m);
    return { month: m, budget, spent: point?.expense ?? 0 };
  });
  return {
    period,
    previous,
    summary: summarize(ds.transactions, period, conv),
    previousSummary: summarize(ds.transactions, previous, conv),
    expenseByCategory: totalsByCategory(ds.transactions, period, 'expense', ds.categories, conv),
    incomeByCategory: totalsByCategory(ds.transactions, period, 'income', ds.categories, conv),
    previousExpenseByCategory: totalsByCategory(ds.transactions, previous, 'expense', ds.categories, conv),
    months: monthsData,
    netWorth: (() => {
      const from = dataCoverageStart(ds.accounts, ds.transactions);
      return netWorthSeries(ds.accounts, ds.transactions, ds.assets, ds.valuations, from ? months.filter((m) => `${m}-31` >= from) : months, conv);
    })(),
    budgets: budgets.filter((b) => b.budget > 0),
    transactions: tx,
    missingRates: [...conv.missing],
  };
}

export function deltaPct(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return (cur - prev) / Math.abs(prev);
}

function slug(p: Period) {
  return `${p.start}_${p.end}`;
}

export function reportSummaryRows(r: Report, cur: string): string[][] {
  const s = r.summary;
  const p = r.previousSummary;
  const row = (label: string, a: Cents, b: Cents) => [label, formatMoney(a, cur), formatMoney(b, cur), formatPercent(deltaPct(a, b))];
  return [
    row('Entrate', s.income, p.income),
    row('Uscite', s.expense, p.expense),
    row('Risparmio netto', s.net, p.net),
    ['Tasso di risparmio', formatPercent(s.savingRate), formatPercent(p.savingRate), '—'],
    row('Media spese mensili', s.avgMonthlyExpense, p.avgMonthlyExpense),
  ];
}

export function exportReportCsv(r: Report, ds: DataSet): void {
  const cur = ds.settings.baseCurrency;
  const lines: string[] = [];
  lines.push(toCsv(['Voce', 'Periodo', 'Periodo precedente', 'Variazione'], reportSummaryRows(r, cur)));
  lines.push('');
  lines.push(toCsv(['Mese', 'Entrate', 'Uscite', 'Risparmio'], r.months.map((m) => [m.month, (m.income / 100).toFixed(2), (m.expense / 100).toFixed(2), (m.net / 100).toFixed(2)])));
  lines.push('');
  lines.push(toCsv(['Categoria di spesa', 'Totale', 'Quota', 'Movimenti'], r.expenseByCategory.map((c) => [c.name, (c.total / 100).toFixed(2), formatPercent(c.share), String(c.count)])));
  lines.push('');
  lines.push(transactionsToCsv(r.transactions, ds.accounts, ds.categories));
  downloadText(lines.join('\r\n'), `pfi-report-${slug(r.period)}.csv`, 'text/csv;charset=utf-8');
}

export function exportReportJson(r: Report, ds: DataSet): void {
  const payload = {
    generatedBy: 'PFI',
    generatedAt: new Date().toISOString(),
    currency: ds.settings.baseCurrency,
    amountsIn: 'cents',
    period: r.period,
    previousPeriod: r.previous,
    summary: r.summary,
    previousSummary: r.previousSummary,
    expenseByCategory: r.expenseByCategory,
    incomeByCategory: r.incomeByCategory,
    months: r.months,
    netWorth: r.netWorth,
    budgets: r.budgets,
    transactions: r.transactions,
  };
  downloadText(JSON.stringify(payload, null, 2), `pfi-report-${slug(r.period)}.json`, 'application/json');
}

export async function exportReportPdf(r: Report, ds: DataSet, title: string): Promise<void> {
  const cur = ds.settings.baseCurrency;
  const accName = new Map(ds.accounts.map((a) => [a.id, a.name]));
  const catName = new Map(ds.categories.map((c) => [c.id, c.name]));
  await exportPdf(`pfi-report-${slug(r.period)}.pdf`, title, `Periodo: ${formatDate(r.period.start)} – ${formatDate(r.period.end)} · Valuta: ${cur}`, [
    { title: 'Riepilogo e confronto', head: ['Voce', 'Periodo', 'Precedente', 'Variazione'], body: reportSummaryRows(r, cur) },
    {
      title: 'Andamento mensile',
      head: ['Mese', 'Entrate', 'Uscite', 'Risparmio', 'Patrimonio a fine mese'],
      body: r.months.map((m) => [formatMonth(m.month, true), formatMoney(m.income, cur), formatMoney(m.expense, cur), formatMoney(m.net, cur), (() => { const p = r.netWorth.find((n) => n.month === m.month); return p ? formatMoney(p.netWorth, cur) : '—'; })()]),
    },
    {
      title: 'Spese per categoria',
      head: ['Categoria', 'Totale', 'Quota', 'Movimenti'],
      body: r.expenseByCategory.map((c) => [c.name, formatMoney(c.total, cur), formatPercent(c.share), String(c.count)]),
    },
    {
      title: 'Entrate per categoria',
      head: ['Categoria', 'Totale', 'Quota', 'Movimenti'],
      body: r.incomeByCategory.map((c) => [c.name, formatMoney(c.total, cur), formatPercent(c.share), String(c.count)]),
    },
    {
      title: 'Budget',
      head: ['Mese', 'Budget', 'Speso', 'Utilizzo'],
      body: r.budgets.map((b) => [formatMonth(b.month, true), formatMoney(b.budget, cur), formatMoney(b.spent, cur), formatPercent(b.budget > 0 ? b.spent / b.budget : null)]),
    },
    {
      title: `Movimenti (${r.transactions.length})`,
      head: ['Data', 'Descrizione', 'Conto', 'Categoria', 'Importo'],
      body: [...r.transactions]
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .slice(0, 2000)
        .map((t) => [
          formatDate(t.date),
          t.description.slice(0, 60),
          accName.get(t.accountId) ?? '',
          t.type === 'transfer' ? 'Trasferimento' : t.categoryId ? (catName.get(t.categoryId) ?? '') : '',
          formatMoney(t.amount, t.currency),
        ]),
    },
  ]);
}

