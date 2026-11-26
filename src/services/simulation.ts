/**
 * Simulatore di investimento collegato alla finanza personale. Solo informativo:
 * mostra l'impatto di un acquisto sulla tua situazione, non dice se conviene.
 */
import type { Cents } from '../types';

export interface SimulationInput {
  amount: Cents;
  netWorth: Cents;
  liquidity: Cents;
  investments: Cents;
  physical: Cents;
  avgMonthlyExpense: Cents;
  /** Valore già detenuto nello stesso titolo (0 se nessuno). */
  existingPosition: Cents;
  emergencyTargetMonths: number;
  maxSinglePosition: number;
  horizonYears: number;
  tolerance: 'bassa' | 'media' | 'alta';
}

export interface SimulationResult {
  /** Quota del patrimonio netto investita con questa operazione. */
  shareOfNetWorth: number | null;
  liquidityAfter: Cents;
  coverageBefore: number | null;
  coverageAfter: number | null;
  positionAfter: Cents;
  concentrationAfter: number | null;
  allocationBefore: { liquidity: number; investments: number; other: number } | null;
  allocationAfter: { liquidity: number; investments: number; other: number } | null;
  warnings: string[];
}

const months = (liq: Cents, exp: Cents) => (exp > 0 ? liq / exp : null);

/**
 * L'acquisto sposta denaro dalla liquidità agli investimenti: il patrimonio netto non cambia
 * al momento dell'acquisto (al netto di commissioni, non considerate).
 */
export function simulateInvestment(i: SimulationInput): SimulationResult {
  const warnings: string[] = [];
  const liquidityAfter = i.liquidity - i.amount;
  const total = i.liquidity + i.investments + i.physical;
  const alloc = (liq: number, inv: number) => (total > 0 ? { liquidity: liq / total, investments: inv / total, other: i.physical / total } : null);
  const coverageBefore = months(i.liquidity, i.avgMonthlyExpense);
  const coverageAfter = months(Math.max(0, liquidityAfter), i.avgMonthlyExpense);
  const positionAfter = i.existingPosition + i.amount;
  const concentrationAfter = i.netWorth > 0 ? positionAfter / i.netWorth : null;

  if (i.amount <= 0) warnings.push('Inserisci un importo maggiore di zero.');
  if (liquidityAfter < 0) warnings.push('L\'importo supera la liquidità disponibile.');
  if (coverageAfter !== null && coverageAfter < i.emergencyTargetMonths) warnings.push(`Dopo l'acquisto il fondo di emergenza coprirebbe ${coverageAfter.toLocaleString('it-IT', { maximumFractionDigits: 1 })} mesi, sotto il tuo obiettivo di ${i.emergencyTargetMonths}.`);
  if (concentrationAfter !== null && concentrationAfter > i.maxSinglePosition) warnings.push(`La posizione supererebbe il ${Math.round(i.maxSinglePosition * 100)}% del patrimonio netto che hai indicato come massimo per un singolo titolo.`);
  if (i.horizonYears < 5) warnings.push('Con un orizzonte inferiore a 5 anni le oscillazioni di una singola azione pesano molto: valuta se è coerente con i tuoi tempi.');
  if (i.tolerance === 'bassa') warnings.push('Hai indicato una tolleranza al rischio bassa: una singola azione può perdere una parte rilevante del valore.');
  if (i.avgMonthlyExpense === 0) warnings.push('Spesa media mensile non disponibile: la copertura del fondo di emergenza non si può calcolare.');

  return {
    shareOfNetWorth: i.netWorth > 0 ? i.amount / i.netWorth : null,
    liquidityAfter,
    coverageBefore,
    coverageAfter,
    positionAfter,
    concentrationAfter,
    allocationBefore: alloc(i.liquidity, i.investments),
    allocationAfter: alloc(Math.max(0, liquidityAfter), i.investments + Math.min(i.amount, Math.max(0, i.liquidity))),
    warnings,
  };
}
