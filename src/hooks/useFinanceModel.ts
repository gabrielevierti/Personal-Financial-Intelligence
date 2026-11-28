import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../database/db';
import { useDataSet } from './useData';
import { usePrefs } from './usePrefs';
import { COST_BASIS_KEY, EMERGENCY_MONTHS_KEY, useSetting } from './useSetting';
import { buildInsights } from '../services/ai/insights';
import { assetValue, budgetStatuses, FINANCIAL_ASSET_TYPES, makeConverter, totalsByCategory } from '../services/finance';
import { monthEndForecast, projectLiquidity, upcoming, type ForecastInput } from '../services/forecast';
import { financialInsights } from '../services/financialInsights';
import { computeKpis } from '../services/kpis';
import { detectTransfers, getIgnoredPairs, getOwnerNames } from '../services/transfers';
import { currentMonth } from '../utils/date';

/** Modello finanziario completo per dashboard, insight e notifiche. Tutti i numeri sono calcolati qui. */
export function useFinanceModel() {
  const ds = useDataSet();
  const { period } = usePrefs();
  const scheduled = useLiveQuery(() => db.scheduled_items.toArray(), []);
  const links = useLiveQuery(() => db.bank_links.toArray(), []);
  const transferMeta = useLiveQuery(async () => ({ names: await getOwnerNames(), ignored: await getIgnoredPairs() }), []);
  const [emergencyMonths] = useSetting<number>(EMERGENCY_MONTHS_KEY, 6);
  const [costBasis] = useSetting<boolean>(COST_BASIS_KEY, true);

  return useMemo(() => {
    if (!ds || !scheduled) return null;
    const conv = makeConverter(ds.settings);

    // Rileva TUTTI i giroconti tra conti propri (certi e non): da escludere da entrate/uscite.
    // Un giroconto non è né un'entrata né un'uscita: il denaro resta tuo.
    const allCandidates = links && transferMeta
      ? detectTransfers(ds.transactions, ds.accounts, links, transferMeta.names, transferMeta.ignored)
      : [];
    const transferTxIds = new Set<string>();
    for (const c of allCandidates) {
      transferTxIds.add(c.outId);
      transferTxIds.add(c.inId);
    }
    const pendingPairs = allCandidates.filter((c) => !c.certain).length;

    const k = computeKpis(ds, period, { costBasis, excludeIds: transferTxIds });
    const ins = buildInsights(ds);
    const month = currentMonth();
    const statuses = budgetStatuses(ds.budgets, ds.transactions, month, conv);
    const total = statuses.find((s) => s.budget.categoryId === null);
    const input: ForecastInput = {
      liquidityNow: k.kpis.liquidity.value ?? 0,
      incomeSoFar: ins.forecast.incomeSoFar,
      expenseSoFar: ins.forecast.expenseSoFar,
      scheduled,
      recurring: ins.recurring,
      dailyVariable: ins.forecast.dailyVariable,
      remainingBudget: total ? total.remaining : null,
      conv,
    };
    const forecast = monthEndForecast(input);
    const projections = projectLiquidity(input);
    const catName = new Map(ds.categories.map((c) => [c.id, c.name]));
    const periodExpense = totalsByCategory(ds.transactions, period, 'expense', ds.categories, conv);
    const insights = financialInsights({
      currency: ds.settings.baseCurrency,
      liquidity: k.kpis.liquidity.value ?? 0,
      netWorth: k.kpis.netWorth.value ?? 0,
      avgMonthlyExpense: k.avgMonthlyExpense,
      avgMonthlyIncome: ins.avgMonthlyIncome,
      emergencyTargetMonths: emergencyMonths,
      savingsRate: k.kpis.savingsRate.value,
      forecast,
      trends: ins.trends,
      recurring: ins.recurring,
      budgets: statuses.map((s) => ({ ...s, name: s.budget.categoryId ? (catName.get(s.budget.categoryId) ?? 'Categoria') : 'Budget totale' })),
      uncategorizedExpense: periodExpense.find((c) => c.categoryId === 'exp-other' || c.categoryId === null)?.total ?? 0,
      totalExpense: k.kpis.expense.value ?? 0,
      missingRates: [...conv.missing],
      positions: ds.assets.filter((a) => FINANCIAL_ASSET_TYPES.includes(a.type)).map((a) => ({ name: a.name, value: conv(assetValue(a), a.currency) })),
      pendingTransferPairs: pendingPairs,
      pendingTransferAmount: 0,
      monthsOfData: ins.monthsOfData,
    });
    return {
      ds,
      conv,
      period,
      kpis: k,
      insightsData: ins,
      forecast,
      projections,
      insights,
      budgets: statuses,
      upcoming: upcoming(scheduled, 30),
      scheduled,
      emergencyMonths,
      costBasis,
    };
  }, [ds, scheduled, links, transferMeta, period, emergencyMonths, costBasis]);
}

export type FinanceModel = NonNullable<ReturnType<typeof useFinanceModel>>;
