import type { ReactNode } from 'react';
import type { Kpi } from '../../services/kpis';
import { formatMonth } from '../../utils/date';
import { formatMoney, formatPercent } from '../../utils/money';
import { Tip } from '../ui/States';
import { AiButton } from '../ai/AiPanel';
import { Sparkline } from './Sparkline';

export function formatKpi(k: Pick<Kpi, 'unit'>, v: number | null, currency: string, sign = false): string {
  if (v === null) return '—';
  if (k.unit === 'money') return formatMoney(Math.round(v), currency, { sign });
  if (k.unit === 'ratio') return sign ? `${v >= 0 ? '+' : ''}${(v * 100).toLocaleString('it-IT', { maximumFractionDigits: 1 })} pt` : formatPercent(v);
  return `${sign && v >= 0 ? '+' : ''}${v.toLocaleString('it-IT', { maximumFractionDigits: 1 })} mesi`;
}

export function KpiCard({
  kpi,
  label,
  tip,
  currency,
  href,
  compareLabel,
  goodWhenUp = true,
  sub,
  testId,
}: {
  kpi: Kpi;
  label: string;
  tip: string;
  currency: string;
  href?: string;
  compareLabel: string;
  goodWhenUp?: boolean;
  sub?: ReactNode;
  testId?: string;
}) {
  const d = kpi.delta;
  const good = d === null || d === 0 ? null : (d > 0) === goodWhenUp;
  const valueText = formatKpi(kpi, kpi.value, currency);
  const focus = [
    `KPI: ${label}`,
    `Definizione: ${tip}`,
    `Valore: ${valueText}`,
    `Periodo precedente (${compareLabel}): ${formatKpi(kpi, kpi.previous, currency)}`,
    `Variazione: ${formatKpi(kpi, d, currency, true)}`,
    `Storico mensile: ${kpi.series.map((p) => `${formatMonth(p.month)} ${formatKpi(kpi, p.value, currency)}`).join('; ')}`,
  ].join('\n');
  const body = (
    <>
      <div className="kpi-top">
        <span className="kpi-label">
          {label}
          <Tip text={tip} />
        </span>
        <AiButton prompt={`Spiegami il KPI "${label}" e cosa lo fa cambiare`} focus={focus} />
      </div>
      <div className="kpi-value num" data-testid={testId}>
        {valueText}
      </div>
      <div className="kpi-foot">
        <span className={`kpi-delta num ${good === null ? 'muted' : good ? 'pos' : 'neg'}`} title={`Rispetto a ${compareLabel}: ${formatKpi(kpi, kpi.previous, currency)}`}>
          {d === null ? 'nessun confronto' : `${formatKpi(kpi, d, currency, true)} vs ${compareLabel}`}
        </span>
        <Sparkline values={kpi.series.map((p) => p.value)} label={`Andamento di ${label} negli ultimi 12 mesi`} />
      </div>
      {sub && <div className="kpi-sub xs muted">{sub}</div>}
    </>
  );
  return href ? (
    <a className="kpi-card is-link" href={href} aria-label={`${label}: ${valueText}. Apri il dettaglio`}>
      {body}
    </a>
  ) : (
    <div className="kpi-card">{body}</div>
  );
}
