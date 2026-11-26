import { describe, expect, it } from 'vitest';
import {
  accountBalance,
  allocation,
  assetMetrics,
  averageMonthlyExpense,
  balanceHistory,
  budgetLevel,
  budgetStatuses,
  convert,
  emergencyCoverage,
  goalProgress,
  makeConverter,
  monthlySeries,
  netWorthSeries,
  netWorthSnapshot,
  portfolioMetrics,
  summarize,
  totalsByCategory,
} from '../../services/finance';
import { DEFAULT_CATEGORIES } from '../../database/seed';
import { account, asset, settings, tx } from '../fixtures';

const cats = DEFAULT_CATEGORIES.map((c) => ({ ...c, isDefault: true }));
const period = { start: '2024-01-01', end: '2024-01-31', label: '' };

describe('saldi', () => {
  it('saldo = iniziale + movimenti', () => {
    const a = account({ initialBalance: 100000 });
    const txs = [tx({ amount: 250000, type: 'income' }), tx({ amount: -12345 }), tx({ accountId: 'other', amount: -99999 })];
    expect(accountBalance(a, txs)).toBe(337655);
    expect(accountBalance(a, txs, '2023-12-31')).toBe(100000);
  });
  it('storico saldo cumulativo', () => {
    const a = account({ initialBalance: 1000 });
    const h = balanceHistory(a, [tx({ date: '2024-01-05', amount: -100 }), tx({ date: '2024-01-05', amount: -100 }), tx({ date: '2024-01-07', amount: 500, type: 'income' })]);
    expect(h).toEqual([
      { date: '2024-01-01', balance: 1000 },
      { date: '2024-01-05', balance: 800 },
      { date: '2024-01-07', balance: 1300 },
    ]);
  });
});

describe('riepilogo periodo', () => {
  const conv = () => makeConverter(settings);
  it('esclude i trasferimenti da entrate e uscite', () => {
    const txs = [
      tx({ amount: 300000, type: 'income', categoryId: 'inc-salary' }),
      tx({ amount: -50000 }),
      tx({ amount: -100000, type: 'transfer', categoryId: null, transferId: 'x' }),
      tx({ accountId: 'a2', amount: 100000, type: 'transfer', categoryId: null, transferId: 'x' }),
    ];
    const s = summarize(txs, period, conv());
    expect(s.income).toBe(300000);
    expect(s.expense).toBe(50000);
    expect(s.net).toBe(250000);
    expect(s.savingRate).toBeCloseTo(250000 / 300000);
    expect(s.expenseRatio).toBeCloseTo(50000 / 300000);
  });
  it('saving rate null senza entrate', () => {
    expect(summarize([tx()], period, conv()).savingRate).toBeNull();
  });
  it('un rimborso registrato come spesa positiva riduce le uscite', () => {
    const s = summarize([tx({ amount: -10000 }), tx({ amount: 2500, type: 'expense' })], period, conv());
    expect(s.expense).toBe(7500);
  });
  it('converte le valute con i tassi manuali ed elenca quelle mancanti', () => {
    const c = conv();
    const s = summarize([tx({ amount: -10000, currency: 'USD' }), tx({ amount: -10000, currency: 'GBP' })], period, c);
    expect(s.expense).toBe(9000);
    expect([...c.missing]).toEqual(['GBP']);
    expect(convert(100, 'EUR', settings)).toBe(100);
    expect(convert(100, 'JPY', settings)).toBeNull();
  });
  it('per categoria con quote', () => {
    const t = totalsByCategory([tx({ amount: -3000 }), tx({ amount: -1000, categoryId: 'exp-home' }), tx({ amount: -1000, categoryId: 'exp-home' })], period, 'expense', cats, conv());
    expect(t.map((x) => [x.name, x.total])).toEqual([
      ['Alimentari', 3000],
      ['Casa', 2000],
    ]);
    expect(t[0].share).toBeCloseTo(0.6);
  });
  it('serie mensile e risparmio cumulato', () => {
    const s = monthlySeries(
      [tx({ date: '2024-01-05', amount: 1000, type: 'income' }), tx({ date: '2024-02-05', amount: -300 }), tx({ date: '2024-03-01', amount: 200, type: 'income' })],
      ['2024-01', '2024-02', '2024-03'],
      conv(),
    );
    expect(s.map((p) => p.cumulativeSavings)).toEqual([1000, 700, 900]);
  });
});

