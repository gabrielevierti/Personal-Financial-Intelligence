/**
 * Logica finanziaria pura: nessuna dipendenza da React o dal database.
 * Tutte le funzioni sono deterministiche e lavorano su interi (centesimi).
 */
import type {
  Account,
  AccountType,
  AppSettings,
  Asset,
  AssetType,
  AssetValuation,
  Budget,
  Category,
  Cents,
  ISODate,
  ISOMonth,
  Period,
  SavingsGoal,
  Transaction,
} from '../types';
import { addMonths, currentMonth, daysBetween, monthEnd, monthOf, monthsBetween, todayISO } from '../utils/date';

export const LIQUID_TYPES: AccountType[] = ['checking', 'deposit', 'cash', 'debit_card'];
export const FINANCIAL_ASSET_TYPES: AssetType[] = ['stock', 'etf', 'bond', 'fund', 'crypto'];
/** Beni fisici: contano nel patrimonio ma non sono né liquidità né investimenti finanziari. */
export const PHYSICAL_ASSET_TYPES: AssetType[] = ['real_estate', 'vehicle', 'physical'];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: 'Conto corrente',
  deposit: 'Conto deposito',
  cash: 'Contanti',
  debit_card: 'Carta di debito',
  credit_card: 'Carta di credito',
  investment: 'Conto investimento',
  loan: 'Prestito / Mutuo',
  other: 'Altro asset',
};

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  liquidity: 'Liquidità',
  deposit: 'Depositi',
  stock: 'Azioni',
  etf: 'ETF',
  bond: 'Obbligazioni',
  fund: 'Fondi',
  crypto: 'Criptovalute',
  real_estate: 'Immobili',
  vehicle: 'Veicoli',
  physical: 'Beni fisici (orologi, gioielli, arte…)',
  other: 'Altri asset',
};

// ---------------------------------------------------------------------------
// Valute
// ---------------------------------------------------------------------------

/** Converte in valuta base usando i tassi manuali. null se il tasso manca. */
export function convert(cents: Cents, currency: string, settings: AppSettings): Cents | null {
  if (currency === settings.baseCurrency) return cents;
  const rate = settings.exchangeRates[currency];
  if (!rate || !Number.isFinite(rate) || rate <= 0) return null;
  return Math.round(cents * rate);
}

export interface Converter {
  (cents: Cents, currency: string): Cents;
  missing: Set<string>;
}

/** Crea un convertitore che registra le valute senza tasso (i loro importi vengono esclusi = 0). */
export function makeConverter(settings: AppSettings): Converter {
  const missing = new Set<string>();
  const fn = ((cents: Cents, currency: string) => {
    const v = convert(cents, currency, settings);
    if (v === null) {
      missing.add(currency);
      return 0;
    }
    return v;
  }) as Converter;
  fn.missing = missing;
  return fn;
}

// ---------------------------------------------------------------------------
// Saldi
// ---------------------------------------------------------------------------

export function accountBalance(account: Account, transactions: Transaction[], asOf?: ISODate): Cents {
  let bal = account.initialBalance;
  for (const t of transactions) {
    if (t.accountId !== account.id) continue;
    if (asOf && t.date > asOf) continue;
    bal += t.amount;
  }
  return bal;
}

export function balancesByAccount(accounts: Account[], transactions: Transaction[], asOf?: ISODate): Map<string, Cents> {
  const map = new Map<string, Cents>();
  for (const a of accounts) map.set(a.id, a.initialBalance);
  for (const t of transactions) {
    if (asOf && t.date > asOf) continue;
    const cur = map.get(t.accountId);
    if (cur !== undefined) map.set(t.accountId, cur + t.amount);
  }
  return map;
}

