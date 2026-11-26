import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartColors } from '../../hooks/useTheme';
import { axisPropsFor, gridPropsFor } from '../../components/charts/ChartTooltip';
import type { PricePoint } from '../../services/research/types';
import { fmtBig, fmtPct, fmtPrice } from './format';

const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: '2-digit' });

export function PriceChart({ points, currency, height = 260 }: { points: PricePoint[]; currency?: string; height?: number }) {
  const c = useChartColors();
  return (
    <div className="chart-box" style={{ height }} data-testid="price-chart">
      <ResponsiveContainer>
        <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="g-price" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c.accent} stopOpacity={0.2} />
              <stop offset="100%" stopColor={c.accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...gridPropsFor(c)} />
          <XAxis dataKey="date" tickFormatter={day} minTickGap={40} {...axisPropsFor(c)} />
          <YAxis domain={['auto', 'auto']} width={60} tickFormatter={(v) => fmtPrice(v)} {...axisPropsFor(c)} />
          <Tooltip formatter={(v) => fmtPrice(Number(v), currency)} labelFormatter={(l) => day(String(l))} contentStyle={{ background: c.surface, border: `1px solid ${c.grid}`, fontSize: 12 }} />
          <Area type="monotone" dataKey="close" name="Chiusura" stroke={c.accent} strokeWidth={1.6} fill="url(#g-price)" dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function VolumeChart({ points, height = 90 }: { points: PricePoint[]; height?: number }) {
  const c = useChartColors();
  if (!points.some((p) => p.volume)) return null;
  return (
    <div className="chart-box" style={{ height }}>
      <ResponsiveContainer>
        <BarChart data={points} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
          <XAxis dataKey="date" hide />
          <YAxis width={60} tickFormatter={(v) => fmtBig(v)} {...axisPropsFor(c)} />
          <Tooltip formatter={(v) => fmtBig(Number(v))} labelFormatter={(l) => day(String(l))} contentStyle={{ background: c.surface, border: `1px solid ${c.grid}`, fontSize: 12 }} />
          <Bar dataKey="volume" name="Volume" fill={c.muted} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CompareChart({ data, aLabel, bLabel, height = 220 }: { data: Array<{ date: string; a: number; b: number }>; aLabel: string; bLabel: string; height?: number }) {
  const c = useChartColors();
  return (
    <div className="chart-box" style={{ height }} data-testid="benchmark-chart">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid {...gridPropsFor(c)} />
          <XAxis dataKey="date" tickFormatter={day} minTickGap={40} {...axisPropsFor(c)} />
          <YAxis domain={['auto', 'auto']} width={44} {...axisPropsFor(c)} />
          <Tooltip formatter={(v) => Number(v).toFixed(1)} labelFormatter={(l) => day(String(l))} contentStyle={{ background: c.surface, border: `1px solid ${c.grid}`, fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="a" name={aLabel} stroke={c.accent} dot={false} strokeWidth={1.6} isAnimationActive={false} />
          <Line type="monotone" dataKey="b" name={bLabel} stroke={c.muted} dot={false} strokeWidth={1.4} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DrawdownChart({ data, height = 140 }: { data: Array<{ date: string; drawdown: number }>; height?: number }) {
  const c = useChartColors();
  return (
    <div className="chart-box" style={{ height }} data-testid="drawdown-chart">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid {...gridPropsFor(c)} />
          <XAxis dataKey="date" tickFormatter={day} minTickGap={40} {...axisPropsFor(c)} />
          <YAxis width={44} tickFormatter={(v) => fmtPct(v, 0)} {...axisPropsFor(c)} />
          <Tooltip formatter={(v) => fmtPct(Number(v))} labelFormatter={(l) => day(String(l))} contentStyle={{ background: c.surface, border: `1px solid ${c.grid}`, fontSize: 12 }} />
          <Area type="monotone" dataKey="drawdown" name="Drawdown" stroke={c.expense} fill={c.expense} fillOpacity={0.12} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
