import type { ReactNode } from 'react';
import { AlertTriangle, Info } from 'lucide-react';

export function EmptyState({ icon, title, text, children, compact }: { icon: ReactNode; title: string; text?: ReactNode; children?: ReactNode; compact?: boolean }) {
  return (
    <div className={`empty${compact ? ' compact' : ''}`}>
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {children && <div className="actions">{children}</div>}
    </div>
  );
}

export function Skeleton({ h = 16, w = '100%', style }: { h?: number; w?: number | string; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ height: h, width: w, ...style }} aria-hidden="true" />;
}

export function PageSkeleton() {
  return (
    <div className="stack" aria-busy="true" aria-label="Caricamento">
      <Skeleton h={34} w={260} />
      <div className="grid grid-3">
        <Skeleton h={120} />
        <Skeleton h={120} />
        <Skeleton h={120} />
      </div>
      <Skeleton h={300} />
    </div>
  );
}

export function Callout({ kind = 'info', children }: { kind?: 'info' | 'warning' | 'danger'; children: ReactNode }) {
  return (
    <div className={`callout ${kind === 'info' ? '' : kind}`} role={kind === 'danger' ? 'alert' : undefined}>
      {kind === 'info' ? <Info size={16} /> : <AlertTriangle size={16} />}
      <div>{children}</div>
    </div>
  );
}

export function Tip({ text }: { text: string }) {
  return (
    <span className="tip" tabIndex={0} aria-label={text}>
      <Info size={13} />
      <span className="tip-bubble" role="tooltip">
        {text}
      </span>
    </span>
  );
}

export function ProgressBar({ value, kind, thick, label }: { value: number; kind?: 'warning' | 'danger' | 'income'; thick?: boolean; label?: string }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1)) * 100;
  return (
    <div className={`bar${kind ? ` is-${kind}` : ''}${thick ? ' thick' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}
