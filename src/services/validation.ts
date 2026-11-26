import type { AccountType, AssetType, GoalPriority } from '../types';
import { isValidISODate } from '../utils/date';

export class ValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues.join(' '));
    this.name = 'ValidationError';
  }
}

export const ACCOUNT_TYPES: AccountType[] = ['checking', 'deposit', 'cash', 'debit_card', 'credit_card', 'investment', 'loan', 'other'];
export const ASSET_TYPES: AssetType[] = ['liquidity', 'deposit', 'stock', 'etf', 'bond', 'fund', 'crypto', 'real_estate', 'vehicle', 'physical', 'other'];
export const PRIORITIES: GoalPriority[] = ['low', 'medium', 'high'];

/** Limite di sicurezza: ±10 miliardi in centesimi, ben dentro Number.MAX_SAFE_INTEGER. */
export const MAX_ABS_CENTS = 1_000_000_000_000;

export class Checker {
  issues: string[] = [];
  require(cond: boolean, msg: string): this {
    if (!cond) this.issues.push(msg);
    return this;
  }
  text(v: unknown, label: string, { min = 1, max = 200 } = {}): this {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s.length < min) this.issues.push(`${label}: campo obbligatorio.`);
    else if (s.length > max) this.issues.push(`${label}: massimo ${max} caratteri.`);
    return this;
  }
  cents(v: unknown, label: string, { allowNegative = true, allowZero = true } = {}): this {
    if (typeof v !== 'number' || !Number.isInteger(v)) this.issues.push(`${label}: importo non valido.`);
    else if (Math.abs(v) > MAX_ABS_CENTS) this.issues.push(`${label}: importo fuori scala.`);
    else if (!allowNegative && v < 0) this.issues.push(`${label}: non può essere negativo.`);
    else if (!allowZero && v === 0) this.issues.push(`${label}: deve essere diverso da zero.`);
    return this;
  }
  date(v: unknown, label: string, optional = false): this {
    if (optional && (v === null || v === undefined || v === '')) return this;
    if (typeof v !== 'string' || !isValidISODate(v)) this.issues.push(`${label}: data non valida.`);
    return this;
  }
  currency(v: unknown): this {
    if (typeof v !== 'string' || !/^[A-Z]{3}$/.test(v)) this.issues.push('Valuta non valida (codice ISO a 3 lettere).');
    return this;
  }
  oneOf<T>(v: unknown, list: readonly T[], label: string): this {
    if (!list.includes(v as T)) this.issues.push(`${label}: valore non ammesso.`);
    return this;
  }
  done(): void {
    if (this.issues.length) throw new ValidationError(this.issues);
  }
}

export const check = () => new Checker();
