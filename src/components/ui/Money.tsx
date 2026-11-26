import type { Cents } from '../../types';
import { formatMoney } from '../../utils/money';

interface Props {
  value: Cents;
  currency?: string;
  sign?: boolean;
  colored?: boolean;
  compact?: boolean;
  className?: string;
}

export function Money({ value, currency = 'EUR', sign, colored, compact, className = '' }: Props) {
  const color = colored ? (value > 0 ? 'pos' : value < 0 ? 'neg' : '') : '';
  return <span className={`num ${color} ${className}`.trim()}>{formatMoney(value, currency, { sign, compact })}</span>;
}
