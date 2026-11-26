import { useMemo } from 'react';
import type { Transaction } from '../../types';
import { addDays, formatDate, parseISODate, todayISO } from '../../utils/date';
import { formatMoney } from '../../utils/money';

const WEEKS = 26;
const DAY_LABELS = ['', 'lun', '', 'mer', '', 'ven', ''];
const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

/**
 * Calendario delle spese giornaliere degli ultimi 6 mesi, nello stile del grafico dei contributi di GitHub.
 * L'intensità dipende dai quartili delle giornate con spese.
 */
export function SpendingCalendar({ transactions, currency }: { transactions: Transaction[]; currency: string }) {
  const { cells, levels, total, activeDays, monthMarks } = useMemo(() => {
    const today = todayISO();
    const dow = (parseISODate(today).getDay() + 6) % 7; // lunedì = 0
    const start = addDays(today, -(WEEKS - 1) * 7 - dow);
    const byDay = new Map<string, number>();
    for (const t of transactions) {
      if (t.type !== 'expense' || t.date < start || t.date > today || t.currency !== currency) continue;
      byDay.set(t.date, (byDay.get(t.date) ?? 0) - t.amount);
    }
    const values = [...byDay.values()].filter((v) => v > 0).sort((a, b) => a - b);
    const q = (p: number) => values[Math.min(values.length - 1, Math.floor(values.length * p))] ?? 0;
    const levels = [q(0.25), q(0.5), q(0.75)];
    const cells: Array<{ date: string; value: number; level: string }> = [];
    const monthMarks: Array<{ col: number; label: string }> = [];
    for (let i = 0; i < WEEKS * 7; i++) {
      const date = addDays(start, i);
      if (i % 7 === 0 && date.slice(8, 10) <= '07') monthMarks.push({ col: i / 7, label: MONTHS[Number(date.slice(5, 7)) - 1] });
      const value = byDay.get(date) ?? 0;
      const level = date > today ? 'x' : value <= 0 ? '0' : value <= levels[0] ? '1' : value <= levels[1] ? '2' : value <= levels[2] ? '3' : '4';
      cells.push({ date, value, level });
    }
    return { cells, levels, total: values.reduce((s, v) => s + v, 0), activeDays: values.length, monthMarks };
  }, [transactions, currency]);

  return (
    <div data-testid="spending-calendar">
      <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr', gap: 4 }}>
        <span />
        <div style={{ position: 'relative', height: 16, fontSize: 11, color: 'var(--muted)' }}>
          {monthMarks.map((m) => (
            <span key={m.col} style={{ position: 'absolute', left: m.col * 14 }}>
              {m.label}
            </span>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateRows: 'repeat(7, 11px)', gap: 3, fontSize: 10, color: 'var(--muted)', lineHeight: '11px' }}>
          {DAY_LABELS.map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>
        <div className="heatmap" role="img" aria-label={`Spese giornaliere degli ultimi 6 mesi: ${formatMoney(total, currency)} in ${activeDays} giorni`}>
          {cells.map((c) => (
            <i key={c.date} data-l={c.level} title={c.level === 'x' ? undefined : `${formatDate(c.date)}: ${c.value > 0 ? formatMoney(c.value, currency) : 'nessuna spesa'}`} />
          ))}
        </div>
      </div>
      <div className="spread" style={{ marginTop: 8 }}>
        <span className="xs muted">
          {formatMoney(total, currency)} spesi in {activeDays} giorni negli ultimi 6 mesi
          {levels[2] > 0 && ` · giornata tipica ${formatMoney(levels[1], currency)}`}
        </span>
        <span className="heat-legend">
          Meno <i style={{ background: 'var(--heat-0)' }} />
          <i style={{ background: 'var(--heat-1)' }} />
          <i style={{ background: 'var(--heat-2)' }} />
          <i style={{ background: 'var(--heat-3)' }} />
          <i style={{ background: 'var(--heat-4)' }} /> Di più
        </span>
      </div>
    </div>
  );
}