/** Storico saldo di un conto: un punto per ogni giorno con movimenti. */
export function balanceHistory(account: Account, transactions: Transaction[]): Array<{ date: ISODate; balance: Cents }> {
  const own = transactions.filter((t) => t.accountId === account.id).sort(compareTx);
  const out: Array<{ date: ISODate; balance: Cents }> = [];
  let bal = account.initialBalance;
  out.push({ date: account.createdAt, balance: bal });
  for (const t of own) {
    bal += t.amount;
    const last = out[out.length - 1];
    if (last.date === t.date) last.balance = bal;
    else out.push({ date: t.date, balance: bal });
  }
  return out;
}

export function compareTx(a: Transaction, b: Transaction): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Entrate / uscite
// ---------------------------------------------------------------------------

/**
 * Categorie di investimento (id con prefisso "inv-"): acquisti e vendite di titoli, piani di accumulo.
 * Non sono né spese né entrate: il denaro cambia forma ma resta tuo.
 */
export const INVEST_PREFIX = 'inv-';
export function isInvestmentFlow(t: Pick<Transaction, 'categoryId' | 'type'>): boolean {
  return t.type !== 'transfer' && !!t.categoryId && t.categoryId.startsWith(INVEST_PREFIX);
}

/** Importo investito netto da un movimento (positivo = acquisto, negativo = vendita). */
export function investedOf(t: Transaction): Cents {
  return isInvestmentFlow(t) ? -t.amount : 0;
}

/** Contributo di un movimento alle entrate (positivo) e alle uscite (positivo). Trasferimenti e investimenti esclusi. */
export function flowOf(t: Transaction): { income: Cents; expense: Cents } {
  if (isInvestmentFlow(t)) return { income: 0, expense: 0 };
  if (t.type === 'income') return { income: t.amount, expense: 0 };
  if (t.type === 'expense') return { income: 0, expense: -t.amount };
  return { income: 0, expense: 0 };
}

export function inPeriod(t: { date: ISODate }, p: { start: ISODate; end: ISODate }): boolean {
  return t.date >= p.start && t.date <= p.end;
}

export interface PeriodSummary {
  /** Investito netto nel periodo (acquisti − vendite di titoli): non è una spesa. */
  invested: Cents;
  income: Cents;
  expense: Cents;
  net: Cents;
  /** (entrate - uscite) / entrate; null se entrate <= 0 */
  savingRate: number | null;
  /** uscite / entrate; null se entrate <= 0 */
  expenseRatio: number | null;
  transactionCount: number;
  months: number;
  avgMonthlyExpense: Cents;
  avgMonthlyIncome: Cents;
}

export function summarize(transactions: Transaction[], period: Period, conv: Converter, excludeIds?: Set<string>): PeriodSummary {
  let income = 0;
  let expense = 0;
  let invested = 0;
  let count = 0;
  for (const t of transactions) {
    if (!inPeriod(t, period)) continue;
    if (t.type === 'transfer') continue;
    if (excludeIds?.has(t.id)) continue;
    invested += conv(investedOf(t), t.currency);
    const f = flowOf(t);
    income += conv(f.income, t.currency);
    expense += conv(f.expense, t.currency);
    count++;
  }
  const months = Math.max(1, monthsBetween(period.start, period.end).length);
  const net = income - expense;
  return {
    income,
    expense,
    net,
    invested,
    savingRate: income > 0 ? net / income : null,
    expenseRatio: income > 0 ? expense / income : null,
    transactionCount: count,
    months,
    avgMonthlyExpense: Math.round(expense / months),
    avgMonthlyIncome: Math.round(income / months),
  };
}

export interface CategoryTotal {
  categoryId: string | null;
  name: string;
  color: string;
  total: Cents;
  share: number;
  count: number;
}

