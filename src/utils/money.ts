import type { Cents } from '../types';

export type DecimalSeparator = 'auto' | ',' | '.';

/** Converte un numero decimale in centesimi interi (arrotondamento half-away-from-zero). */
export function toCents(value: number): Cents {
  if (!Number.isFinite(value)) throw new Error('Importo non valido');
  const sign = value < 0 ? -1 : 1;
  // Uso toFixed per eliminare il rumore floating point prima di arrotondare.
  const abs = Math.abs(value);
  const cents = Math.round(Number((abs * 100).toFixed(4)));
  return sign * cents === 0 ? 0 : sign * cents;
}

export function fromCents(cents: Cents): number {
  return cents / 100;
}

/** Somma intera sicura. */
export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/**
 * Interpreta una stringa di importo in centesimi.
 * Supporta: "1.234,56", "1,234.56", "-12,50", "12,50-", "(12.50)", "€ 1 234,56", "+5", "1'234.50".
 * Restituisce null se non interpretabile.
 */
export function parseAmount(input: unknown, decimal: DecimalSeparator = 'auto'): Cents | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    return Number.isFinite(input) ? toCents(input) : null;
  }
  let s = String(input).trim();
  if (s === '') return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[€$£]|EUR|USD|GBP|CHF/gi, '').replace(/\s| /g, '');
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  s = s.replace(/'/g, '');
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  let sep: ',' | '.' | null = null;
  if (decimal !== 'auto') {
    sep = decimal;
  } else {
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) {
      sep = lastComma > lastDot ? ',' : '.';
    } else if (lastComma >= 0) {
      const parts = s.split(',');
      // "1,234" (3 cifre dopo una sola virgola) è ambiguo: in contesto italiano trattiamo la virgola come decimale
      // salvo il caso di più virgole (separatore migliaia internazionale).
      sep = parts.length > 2 ? null : ',';
    } else if (lastDot >= 0) {
      const parts = s.split('.');
      if (parts.length > 2) sep = null; // "1.234.567" → migliaia
      else if (parts[1].length === 3 && parts[0].length >= 1 && parts[0] !== '0') sep = null; // "1.234" → migliaia (it)
      else sep = '.';
    }
  }

  let intPart = s;
  let decPart = '';
  if (sep && s.includes(sep)) {
    const idx = s.lastIndexOf(sep);
    intPart = s.slice(0, idx);
    decPart = s.slice(idx + 1);
  }
  intPart = intPart.replace(/[.,]/g, '');
  if (/[.,]/.test(decPart)) return null;
  if (intPart === '' && decPart === '') return null;
  const normalized = `${intPart || '0'}.${decPart || '0'}`;
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  const cents = toCents(n);
  return negative ? -cents : cents;
}

const formatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(cents: Cents, currency = 'EUR', opts: { sign?: boolean; compact?: boolean } = {}): string {
  const key = `${currency}|${opts.compact ? 'c' : 'n'}`;
  let f = formatters.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat('it-IT', {
        style: 'currency',
        currency,
        notation: opts.compact ? 'compact' : 'standard',
        useGrouping: 'always' as unknown as boolean,
        maximumFractionDigits: opts.compact ? 1 : 2,
        minimumFractionDigits: opts.compact ? 0 : 2,
      });
    } catch {
      f = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    formatters.set(key, f);
  }
  const text = f.format(cents / 100);
  if (opts.sign && cents > 0) return `+${text}`;
  return text;
}

/** Valore per input numerici (es. "1234,56"). */
export function centsToInput(cents: Cents): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const s = `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}

export function formatPercent(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

/** Moltiplica centesimi per una quantità (anche frazionaria), arrotondando al centesimo. */
export function multiplyCents(cents: Cents, factor: number): Cents {
  return Math.round(cents * factor);
}

export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'BTC'];
