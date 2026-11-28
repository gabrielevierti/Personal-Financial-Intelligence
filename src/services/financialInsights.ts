/**
 * Financial Insights: regole deterministiche, ognuna con priorità, motivazione, dati a supporto
 * e suggerimento. Nessun numero viene inventato: ogni insight nasce da un calcolo dell'app.
 */
import type { Cents } from '../types';
import { formatMoney, formatPercent } from '../utils/money';
import type { BudgetStatus } from './finance';
import type { MonthEndForecast } from './forecast';
import type { CategoryTrend, Recurring } from './ai/insights';

export type InsightPriority = 'alta' | 'media' | 'bassa';

export interface FinancialInsight {
  id: string;
  priority: InsightPriority;
  title: string;
  reason: string;
  data: string[];
  suggestion: string;
  /** Pagina dove approfondire. */
  href?: string;
}

export interface InsightInput {
  currency: string;
  liquidity: Cents;
  netWorth: Cents;
  avgMonthlyExpense: Cents;
  avgMonthlyIncome: Cents;
  emergencyTargetMonths: number;
  savingsRate: number | null;
  forecast: MonthEndForecast | null;
  trends: CategoryTrend[];
  recurring: Recurring[];
  budgets: Array<BudgetStatus & { name: string }>;
  uncategorizedExpense: Cents;
  totalExpense: Cents;
  missingRates: string[];
  /** Valore delle singole posizioni (asset finanziari) per il rischio di concentrazione. */
  positions: Array<{ name: string; value: Cents }>;
  pendingTransferPairs: number;
  /** Importo dei giroconti sospetti nel periodo (gonfiano entrate e uscite di pari importo). */
  pendingTransferAmount: Cents;
  monthsOfData: number;
}

const ORDER: Record<InsightPriority, number> = { alta: 0, media: 1, bassa: 2 };