export function totalsByCategory(
  transactions: Transaction[],
  period: { start: ISODate; end: ISODate },
  kind: 'income' | 'expense',
  categories: Category[],
  conv: Converter,
): CategoryTotal[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const totals = new Map<string | null, { total: Cents; count: number }>();
  for (const t of transactions) {
    if (t.type !== kind || !inPeriod(t, period) || isInvestmentFlow(t)) continue;
    const f = flowOf(t);
    const v = conv(kind === 'income' ? f.income : f.expense, t.currency);
    const key = t.categoryId;
    const cur = totals.get(key) ?? { total: 0, count: 0 };
    cur.total += v;
    cur.count++;
    totals.set(key, cur);
  }
  const grand = Array.from(totals.values()).reduce((s, x) => s + Math.max(0, x.total), 0);
  return Array.from(totals.entries())
    .map(([id, v]) => {
      const c = id ? byId.get(id) : undefined;
      return {
        categoryId: id,
        name: c?.name ?? 'Senza categoria',
        color: c?.color ?? '#7d8a83',
        total: v.total,
        count: v.count,
        share: grand > 0 ? Math.max(0, v.total) / grand : 0,
      };
    })
    .filter((x) => x.total !== 0)
    .sort((a, b) => b.total - a.total);
}

export interface MonthPoint {
  month: ISOMonth;
  income: Cents;
  expense: Cents;
  net: Cents;
  cumulativeSavings: Cents;
  savingRate: number | null;
}

export function monthlySeries(transactions: Transaction[], months: ISOMonth[], conv: Converter, excludeIds?: Set<string>): MonthPoint[] {
  const idx = new Map(months.map((m, i) => [m, i]));
  const inc = new Array<number>(months.length).fill(0);
  const exp = new Array<number>(months.length).fill(0);
  for (const t of transactions) {
    if (t.type === 'transfer') continue;
    if (excludeIds?.has(t.id)) continue;
    const i = idx.get(monthOf(t.date));
    if (i === undefined) continue;
    const f = flowOf(t);
    inc[i] += conv(f.income, t.currency);
    exp[i] += conv(f.expense, t.currency);
  }
  let cum = 0;
  return months.map((month, i) => {
    const net = inc[i] - exp[i];
    cum += net;
    return { month, income: inc[i], expense: exp[i], net, cumulativeSavings: cum, savingRate: inc[i] > 0 ? net / inc[i] : null };
  });
}

// ---------------------------------------------------------------------------
// Patrimonio
// ---------------------------------------------------------------------------

export function assetValue(a: Pick<Asset, 'quantity' | 'currentPrice'>): Cents {
  return Math.round(a.quantity * a.currentPrice);
}

export function assetCost(a: Pick<Asset, 'quantity' | 'purchasePrice'>): Cents {
  return Math.round(a.quantity * a.purchasePrice);
}

export interface AssetMetrics {
  value: Cents;
  cost: Cents;
  pnl: Cents;
  performance: number | null;
}

export function assetMetrics(a: Asset): AssetMetrics {
  const value = assetValue(a);
  const cost = assetCost(a);
  return { value, cost, pnl: value - cost, performance: cost > 0 ? (value - cost) / cost : null };
}

export function portfolioMetrics(assets: Asset[], conv: Converter): AssetMetrics {
  let value = 0;
  let cost = 0;
  for (const a of assets) {
    const m = assetMetrics(a);
    value += conv(m.value, a.currency);
    cost += conv(m.cost, a.currency);
  }
  return { value, cost, pnl: value - cost, performance: cost > 0 ? (value - cost) / cost : null };
}

/** Valore unitario di un asset a una certa data, usando lo storico valutazioni. */
export function assetValueAt(asset: Asset, valuations: AssetValuation[], date: ISODate): Cents {
  let best: AssetValuation | undefined;
  for (const v of valuations) {
    if (v.assetId !== asset.id || v.date > date) continue;
    if (!best || v.date > best.date || (v.date === best.date && v.id > best.id)) best = v;
  }
  if (!best) return 0; // l'asset non esisteva ancora (nessuna valutazione registrata)
  return Math.round(best.quantity * best.unitPrice);
}

export interface NetWorthSnapshot {
  netWorth: Cents;
  liquidity: Cents;
  /** Capitale investito: conti investimento, asset finanziari e acquisti di titoli registrati (al costo). */
  investments: Cents;
  debts: Cents;
  accountsTotal: Cents;
  assetsTotal: Cents;
  /** Immobili, veicoli e altri beni fisici (valori stimati dall'utente). */
  physical: Cents;
  /** Titoli acquistati dai conti (categorie "inv-"), valutati al costo, non al prezzo di mercato. */
  investedAtCost: Cents;
}

