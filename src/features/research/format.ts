/** Formattazione dei dati aziendali (valori in unità di valuta, non centesimi). */
export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toLocaleString('it-IT', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function fmtBig(v: number | null | undefined, currency?: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const [d, s] = a >= 1e12 ? [1e12, ' T'] : a >= 1e9 ? [1e9, ' Mld'] : a >= 1e6 ? [1e6, ' Mln'] : a >= 1e3 ? [1e3, ' mila'] : [1, ''];
  return `${(v / d).toLocaleString('it-IT', { maximumFractionDigits: a >= 1e3 ? 2 : 0 })}${s}${currency ? ` ${currency}` : ''}`;
}

export function fmtPrice(v: number | null | undefined, currency?: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 })}${currency ? ` ${currency}` : ''}`;
}

export function fmtPct(v: number | null | undefined, digits = 1, sign = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${sign && v > 0 ? '+' : ''}${(v * 100).toLocaleString('it-IT', { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`;
}

export function fmtX(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v.toLocaleString('it-IT', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}x`;
}

export const pctClass = (v: number | null | undefined) => (v === null || v === undefined ? 'muted' : v > 0 ? 'pos' : v < 0 ? 'neg' : '');
