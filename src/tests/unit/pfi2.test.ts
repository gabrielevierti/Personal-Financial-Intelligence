import { describe, expect, it } from 'vitest';
import { estimateDepreciatedValue, investedAtCost, isInvestmentFlow, makeConverter, netWorthSnapshot, summarize, totalsByCategory } from '../../services/finance';
import { monthEndForecast, occurrences, projectLiquidity, shiftMonths, type ForecastInput } from '../../services/forecast';
import { computeKpis } from '../../services/kpis';
import { financialInsights } from '../../services/financialInsights';
import { detectTransfers, institutionTokens } from '../../services/transfers';
import { builtinCategory } from '../../services/categorize';
import { simulateInvestment } from '../../services/simulation';
import { DEFAULT_CATEGORIES } from '../../database/seed';
import type { DataSet } from '../../services/reports';
import type { ScheduledItem } from '../../types';
import { account, asset, settings, tx } from '../fixtures';

const conv = makeConverter(settings);
const cats = DEFAULT_CATEGORIES.map((c) => ({ ...c, isDefault: true }));
const period = { start: '2026-11-01', end: '2026-11-30', label: '' };

describe('uscite reali: investimenti e giroconti esclusi', () => {
  const txs = [
    tx({ date: '2026-11-02', amount: 200000, type: 'income', categoryId: 'inc-salary' }),
    tx({ date: '2026-11-03', amount: -170000, categoryId: 'exp-groceries' }),
    tx({ date: '2026-11-04', amount: -50000, categoryId: 'inv-buy', description: 'Buy trade VWCE' }),
    tx({ date: '2026-11-05', amount: 10000, type: 'income', categoryId: 'inv-sell', description: 'Sell trade' }),
    tx({ date: '2026-11-06', amount: -150000, type: 'transfer', categoryId: null }),
  ];
  it('le uscite contano solo le spese', () => {
    const s = summarize(txs, period, conv);
    expect(s.expense).toBe(170000);
    expect(s.income).toBe(200000);
    expect(s.invested).toBe(40000);
    expect(s.net).toBe(30000);
  });
  it('le categorie di investimento non compaiono nelle spese per categoria', () => {
    const t = totalsByCategory(txs, period, 'expense', cats, conv);
    expect(t.map((c) => c.categoryId)).toEqual(['exp-groceries']);
  });
  it('gli acquisti di titoli restano nel patrimonio, al costo', () => {
    const a = account({ initialBalance: 0, createdAt: '2026-11-01' });
    const snap = netWorthSnapshot([a], txs, [], conv);
    expect(snap.investedAtCost).toBe(40000);
    expect(snap.investments).toBe(40000);
    // patrimonio = saldo conto (200000-170000-50000+10000-150000) + investito al costo
    expect(snap.netWorth).toBe(-160000 + 40000);
    expect(netWorthSnapshot([a], txs, [], conv, { costBasis: false }).investedAtCost).toBe(0);
    expect(investedAtCost(txs, conv, '2026-11-04')).toBe(50000);
  });
  it('riconosce acquisti e vendite di titoli dalla descrizione', () => {
    expect(builtinCategory('Buy trade IE00BK5BQT80 Vanguard', 'expense')).toBe('inv-buy');
    expect(builtinCategory('Esecuzione piano di accumulo', 'expense')).toBe('inv-buy');
    expect(builtinCategory('Sell trade Apple', 'income')).toBe('inv-sell');
    expect(isInvestmentFlow({ type: 'transfer', categoryId: 'inv-buy' })).toBe(false);
  });
});

describe('giroconto riconosciuto dal nome della banca dell’altro conto', () => {
  it('Fineco → "Trade Republic Bank GmbH" è certo se l’altro conto è Trade Republic', () => {
    expect(institutionTokens('Trade Republic Bank GmbH')).toEqual(['trade', 'republic']);
    const accounts = [
      { id: 'fineco', currency: 'EUR', institution: 'FinecoBank' },
      { id: 'tr', currency: 'EUR', institution: 'Trade Republic' },
    ];
    const out = tx({ id: 'o', accountId: 'fineco', date: '2026-11-10', amount: -150000, description: 'Bonifico SEPA a favore di Trade Republic Bank GmbH' });
    const inn = tx({ id: 'i', accountId: 'tr', date: '2026-11-11', amount: 150000, type: 'income', description: 'Incoming transfer' });
    const r = detectTransfers([out, inn], accounts, []);
    expect(r[0]).toMatchObject({ certain: true, reasons: ['nome della banca del tuo altro conto'] });
  });
});