export interface NetWorthOptions {
  /**
   * Conta nel patrimonio gli acquisti di titoli registrati come movimenti (al costo).
   * Da disattivare se gli stessi titoli sono inseriti anche come asset, per non contarli due volte.
   */
  costBasis?: boolean;
  /** Fotografia a una data passata (saldi e valutazioni a quella data). */
  asOf?: ISODate;
  valuations?: AssetValuation[];
}

/** Investito netto al costo fino a una data (acquisti − vendite registrati come movimenti). */
export function investedAtCost(transactions: Transaction[], conv: Converter, asOf?: ISODate): Cents {
  let v = 0;
  for (const t of transactions) {
    if (asOf && t.date > asOf) continue;
    v += conv(investedOf(t), t.currency);
  }
  return Math.max(0, v);
}

export function netWorthSnapshot(
  accounts: Account[],
  transactions: Transaction[],
  assets: Asset[],
  conv: Converter,
  opts: NetWorthOptions = {},
): NetWorthSnapshot {
  const asOf = opts.asOf;
  const balances = balancesByAccount(accounts, transactions, asOf);
  let liquidity = 0;
  let investmentAccounts = 0;
  let debts = 0;
  let accountsTotal = 0;
  for (const a of accounts) {
    if (asOf && a.createdAt > asOf && !transactions.some((t) => t.accountId === a.id && t.date <= asOf)) continue;
    const bal = conv(balances.get(a.id) ?? 0, a.currency);
    accountsTotal += bal;
    if (bal < 0) debts += -bal;
    else if (LIQUID_TYPES.includes(a.type)) liquidity += bal;
    else if (a.type === 'investment') investmentAccounts += bal;
  }
  let assetsTotal = 0;
  let financialAssets = 0;
  let physical = 0;
  for (const as of assets) {
    const v = conv(asOf ? assetValueAt(as, opts.valuations ?? [], asOf) : assetValue(as), as.currency);
    assetsTotal += v;
    if (FINANCIAL_ASSET_TYPES.includes(as.type)) financialAssets += v;
    else if (PHYSICAL_ASSET_TYPES.includes(as.type)) physical += v;
  }
  const atCost = opts.costBasis === false ? 0 : investedAtCost(transactions, conv, asOf);
  return {
    netWorth: accountsTotal + assetsTotal + atCost,
    liquidity,
    investments: investmentAccounts + financialAssets + atCost,
    debts,
    accountsTotal,
    assetsTotal,
    physical,
    investedAtCost: atCost,
  };
}

/**
 * Data da cui il patrimonio è "completo": per ogni conto conta il primo giorno con dati
 * (creazione o primo movimento); prima di quella data il saldo di almeno un conto non è noto.
 * Restituisce null se non ci sono conti.
 */
export function dataCoverageStart(accounts: Account[], transactions: Transaction[]): ISODate | null {
  if (!accounts.length) return null;
  const firstTx = new Map<string, ISODate>();
  for (const t of transactions) {
    const cur = firstTx.get(t.accountId);
    if (!cur || t.date < cur) firstTx.set(t.accountId, t.date);
  }
  let coverage: ISODate | null = null;
  for (const a of accounts) {
    const ft = firstTx.get(a.id);
    const start = ft && ft < a.createdAt ? ft : a.createdAt;
    if (!coverage || start > coverage) coverage = start;
  }
  return coverage;
}

export interface NetWorthPoint {
  month: ISOMonth;
  accounts: Cents;
  assets: Cents;
  netWorth: Cents;
}

