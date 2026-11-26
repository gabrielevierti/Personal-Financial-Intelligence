import { useEffect, useState } from 'react';
import type { Cents } from '../../types';
import { centsToInput, parseAmount } from '../../utils/money';

interface Props {
  id?: string;
  value: Cents | null;
  onChange: (v: Cents | null) => void;
  allowNegative?: boolean;
  placeholder?: string;
  currency?: string;
  invalid?: boolean;
  ariaLabel?: string;
}

/** Input importi: accetta "1.234,56" o "1234.56" e restituisce centesimi interi. */
export function MoneyInput({ id, value, onChange, allowNegative = false, placeholder = '0,00', currency, invalid, ariaLabel }: Props) {
  const [text, setText] = useState(value === null ? '' : centsToInput(value));
  useEffect(() => {
    const parsed = parseAmount(text);
    if (parsed !== value) setText(value === null ? '' : centsToInput(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div style={{ position: 'relative' }}>
      <input
        id={id}
        className="input input-money"
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        aria-label={ariaLabel}
        style={currency ? { paddingRight: 52 } : undefined}
        onChange={(e) => {
          const t = e.target.value;
          if (!/^[-+]?[\d.,'\s]*$/.test(t)) return;
          if (!allowNegative && t.startsWith('-')) return;
          setText(t);
          onChange(t.trim() === '' ? null : parseAmount(t));
        }}
        onBlur={() => value !== null && setText(centsToInput(value))}
      />
      {currency && (
        <span className="muted small" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }}>
          {currency}
        </span>
      )}
    </div>
  );
}
