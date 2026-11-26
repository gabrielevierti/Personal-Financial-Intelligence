import type { ISODate, ISOMonth, Period } from '../types';

export type DateFormat = 'auto' | 'DMY' | 'MDY' | 'YMD';

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(): ISODate {
  return toISODate(new Date());
}

export function parseISODate(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isValidISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  return isValidYMD(y, m, d);
}

function isValidYMD(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  const dim = new Date(y, m, 0).getDate();
  return d <= dim;
}

function fixYear(y: number): number {
  if (y < 100) return y + (y >= 70 ? 1900 : 2000);
  return y;
}

/** Converte un numero seriale Excel (sistema 1900) in data ISO. */
export function excelSerialToISO(serial: number): ISODate | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 120000) return null;
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

const MONTHS_IT: Record<string, number> = {
  gen: 1, feb: 2, mar: 3, apr: 4, mag: 5, giu: 6, lug: 7, ago: 8, set: 9, ott: 10, nov: 11, dic: 12,
  jan: 1, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, dec: 12,
};

/**
 * Interpreta una data in vari formati. Restituisce ISO o null.
 * Formati: dd/mm/yyyy, dd-mm-yy, dd.mm.yyyy, yyyy-mm-dd, yyyy/mm/dd, mm/dd/yyyy (con format MDY),
 * "12 gen 2024", ISO con orario, seriale Excel, oggetti Date.
 */
export function parseDate(input: unknown, format: DateFormat = 'auto'): ISODate | null {
  if (input === null || input === undefined || input === '') return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : toISODate(input);
  }
  if (typeof input === 'number') return excelSerialToISO(input);
  const s = String(input).trim();
  if (s === '') return null;

  if (/^\d{5}(\.\d+)?$/.test(s)) return excelSerialToISO(Number(s));

  // YYYYMMDD compatto
  let m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return isValidYMD(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
  }

  // YYYY-MM-DD (eventualmente con orario)
  m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return isValidYMD(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
  }

  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:\s.*)?$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = fixYear(Number(m[3]));
    let day: number;
    let month: number;
    if (format === 'MDY') {
      month = a;
      day = b;
    } else if (format === 'DMY' || format === 'YMD') {
      day = a;
      month = b;
    } else {
      // auto: default europeo, ma se il secondo valore > 12 dev'essere MDY
      if (b > 12 && a <= 12) {
        month = a;
        day = b;
      } else {
        day = a;
        month = b;
      }
    }
    return isValidYMD(y, month, day) ? `${y}-${pad(month)}-${pad(day)}` : null;
  }

  m = s.toLowerCase().match(/^(\d{1,2})\s*[-\s]\s*([a-z]{3})[a-z]*\.?\s*[-\s]\s*(\d{2,4})$/);
  if (m) {
    const d = Number(m[1]);
    const mo = MONTHS_IT[m[2]];
    const y = fixYear(Number(m[3]));
    if (mo && isValidYMD(y, mo, d)) return `${y}-${pad(mo)}-${pad(d)}`;
  }
  return null;
}

/** Rileva il formato più probabile da un campione di valori. */
export function detectDateFormat(samples: unknown[]): DateFormat {
  let dmy = 0;
  let mdy = 0;
  for (const raw of samples) {
    const s = String(raw ?? '').trim();
    const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (!m) continue;
    if (Number(m[1]) > 12) dmy++;
    if (Number(m[2]) > 12) mdy++;
  }
  if (mdy > 0 && dmy === 0) return 'MDY';
  return 'DMY';
}

export function monthOf(date: ISODate): ISOMonth {
  return date.slice(0, 7);
}

export function currentMonth(): ISOMonth {
  return monthOf(todayISO());
}