/** Evoluzione del patrimonio a fine mese. */
export function netWorthSeries(
  accounts: Account[],
  transactions: Transaction[],
  assets: Asset[],
  valuations: AssetValuation[],
  months: ISOMonth[],
  conv: Converter,
  opts: NetWorthOptions = {},
): NetWorthPoint[] {
  const today = todayISO();
  return months.map((month) => {
    const end = monthEnd(month) < today ? monthEnd(month) : today;
    let acc = 0;
    for (const a of accounts) {
      if (a.createdAt > end) {
        // conto creato dopo: conta solo se ha movimenti precedenti
        const hasEarlier = transactions.some((t) => t.accountId === a.id && t.date <= end);
        if (!hasEarlier) continue;
      }
      acc += conv(accountBalance(a, transactions, end), a.currency);
    }
    let ast = 0;
    for (const as of assets) ast += conv(assetValueAt(as, valuations, end), as.currency);
    if (opts.costBasis !== false) ast += investedAtCost(transactions, conv, end);
    return { month, accounts: acc, assets: ast, netWorth: acc + ast };
  });
}

export interface AllocationSlice {
  key: string;
  label: string;
  value: Cents;
  share: number;
}

export function allocation(accounts: Account[], transactions: Transaction[], assets: Asset[], conv: Converter, opts: NetWorthOptions = {}): AllocationSlice[] {
  const balances = balancesByAccount(accounts, transactions);
  const groups = new Map<string, { label: string; value: Cents }>();
  const add = (key: string, label: string, v: Cents) => {
    if (v <= 0) return;
    const g = groups.get(key) ?? { label, value: 0 };
    g.value += v;
    groups.set(key, g);
  };
  for (const a of accounts) {
    const bal = conv(balances.get(a.id) ?? 0, a.currency);
    if (LIQUID_TYPES.includes(a.type)) add('acc-liquidity', 'Liquidità (conti)', bal);
    else if (a.type === 'investment') add('acc-investment', 'Conti investimento', bal);
    else if (a.type === 'other') add('acc-other', 'Altri conti', bal);
  }
  for (const as of assets) add(`asset-${as.type}`, ASSET_TYPE_LABELS[as.type], conv(assetValue(as), as.currency));
  if (opts.costBasis !== false) add('invested-cost', 'Titoli acquistati (al costo)', investedAtCost(transactions, conv));
  const total = Array.from(groups.values()).reduce((s, g) => s + g.value, 0);
  return Array.from(groups.entries())
    .map(([key, g]) => ({ key, label: g.label, value: g.value, share: total > 0 ? g.value / total : 0 }))
    .sort((a, b) => b.value - a.value);
}

// ---------------------------------------------------------------------------
// Indicatori di salute finanziaria
// ---------------------------------------------------------------------------

/** Media delle spese mensili sugli ultimi N mesi completi che hanno almeno un movimento. */
export function averageMonthlyExpense(transactions: Transaction[], conv: Converter, lookbackMonths = 6, refMonth = currentMonth()): Cents {
  const months: ISOMonth[] = [];
  for (let i = lookbackMonths; i >= 1; i--) months.push(addMonths(refMonth, -i));
  const series = monthlySeries(transactions, months, conv);
  const withData = series.filter((p) => p.income !== 0 || p.expense !== 0);
  if (withData.length === 0) {
    // nessun mese completo: usa il mese corrente se ha dati
    const cur = monthlySeries(transactions, [refMonth], conv)[0];
    return cur.expense > 0 ? cur.expense : 0;
  }
  return Math.round(withData.reduce((s, p) => s + p.expense, 0) / withData.length);
}

