import { formatMoney } from '../../utils/money';

interface Item {
  name?: string | number;
  value?: unknown;
  color?: string;
}

export function makeMoneyTooltip(currency: string, labelFormatter?: (l: string) => string) {
  return function MoneyTooltip({ active, payload, label }: { active?: boolean; payload?: readonly Item[]; label?: string | number }) {
    if (!active || !payload?.length) return null;
    return (
      <div className="chart-tooltip">
        {label !== undefined && <strong>{labelFormatter ? labelFormatter(String(label)) : label}</strong>}
        {payload.map((p, i) => (
          <div className="line num" key={i}>
            <i style={{ width: 8, height: 8, borderRadius: 2, background: p.color, display: 'inline-block' }} />
            {p.name}: {formatMoney(Number(p.value), currency)}
          </div>
        ))}
      </div>
    );
  };
}

import type { ChartColors } from '../../hooks/useTheme';

export const axisPropsFor = (c: ChartColors) =>
  ({
    stroke: c.grid,
    tick: { fill: c.axis, fontSize: 11 },
    tickLine: false,
    axisLine: false,
  }) as const;

export const gridPropsFor = (c: ChartColors) => ({ stroke: c.grid, strokeDasharray: '3 3', vertical: false }) as const;