describe('beni fisici', () => {
  it('stima del deprezzamento a quote decrescenti', () => {
    expect(estimateDepreciatedValue(2000000, '2024-11-26', 15, '2026-11-26')).toBeCloseTo(2000000 * 0.85 * 0.85, -3);
    expect(estimateDepreciatedValue(2000000, '2024-11-26', 0, '2026-11-26')).toBe(2000000);
  });
  it('il veicolo conta nel patrimonio ma non negli investimenti né nella liquidità', () => {
    const car = asset({ id: 'car', type: 'vehicle', quantity: 1, currentPrice: 1500000, purchasePrice: 2000000 });
    const s = netWorthSnapshot([], [], [car], conv);
    expect(s.netWorth).toBe(1500000);
    expect(s.physical).toBe(1500000);
    expect(s.investments).toBe(0);
    expect(s.liquidity).toBe(0);
  });
});

const item = (p: Partial<ScheduledItem>): ScheduledItem => ({ id: 'x', name: 'Affitto', kind: 'rent', amount: -80000, currency: 'EUR', frequency: 'monthly', nextDate: '2026-12-01', fixedAmount: true, ...p });

describe('previsione di fine mese', () => {
  it('scadenze ricorrenti con fine mese corretta', () => {
    expect(shiftMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(occurrences(item({ nextDate: '2026-01-31' }), '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(occurrences(item({ frequency: 'once', nextDate: '2026-02-10' }), '2026-01-01', '2026-01-31')).toEqual([]);
    expect(occurrences(item({ frequency: 'quarterly', nextDate: '2026-01-15', endDate: '2026-06-30' }), '2026-01-01', '2026-12-31')).toEqual(['2026-01-15', '2026-04-15']);
  });
  const base: ForecastInput = {
    today: '2026-11-20',
    liquidityNow: 300000,
    incomeSoFar: 200000,
    expenseSoFar: 120000,
    scheduled: [item({ nextDate: '2026-11-25', amount: -80000 }), item({ id: 'b', name: 'Luce', kind: 'bill', nextDate: '2026-11-28', amount: -6000, fixedAmount: false })],
    recurring: [{ merchant: 'netflix', description: 'Netflix', categoryId: 'exp-subscriptions', kind: 'expense', amount: 1299, months: 6, lastDate: '2026-10-27', nextExpected: '2026-11-27', chargedThisMonth: false }],
    dailyVariable: 1000,
    remainingBudget: null,
    conv,
  };
  it('separa certo, programmato e stimato', () => {
    const f = monthEndForecast(base);
    expect(f.daysLeft).toBe(10);
    expect(f.scheduled).toEqual({ income: 0, expense: 80000 });
    expect(f.estimated.expense).toBe(6000 + 1299 + 10000);
    expect(f.estimated.variableBasis).toBe('media');
    expect(f.forecastBalance).toBe(300000 - 80000 - 6000 - 1299 - 10000);
    expect(f.expectedExpense).toBe(120000 + 80000 + 17299);
    expect(f.margin).toBe(200000 - 217299);
  });
  it('usa il budget residuo quando c’è un budget totale', () => {
    const f = monthEndForecast({ ...base, remainingBudget: 25000 });
    expect(f.estimated.variableBasis).toBe('budget');
    expect(f.estimated.expense).toBe(6000 + 1299 + 25000);
  });
  it('un ricorrente già pianificato non viene contato due volte', () => {
    const f = monthEndForecast({ ...base, scheduled: [...base.scheduled, item({ id: 'n', name: 'Netflix', kind: 'subscription', amount: -1299, nextDate: '2026-11-27', merchant: 'netflix' })] });
    expect(f.scheduled.expense).toBe(80000 + 1299);
    expect(f.estimated.expense).toBe(6000 + 10000);
  });
  it('proiezioni a 3, 6, 12 mesi', () => {
    const p = projectLiquidity({ ...base, scheduled: [item({ nextDate: '2026-12-01' }), item({ id: 's', name: 'Stipendio', kind: 'income', amount: 200000, nextDate: '2026-12-27' })], recurring: [] });
    expect(p.map((x) => x.months)).toEqual([3, 6, 12]);
    const start = monthEndForecast({ ...base, scheduled: [], recurring: [] }).forecastBalance;
    // 3 mesi: dic, gen, feb → 3 × (200000 − 80000) programmati, − 3 × 30400 variabili
    expect(p[0].scheduledNet).toBe(3 * 120000);
    expect(p[0].estimatedNet).toBe(-3 * 30400);
    expect(p[0].balance).toBe(start + 360000 - 91200);
  });
});

describe('KPI', () => {
  const ds: DataSet = {
    accounts: [account({ id: 'a1', initialBalance: 100000, createdAt: '2026-09-01' }), account({ id: 'inv', type: 'investment', initialBalance: 500000, createdAt: '2026-09-01' })],
    transactions: [
      tx({ date: '2026-10-05', amount: 200000, type: 'income', categoryId: 'inc-salary' }),
      tx({ date: '2026-10-10', amount: -100000 }),
      tx({ date: '2026-11-05', amount: 200000, type: 'income', categoryId: 'inc-salary' }),
      tx({ date: '2026-11-10', amount: -150000 }),
    ],
    categories: cats,
    budgets: [],
    assets: [asset({ type: 'vehicle', quantity: 1, currentPrice: 1000000 })],
    valuations: [{ id: 'v1', assetId: 'as1', date: '2026-09-01', unitPrice: 1000000, quantity: 1 }],
    settings,
  };
  const k = computeKpis(ds, period, { today: '2026-11-26' });
  it('patrimonio, liquidità e investito sono distinti', () => {
    expect(k.kpis.liquidity.value).toBe(250000);
    expect(k.kpis.investments.value).toBe(500000);
    expect(k.kpis.netWorth.value).toBe(250000 + 500000 + 1000000);
  });
  it('confronto con il periodo precedente', () => {
    expect(k.kpis.expense.value).toBe(150000);
    expect(k.kpis.expense.previous).toBe(100000);
    expect(k.kpis.expense.delta).toBe(50000);
    expect(k.kpis.savingsRate.value).toBeCloseTo(0.25);
    expect(k.kpis.liquidity.previous).toBe(200000);
    expect(k.kpis.netWorth.delta).toBe(50000);
  });
  it('sparkline senza valori prima della copertura dei dati', () => {
    const s = k.kpis.netWorth.series;
    expect(s).toHaveLength(12);
    expect(s[0].value).toBeNull();
    expect(s[s.length - 1].value).toBe(1750000);
  });
  it('autonomia in mesi = liquidità / spesa media', () => {
    expect(k.avgMonthlyExpense).toBeGreaterThan(0);
    expect(k.kpis.autonomy.value).toBeCloseTo(250000 / k.avgMonthlyExpense);
  });
});

describe('financial insights', () => {
  it('fondo di emergenza sotto obiettivo con dati a supporto, ordinati per priorità', () => {
    const r = financialInsights({ currency: 'EUR', liquidity: 200000, netWorth: 1000000, avgMonthlyExpense: 100000, avgMonthlyIncome: 150000, emergencyTargetMonths: 6, savingsRate: 0.05, forecast: null, trends: [], recurring: [], budgets: [], uncategorizedExpense: 0, totalExpense: 100000, missingRates: [], positions: [{ name: 'AAPL', value: 300000 }], pendingTransferPairs: 0, monthsOfData: 12 });
    expect(r[0]).toMatchObject({ id: 'emergency-fund', priority: 'alta' });
    expect(r[0].data.join(' ')).toContain('Mancano');
    expect(r.map((i) => i.id)).toContain('low-savings');
    expect(r.map((i) => i.id)).toContain('concentration-AAPL');
  });
});

describe('simulatore di investimento', () => {
  it('impatto su liquidità, fondo di emergenza e concentrazione', () => {
    const r = simulateInvestment({ amount: 300000, netWorth: 2000000, liquidity: 800000, investments: 1000000, physical: 200000, avgMonthlyExpense: 100000, existingPosition: 0, emergencyTargetMonths: 6, maxSinglePosition: 0.1, horizonYears: 10, tolerance: 'media' });
    expect(r.liquidityAfter).toBe(500000);
    expect(r.coverageBefore).toBe(8);
    expect(r.coverageAfter).toBe(5);
    expect(r.shareOfNetWorth).toBeCloseTo(0.15);
    expect(r.concentrationAfter).toBeCloseTo(0.15);
    expect(r.allocationAfter!.liquidity).toBeCloseTo(0.25);
    expect(r.warnings.length).toBe(2);
  });
});