export function financialInsights(i: InsightInput): FinancialInsight[] {
  const m = (c: Cents) => formatMoney(c, i.currency);
  const out: FinancialInsight[] = [];

  if (i.missingRates.length)
    out.push({
      id: 'missing-rates',
      priority: 'alta',
      title: 'Totali incompleti: mancano tassi di cambio',
      reason: `Gli importi in ${i.missingRates.join(', ')} sono esclusi da tutti i totali.`,
      data: i.missingRates.map((c) => `Valuta senza tasso: ${c}`),
      suggestion: 'Inserisci il tasso di cambio nelle impostazioni.',
      href: '#/settings',
    });

  if (i.forecast && i.forecast.forecastBalance < 0)
    out.push({
      id: 'negative-forecast',
      priority: 'alta',
      title: 'Liquidità prevista negativa a fine mese',
      reason: 'Con le uscite programmate e stimate il saldo dei conti liquidi scende sotto zero.',
      data: [`Saldo previsto: ${m(i.forecast.forecastBalance)}`, `Uscite ancora attese: ${m(i.forecast.scheduled.expense + i.forecast.estimated.expense)}`],
      suggestion: 'Rimanda le spese non necessarie o sposta liquidità da un conto deposito.',
      href: '#/dashboard',
    });

  if (i.avgMonthlyExpense > 0) {
    const months = i.liquidity / i.avgMonthlyExpense;
    if (months < i.emergencyTargetMonths) {
      const gap = Math.round(i.emergencyTargetMonths * i.avgMonthlyExpense - i.liquidity);
      out.push({
        id: 'emergency-fund',
        priority: months < 3 ? 'alta' : 'media',
        title: 'Fondo di emergenza sotto l\'obiettivo',
        reason: `La liquidità copre ${months.toLocaleString('it-IT', { maximumFractionDigits: 1 })} mesi di spese; l'obiettivo è ${i.emergencyTargetMonths}.`,
        data: [`Liquidità: ${m(i.liquidity)}`, `Spesa media mensile: ${m(i.avgMonthlyExpense)}`, `Mancano: ${m(gap)}`],
        suggestion: `Accantona circa ${m(Math.round(gap / 12))} al mese per raggiungerlo in un anno.`,
        href: '#/goals',
      });
    }
  }

  if (i.savingsRate !== null && i.savingsRate < 0.1)
    out.push({
      id: 'low-savings',
      priority: i.savingsRate < 0 ? 'alta' : 'media',
      title: i.savingsRate < 0 ? 'Nel periodo hai speso più di quanto hai incassato' : 'Tasso di risparmio basso',
      reason: `Tasso di risparmio del periodo: ${formatPercent(i.savingsRate)}. Un riferimento comune è almeno il 10–20%.`,
      data: [`Entrate medie mensili: ${m(i.avgMonthlyIncome)}`, `Uscite medie mensili: ${m(i.avgMonthlyExpense)}`],
      suggestion: 'Guarda le categorie in crescita e gli abbonamenti qui sotto: sono le voci più facili da ridurre.',
      href: '#/transactions',
    });

  for (const b of i.budgets.filter((b) => b.level === 'exceeded' || b.level === 'warning90').slice(0, 3))
    out.push({
      id: `budget-${b.budget.id}`,
      priority: b.level === 'exceeded' ? 'alta' : 'media',
      title: `${b.name}: budget ${b.level === 'exceeded' ? 'superato' : 'quasi esaurito'}`,
      reason: `Speso ${m(b.spent)} su ${m(b.budget.limit)}.`,
      data: [`Utilizzo: ${formatPercent(b.usage)}`],
      suggestion: b.level === 'exceeded' ? 'Valuta se aumentare il budget o compensare con altre categorie.' : 'Limita le spese in questa categoria fino a fine mese.',
      href: '#/budgets',
    });

  for (const t of i.trends.filter((t) => t.average > 2000 && t.projected > t.average * 1.3).slice(0, 2))
    out.push({
      id: `trend-${t.categoryId ?? 'none'}`,
      priority: 'media',
      title: `${t.name} in aumento questo mese`,
      reason: 'Al ritmo attuale la spesa di fine mese supera la media dei mesi precedenti di oltre il 30%.',
      data: [`Finora: ${m(t.thisMonth)}`, `Proiezione: ${m(t.projected)}`, `Media mensile: ${m(t.average)}`],
      suggestion: 'Controlla i movimenti della categoria per capire se è una spesa una tantum.',
      href: t.categoryId ? `#/transactions?category=${t.categoryId}` : '#/transactions',
    });

  const subs = i.recurring.filter((r) => r.kind === 'expense' && r.categoryId === 'exp-subscriptions');
  if (subs.length >= 3) {
    const total = subs.reduce((s, r) => s + r.amount, 0);
    out.push({
      id: 'subscriptions',
      priority: 'bassa',
      title: `${subs.length} abbonamenti ricorrenti`,
      reason: `Costano in totale ${m(total)} al mese, ${m(total * 12)} all'anno.`,
      data: subs.slice(0, 6).map((r) => `${r.description}: ${m(r.amount)}`),
      suggestion: 'Disdici quelli che non usi più da qualche mese.',
      href: '#/transactions?category=exp-subscriptions',
    });
  }

  if (i.totalExpense > 0 && i.uncategorizedExpense / i.totalExpense > 0.2)
    out.push({
      id: 'uncategorized',
      priority: 'bassa',
      title: 'Molte spese senza categoria precisa',
      reason: `${formatPercent(i.uncategorizedExpense / i.totalExpense)} delle uscite del periodo è in "Altre spese": le analisi per categoria sono meno affidabili.`,
      data: [`Importo: ${m(i.uncategorizedExpense)}`],
      suggestion: 'Usa la categorizzazione automatica (anche con l\'AI locale) dalla pagina Movimenti.',
      href: '#/transactions?category=exp-other',
    });

  if (i.pendingTransferPairs > 0)
    out.push({
      id: 'transfers',
      priority: i.pendingTransferAmount > 0 ? 'alta' : 'media',
      title: `${i.pendingTransferPairs} possibili giroconti da confermare`,
      reason: i.pendingTransferAmount > 0
        ? `Finché non sono confermati, i bonifici tra i tuoi conti gonfiano entrate e uscite di ${m(i.pendingTransferAmount)} ciascuna.`
        : 'Finché non sono confermati, i bonifici tra i tuoi conti contano come entrate e uscite.',
      data: i.pendingTransferAmount > 0 ? [`Importo giroconti sospetti: ${m(i.pendingTransferAmount)}`] : [],
      suggestion: 'Conferma o scarta le coppie proposte nella pagina Movimenti.',
      href: '#/transactions',
    });

  if (i.netWorth > 0)
    for (const p of i.positions.filter((p) => p.value / i.netWorth > 0.2).slice(0, 2))
      out.push({
        id: `concentration-${p.name}`,
        priority: 'media',
        title: `Concentrazione elevata: ${p.name}`,
        reason: `Una singola posizione vale ${formatPercent(p.value / i.netWorth)} del patrimonio netto.`,
        data: [`Valore: ${m(p.value)}`],
        suggestion: 'Valuta se questa esposizione è coerente con il tuo profilo di rischio.',
        href: '#/investments',
      });

  if (i.monthsOfData > 0 && i.monthsOfData < 3)
    out.push({
      id: 'little-data',
      priority: 'bassa',
      title: 'Storico ancora breve',
      reason: `Ci sono circa ${i.monthsOfData} mesi di dati: medie e previsioni diventano affidabili con almeno 3–6 mesi.`,
      data: [],
      suggestion: 'Importa estratti conto più vecchi per migliorare le stime.',
      href: '#/import',
    });

  return out.sort((a, b) => ORDER[a.priority] - ORDER[b.priority]);
}