describe('patrimonio', () => {
  const conv = () => makeConverter(settings);
  it('snapshot: liquidità, investimenti, debiti', () => {
    const accounts = [
      account({ id: 'c', type: 'checking', initialBalance: 500000 }),
      account({ id: 'cc', type: 'credit_card', initialBalance: 0 }),
      account({ id: 'inv', type: 'investment', initialBalance: 200000 }),
      account({ id: 'loan', type: 'loan', initialBalance: -1000000 }),
    ];
    const txs = [tx({ accountId: 'cc', amount: -30000 })];
    const snap = netWorthSnapshot(accounts, txs, [asset(), asset({ id: 'h', type: 'real_estate', quantity: 1, currentPrice: 20000000 })], conv());
    expect(snap.liquidity).toBe(500000);
    expect(snap.debts).toBe(1030000);
    expect(snap.investments).toBe(200000 + 120000);
    expect(snap.netWorth).toBe(500000 - 30000 + 200000 - 1000000 + 120000 + 20000000);
  });
  it('metriche asset e portafoglio', () => {
    const m = assetMetrics(asset({ quantity: 2.5, purchasePrice: 1000, currentPrice: 1200 }));
    expect(m).toEqual({ value: 3000, cost: 2500, pnl: 500, performance: 0.2 });
    const p = portfolioMetrics([asset(), asset({ id: 'u', currency: 'USD', quantity: 1, purchasePrice: 1000, currentPrice: 2000 })], conv());
    expect(p.value).toBe(120000 + 1800);
    expect(p.cost).toBe(100000 + 900);
  });
  it('allocazione', () => {
    const al = allocation([account({ initialBalance: 100000 })], [], [asset()], conv());
    expect(al.map((s) => s.key)).toEqual(['asset-etf', 'acc-liquidity']);
    expect(al.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1);
  });
  it('serie patrimonio usa lo storico valutazioni', () => {
    const a = account({ initialBalance: 1000, createdAt: '2024-01-01' });
    const as = asset({ quantity: 1, currentPrice: 300 });
    const vals = [
      { id: 'v1', assetId: 'as1', date: '2024-01-15', unitPrice: 100, quantity: 1 },
      { id: 'v2', assetId: 'as1', date: '2024-03-01', unitPrice: 300, quantity: 1 },
    ];
    const s = netWorthSeries([a], [tx({ date: '2024-02-10', amount: -200 })], [as], vals, ['2024-01', '2024-02', '2024-03'], conv());
    expect(s.map((p) => p.netWorth)).toEqual([1100, 900, 1100]);
  });
});

describe('indicatori', () => {
  it('copertura fondo emergenza', () => {
    expect(emergencyCoverage(600000, 200000)).toBe(3);
    expect(emergencyCoverage(1000, 0)).toBeNull();
  });
  it('media spese mensili sui mesi con dati', () => {
    const c = makeConverter(settings);
    const txs = [tx({ date: '2024-03-10', amount: -1000 }), tx({ date: '2024-04-10', amount: -3000 })];
    expect(averageMonthlyExpense(txs, c, 6, '2024-05')).toBe(2000);
  });
});

describe('budget', () => {
  it('livelli di avviso 75/90/100', () => {
    expect(budgetLevel(7400, 10000)).toBe('ok');
    expect(budgetLevel(7500, 10000)).toBe('warning75');
    expect(budgetLevel(9000, 10000)).toBe('warning90');
    expect(budgetLevel(10000, 10000)).toBe('warning90');
    expect(budgetLevel(10001, 10000)).toBe('exceeded');
  });
  it('consumo per categoria e totale', () => {
    const b = [
      { id: 'b1', month: '2024-01', categoryId: 'exp-groceries', limit: 10000 },
      { id: 'b2', month: '2024-01', categoryId: null, limit: 20000 },
      { id: 'b3', month: '2024-02', categoryId: null, limit: 1 },
    ];
    const st = budgetStatuses(b, [tx({ amount: -8000 }), tx({ amount: -5000, categoryId: 'exp-home' }), tx({ amount: -100, type: 'transfer' })], '2024-01', makeConverter(settings));
    expect(st).toHaveLength(2);
    expect(st[0]).toMatchObject({ spent: 8000, remaining: 2000, level: 'warning75' });
    expect(st[1]).toMatchObject({ spent: 13000, remaining: 7000, level: 'ok' });
  });
});

describe('obiettivi', () => {
  const g = { id: 'g', name: 'Auto', targetAmount: 1200000, currentAmount: 200000, targetDate: '2025-01-01', priority: 'high' as const, description: '', createdAt: '2024-01-01' };
  it('calcola avanzamento, mensile necessario e tempo stimato', () => {
    const p = goalProgress(g, 100000, '2024-01-01');
    expect(p.progress).toBeCloseTo(1 / 6);
    expect(p.remaining).toBe(1000000);
    expect(p.monthsLeft).toBe(12);
    expect(p.monthlyNeeded).toBe(83334);
    expect(p.estimatedMonths).toBe(10);
  });
  it('stima non disponibile senza risparmio positivo', () => {
    expect(goalProgress({ ...g, targetDate: null }, -5, '2024-01-01')).toMatchObject({ estimatedMonths: null, monthlyNeeded: null });
  });
  it('obiettivo completato e scaduto', () => {
    expect(goalProgress({ ...g, currentAmount: 1300000 }, 0, '2024-01-01')).toMatchObject({ completed: true, progress: 1, remaining: 0 });
    expect(goalProgress(g, 0, '2025-06-01').overdue).toBe(true);
  });
});