export function addMonths(month: ISOMonth, delta: number): ISOMonth {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

export function monthStart(month: ISOMonth): ISODate {
  return `${month}-01`;
}

export function monthEnd(month: ISOMonth): ISODate {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${pad(new Date(y, m, 0).getDate())}`;
}

/** Elenco dei mesi compresi tra due date (inclusi). */
export function monthsBetween(start: ISODate, end: ISODate): ISOMonth[] {
  const out: ISOMonth[] = [];
  let cur = monthOf(start);
  const last = monthOf(end);
  let guard = 0;
  while (cur <= last && guard < 1200) {
    out.push(cur);
    cur = addMonths(cur, 1);
    guard++;
  }
  return out;
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = parseISODate(date);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function daysBetween(a: ISODate, b: ISODate): number {
  const ms = parseISODate(b).getTime() - parseISODate(a).getTime();
  return Math.round(ms / 86400000);
}

const monthFmt = new Intl.DateTimeFormat('it-IT', { month: 'short', year: '2-digit' });
const longMonthFmt = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' });
const dateFmt = new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });

export function formatMonth(month: ISOMonth, long = false): string {
  const d = parseISODate(`${month}-01`);
  return (long ? longMonthFmt : monthFmt).format(d);
}

export function formatDate(date: ISODate): string {
  return dateFmt.format(parseISODate(date));
}

export type PeriodPreset =
  | 'this_month'
  | 'last_month'
  | 'last_3_months'
  | 'this_quarter'
  | 'this_year'
  | 'last_12_months'
  | 'last_year'
  | 'all'
  | 'custom';

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  this_month: 'Questo mese',
  last_month: 'Mese scorso',
  last_3_months: 'Ultimi 3 mesi',
  this_quarter: 'Trimestre corrente',
  this_year: "Quest'anno",
  last_12_months: 'Ultimi 12 mesi',
  last_year: 'Anno scorso',
  all: 'Tutto',
  custom: 'Personalizzato',
};

export function resolvePeriod(
  preset: PeriodPreset,
  today: ISODate = todayISO(),
  custom?: { start: ISODate; end: ISODate },
  earliest?: ISODate,
): Period {
  const month = monthOf(today);
  const year = today.slice(0, 4);
  switch (preset) {
    case 'this_month':
      return { start: monthStart(month), end: monthEnd(month), label: PERIOD_LABELS[preset] };
    case 'last_month': {
      const pm = addMonths(month, -1);
      return { start: monthStart(pm), end: monthEnd(pm), label: PERIOD_LABELS[preset] };
    }
    case 'last_3_months':
      return { start: monthStart(addMonths(month, -2)), end: monthEnd(month), label: PERIOD_LABELS[preset] };
    case 'this_quarter': {
      const m = Number(month.slice(5, 7));
      const qStart = Math.floor((m - 1) / 3) * 3 + 1;
      const sm = `${year}-${pad(qStart)}`;
      return { start: monthStart(sm), end: monthEnd(addMonths(sm, 2)), label: PERIOD_LABELS[preset] };
    }
    case 'this_year':
      return { start: `${year}-01-01`, end: `${year}-12-31`, label: PERIOD_LABELS[preset] };
    case 'last_12_months':
      return { start: monthStart(addMonths(month, -11)), end: monthEnd(month), label: PERIOD_LABELS[preset] };
    case 'last_year': {
      const y = Number(year) - 1;
      return { start: `${y}-01-01`, end: `${y}-12-31`, label: PERIOD_LABELS[preset] };
    }
    case 'all':
      return { start: earliest ?? `${year}-01-01`, end: monthEnd(month) > today ? monthEnd(month) : today, label: PERIOD_LABELS[preset] };
    case 'custom': {
      const start = custom?.start ?? monthStart(month);
      const end = custom?.end ?? monthEnd(month);
      return start <= end
        ? { start, end, label: `${formatDate(start)} – ${formatDate(end)}` }
        : { start: end, end: start, label: `${formatDate(end)} – ${formatDate(start)}` };
    }
  }
}

/** Periodo precedente della stessa durata (per i confronti). */
export function previousPeriod(p: Period): Period {
  const startM = monthOf(p.start);
  const endM = monthOf(p.end);
  const isWholeMonths = p.start === monthStart(startM) && p.end === monthEnd(endM);
  if (isWholeMonths) {
    const n = monthsBetween(p.start, p.end).length;
    const ps = addMonths(startM, -n);
    const pe = addMonths(endM, -n);
    return { start: monthStart(ps), end: monthEnd(pe), label: 'Periodo precedente' };
  }
  const len = daysBetween(p.start, p.end) + 1;
  return { start: addDays(p.start, -len), end: addDays(p.start, -1), label: 'Periodo precedente' };
}
