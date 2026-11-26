import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Cents } from '../../types';
import { formatMonth } from '../../utils/date';
import { formatMoney, formatPercent } from '../../utils/money';
import { axisPropsFor, gridPropsFor, makeMoneyTooltip } from './ChartTooltip';
import { useChartColors } from '../../hooks/useTheme';

/** Colori dei grafici secondo il tema corrente. */
function useC() {
  const c = useChartColors();
  return { income: c.income, expense: c.expense, sage: c.accent, sageStrong: c.accent, warning: c.warning, grid: c.grid, axis: c.axis, muted: c.muted, axisProps: axisPropsFor(c), gridProps: gridPropsFor(c) };
}

const compact = (currency: string) => (v: number) => formatMoney(v, currency, { compact: true });

export function IncomeExpenseChart({ data, currency, height = 260 }: { data: Array<{ month: string; income: Cents; expense: Cents }>; currency: string; height?: number }) {
  const C = useC();
  const { axisProps, gridProps } = C;
  return (
    <div className="chart-box" style={{ height }} data-testid="chart-income-expense">
      <ResponsiveContainer>
        <BarChart data={data} barGap={2} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="month" tickFormatter={(m) => formatMonth(m)} {...axisProps} />
          <YAxis tickFormatter={compact(currency)} width={64} {...axisProps} />
          <Tooltip content={makeMoneyTooltip(currency, (m) => formatMonth(m, true))} cursor={{ fill: C.grid, fillOpacity: 0.25 }} />
          <Bar dataKey="income" name="Entrate" fill={C.income} radius={[3, 3, 0, 0]} maxBarSize={28} />
          <Bar dataKey="expense" name="Uscite" fill={C.expense} radius={[3, 3, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AreaSeriesChart({
  data,
  dataKey,
  name,
  currency,
  color,
  height = 260,
  testId,
}: {
  data: Array<Record<string, number | string>>;
  dataKey: string;
  name: string;
  currency: string;
  color?: string;
  height?: number;
  testId?: string;
}) {
  const C = useC();
  const { axisProps, gridProps } = C;
  const gid = `g-${dataKey}-${testId ?? ''}`;
  const stroke = color ?? C.sage;
  return (
    <div className="chart-box" style={{ height }} data-testid={testId}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.25} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="month" tickFormatter={(m) => formatMonth(m)} {...axisProps} />
          <YAxis tickFormatter={compact(currency)} width={64} {...axisProps} domain={['auto', 'auto']} />
          <Tooltip content={makeMoneyTooltip(currency, (m) => formatMonth(m, true))} />
          <ReferenceLine y={0} stroke={C.grid} />
          <Area type="monotone" dataKey={dataKey} name={name} stroke={stroke} strokeWidth={2} fill={`url(#${gid})`} dot={false} activeDot={{ r: 4 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function NetLineChart({ data, currency, height = 260 }: { data: Array<{ month: string; net: Cents; income: Cents; expense: Cents }>; currency: string; height?: number }) {
  const C = useC();
  const { axisProps, gridProps } = C;
  return (
    <div className="chart-box" style={{ height }} data-testid="chart-monthly">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="month" tickFormatter={(m) => formatMonth(m)} {...axisProps} />
          <YAxis tickFormatter={compact(currency)} width={64} {...axisProps} />
          <Tooltip content={makeMoneyTooltip(currency, (m) => formatMonth(m, true))} />
          <ReferenceLine y={0} stroke={C.grid} />
          <Line type="monotone" dataKey="income" name="Entrate" stroke={C.income} strokeWidth={1.5} dot={false} strokeOpacity={0.7} />
          <Line type="monotone" dataKey="expense" name="Uscite" stroke={C.expense} strokeWidth={1.5} dot={false} strokeOpacity={0.7} />
          <Line type="monotone" dataKey="net" name="Risparmio" stroke={C.sageStrong} strokeWidth={2.5} dot={{ r: 2.5 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface Slice {
  key: string;
  label: string;
  value: Cents;
  color: string;
  share: number;
}

export function DonutWithLegend({ slices, currency, testId, maxLegend = 7 }: { slices: Slice[]; currency: string; testId?: string; maxLegend?: number }) {
  const C = useC();
  const shown = slices.slice(0, maxLegend);
  const rest = slices.slice(maxLegend);
  const legend = rest.length
    ? [...shown, { key: 'rest', label: `Altre (${rest.length})`, value: rest.reduce((s, x) => s + x.value, 0), color: C.muted, share: rest.reduce((s, x) => s + x.share, 0) }]
    : shown;
  const total = slices.reduce((s, x) => s + x.value, 0);
  return (
    <div className="grid donut-grid" data-testid={testId}>
      <div style={{ height: 180, position: 'relative' }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={legend} dataKey="value" nameKey="label" innerRadius="64%" outerRadius="100%" paddingAngle={1.5} stroke="none" isAnimationActive={false}>
              {legend.map((s) => (
                <Cell key={s.key} fill={s.color} />
              ))}
            </Pie>
            <Tooltip content={makeMoneyTooltip(currency)} />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', textAlign: 'center' }}>
          <div>
            <div className="xs muted">Totale</div>
            <div className="num" style={{ fontWeight: 600, fontSize: 14 }}>
              {formatMoney(total, currency, { compact: total >= 1000000 })}
            </div>
          </div>
        </div>
      </div>
      <div className="legend">
        {legend.map((s) => (
          <div className="legend-row" key={s.key}>
            <i style={{ background: s.color }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
            <span className="muted num xs">{formatPercent(s.share, 0)}</span>
            <span className="num" style={{ textAlign: 'right', minWidth: 84 }}>
              {formatMoney(s.value, currency)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BudgetEvolutionChart({ data, currency }: { data: Array<{ month: string; budget: Cents; spent: Cents }>; currency: string }) {
  const C = useC();
  const { axisProps, gridProps } = C;
  return (
    <div className="chart-box" data-testid="chart-budget">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="month" tickFormatter={(m) => formatMonth(m)} {...axisProps} />
          <YAxis tickFormatter={compact(currency)} width={64} {...axisProps} />
          <Tooltip content={makeMoneyTooltip(currency, (m) => formatMonth(m, true))} cursor={{ fill: C.grid, fillOpacity: 0.25 }} />
           <Bar dataKey="budget" name="Budget" fill={C.grid} radius={[3, 3, 0, 0]} maxBarSize={30} />
          <Bar dataKey="spent" name="Speso" radius={[3, 3, 0, 0]} maxBarSize={30}>
            {data.map((d) => (
              <Cell key={d.month} fill={d.budget === 0 ? C.muted : d.spent > d.budget ? C.expense : d.spent >= d.budget * 0.75 ? C.warning : C.sage} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export const ALLOCATION_COLORS = ['#0969da', '#2da44e', '#8250df', '#bf3989', '#bc4c00', '#d4a72c', '#1b7c83', '#cf222e', '#6e7781', '#a475f9'];
