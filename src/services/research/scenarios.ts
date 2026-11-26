/**
 * Scenari di valutazione deterministici (prudente, moderato, ottimista).
 * Le ipotesi partono dai dati storici con regole fisse ed esplicite; nessuna probabilità viene assegnata.
 */
import type { FinancialYear } from './types';
import { cagr, dcf, type DcfInputs, type YearMetrics } from './metrics';

export interface BaseAssumptions {
  inputs: DcfInputs;
  notes: string[];
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const avg = (xs: Array<number | null>) => {
  const v = xs.filter((x): x is number => x !== null && Number.isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};

export const DEFAULT_WACC = 0.09;

/** Ipotesi di partenza ricavate dallo storico (ultimi 5 esercizi al massimo). */
export function baseAssumptions(years: FinancialYear[], metrics: YearMetrics[], shares: number | null): BaseAssumptions | null {
  const latest = years[0];
  if (!latest || latest.revenue === null || latest.revenue <= 0) return null;
  const notes: string[] = [];
  const span = Math.min(5, years.length - 1);
  const g = span >= 1 ? cagr(years[span].revenue, latest.revenue, span) : null;
  const growth = g === null ? 0.03 : clamp(g, -0.1, 0.25);
  notes.push(g === null ? 'Crescita dei ricavi: ipotesi del 3% (storico insufficiente).' : `Crescita dei ricavi: CAGR ${span} anni ${(g * 100).toFixed(1)}%${growth !== g ? `, limitato a ${(growth * 100).toFixed(1)}%` : ''}.`);
  const m = avg(metrics.slice(0, 3).map((x) => x.operatingMargin));
  const margin = m === null ? 0.1 : clamp(m, -0.5, 0.6);
  notes.push(m === null ? 'Margine operativo: ipotesi del 10% (dato mancante).' : `Margine operativo: media degli ultimi ${Math.min(3, metrics.length)} esercizi (${(m * 100).toFixed(1)}%).`);
  const t = avg(metrics.slice(0, 3).map((x) => (x.taxRateAssumed ? null : x.taxRate)));
  const tax = t ?? 0.21;
  notes.push(t === null ? 'Aliquota fiscale: ipotesi del 21%.' : `Aliquota fiscale effettiva media: ${(tax * 100).toFixed(1)}%.`);
  const reinv = avg(
    years.slice(0, 3).map((y, i) => {
      const nopat = y.operatingIncome !== null ? y.operatingIncome * (1 - metrics[i].taxRate) : null;
      return nopat && nopat > 0 && y.capex !== null && y.depreciation !== null ? (Math.abs(y.capex) - y.depreciation) / nopat : null;
    }),
  );
  const reinvestment = reinv === null ? 0.3 : clamp(reinv, 0, 0.8);
  notes.push(reinv === null ? 'Reinvestimento: ipotesi del 30% del NOPAT.' : `Reinvestimento: (capex − ammortamenti) / NOPAT medio, ${(reinvestment * 100).toFixed(0)}%.`);
  notes.push(`WACC: ipotesi del ${(DEFAULT_WACC * 100).toFixed(0)}% (non calcolato dai dati: modificalo secondo il tuo giudizio).`);
  const netDebt = metrics[0].netDebt;
  if (netDebt === null) notes.push('Debito netto non disponibile: considerato pari a zero.');
  if (!shares) notes.push('Numero di azioni non disponibile: il valore per azione non si può calcolare.');
  return {
    inputs: { baseRevenue: latest.revenue, revenueGrowth: growth, operatingMargin: margin, taxRate: tax, reinvestmentRate: reinvestment, wacc: DEFAULT_WACC, terminalGrowth: 0.02, years: 5, netDebt: netDebt ?? 0, shares: shares ?? 0 },
    notes,
  };
}

export type ScenarioId = 'prudente' | 'moderato' | 'ottimista';

export interface Scenario {
  id: ScenarioId;
  inputs: DcfInputs;
  horizonYears: number;
  fairValue: number | null;
  upside: number | null;
  rules: string[];
  risks: string[];
}

/** Regole fisse che trasformano le ipotesi di base nei tre scenari. */
export function buildScenarios(base: DcfInputs, price: number | null): Scenario[] {
  const defs: Array<{ id: ScenarioId; f: (b: DcfInputs) => DcfInputs; rules: string[]; risks: string[] }> = [
    {
      id: 'prudente',
      f: (b) => ({ ...b, revenueGrowth: Math.min(b.revenueGrowth * 0.5, b.revenueGrowth - 0.02), operatingMargin: b.operatingMargin - 0.02, wacc: b.wacc + 0.01, terminalGrowth: Math.min(b.terminalGrowth, 0.015) }),
      rules: ['Crescita: metà della base o 2 punti in meno (il valore più basso)', 'Margine operativo: −2 punti', 'WACC: +1 punto', 'Crescita terminale: al massimo 1,5%'],
      risks: ['Rallentamento della domanda', 'Pressione sui margini da costi o concorrenza', 'Tassi più alti'],
    },
    {
      id: 'moderato',
      f: (b) => b,
      rules: ['Ipotesi di base ricavate dallo storico'],
      risks: ['Lo storico potrebbe non ripetersi', 'Sensibilità alle ipotesi su WACC e crescita terminale'],
    },
    {
      id: 'ottimista',
      f: (b) => ({ ...b, revenueGrowth: Math.min(b.revenueGrowth * 1.3 + 0.01, 0.3), operatingMargin: b.operatingMargin + 0.02, wacc: b.wacc - 0.005, terminalGrowth: Math.min(b.terminalGrowth + 0.005, 0.03) }),
      rules: ['Crescita: base × 1,3 + 1 punto (al massimo 30%)', 'Margine operativo: +2 punti', 'WACC: −0,5 punti', 'Crescita terminale: +0,5 punti (al massimo 3%)'],
      risks: ['Ipotesi che richiedono un\'esecuzione migliore dello storico', 'Prezzo che già sconta la crescita'],
    },
  ];
  return defs.map((d) => {
    const inputs = d.f(base);
    const r = dcf(inputs);
    const fv = r && inputs.shares > 0 ? r.perShare : null;
    return { id: d.id, inputs, horizonYears: inputs.years, fairValue: fv, upside: fv !== null && price ? fv / price - 1 : null, rules: d.rules, risks: d.risks };
  });
}

/** Intervallo di fair value: minimo e massimo tra scenari (non è un valore oggettivo). */
export function fairValueRange(scenarios: Scenario[]): { low: number; high: number } | null {
  const v = scenarios.map((s) => s.fairValue).filter((x): x is number => x !== null && Number.isFinite(x));
  return v.length ? { low: Math.min(...v), high: Math.max(...v) } : null;
}