/** Copertura del fondo di emergenza in mesi. null se non ci sono spese. */
export function emergencyCoverage(liquidity: Cents, avgMonthlyExpense: Cents): number | null {
  if (avgMonthlyExpense <= 0) return null;
  return liquidity / avgMonthlyExpense;
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

export type BudgetLevel = 'ok' | 'warning75' | 'warning90' | 'exceeded';

export function budgetLevel(spent: Cents, limit: Cents): BudgetLevel {
  if (limit <= 0) return spent > 0 ? 'exceeded' : 'ok';
  const r = spent / limit;
  if (r > 1) return 'exceeded';
  if (r >= 0.9) return 'warning90';
  if (r >= 0.75) return 'warning75';
  return 'ok';
}

export interface BudgetStatus {
  budget: Budget;
  spent: Cents;
  remaining: Cents;
  usage: number;
  level: BudgetLevel;
}

export function budgetStatuses(budgets: Budget[], transactions: Transaction[], month: ISOMonth, conv: Converter): BudgetStatus[] {
  const monthTx = transactions.filter((t) => t.type === 'expense' && !isInvestmentFlow(t) && monthOf(t.date) === month);
  const spentByCat = new Map<string | null, Cents>();
  let totalSpent = 0;
  for (const t of monthTx) {
    const v = conv(-t.amount, t.currency);
    totalSpent += v;
    spentByCat.set(t.categoryId, (spentByCat.get(t.categoryId) ?? 0) + v);
  }
  return budgets
    .filter((b) => b.month === month)
    .map((b) => {
      const spent = b.categoryId === null ? totalSpent : (spentByCat.get(b.categoryId) ?? 0);
      return {
        budget: b,
        spent,
        remaining: b.limit - spent,
        usage: b.limit > 0 ? spent / b.limit : spent > 0 ? Infinity : 0,
        level: budgetLevel(spent, b.limit),
      };
    });
}

// ---------------------------------------------------------------------------
// Obiettivi di risparmio
// ---------------------------------------------------------------------------

/** Mesi di calendario interi tra due date (es. 2024-01-15 → 2024-03-14 = 1). */
export function calendarMonthsBetween(a: ISODate, b: ISODate): number {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  let m = (y2 - y1) * 12 + (m2 - m1);
  if (d2 < d1) m -= 1;
  return m;
}

export interface GoalProgress {
  progress: number;
  remaining: Cents;
  /** Risparmio mensile necessario per arrivare alla data obiettivo; null senza data. */
  monthlyNeeded: Cents | null;
  monthsLeft: number | null;
  /** Mesi stimati al ritmo di risparmio indicato; null se non stimabile. */
  estimatedMonths: number | null;
  completed: boolean;
  overdue: boolean;
}

export function goalProgress(goal: SavingsGoal, avgMonthlySavings: Cents, today: ISODate = todayISO()): GoalProgress {
  const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);
  const progress = goal.targetAmount > 0 ? Math.min(1, goal.currentAmount / goal.targetAmount) : 0;
  const completed = goal.currentAmount >= goal.targetAmount && goal.targetAmount > 0;
  let monthsLeft: number | null = null;
  let monthlyNeeded: Cents | null = null;
  let overdue = false;
  if (goal.targetDate) {
    const days = daysBetween(today, goal.targetDate);
    overdue = days < 0 && !completed;
    monthsLeft = days <= 0 ? 0 : Math.max(1, calendarMonthsBetween(today, goal.targetDate));
    monthlyNeeded = completed ? 0 : monthsLeft > 0 ? Math.ceil(remaining / monthsLeft) : remaining;
  }
  const estimatedMonths = completed ? 0 : avgMonthlySavings > 0 ? Math.ceil(remaining / avgMonthlySavings) : null;
  return { progress, remaining, monthlyNeeded, monthsLeft, estimatedMonths, completed, overdue };
}

// ---------------------------------------------------------------------------
// Beni fisici
// ---------------------------------------------------------------------------

/**
 * Stima del valore di un bene che si deprezza (es. un'auto) con ammortamento a quote decrescenti:
 * valore = costo × (1 − tasso)^anni. È una STIMA: il valore reale dipende dal mercato.
 */
export function estimateDepreciatedValue(cost: Cents, purchaseDate: ISODate, annualRatePct: number, today: ISODate = todayISO()): Cents {
  if (!(annualRatePct > 0) || annualRatePct >= 100) return cost;
  const years = Math.max(0, daysBetween(purchaseDate, today) / 365.25);
  return Math.round(cost * Math.pow(1 - annualRatePct / 100, years));
}
