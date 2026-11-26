import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Bell } from 'lucide-react';
import { db } from '../database/db';
import { useFinanceModel } from '../hooks/useFinanceModel';
import { formatDate } from '../utils/date';
import { formatMoney } from '../utils/money';

interface Note {
  id: string;
  kind: 'alta' | 'media' | 'info';
  text: string;
  href: string;
}

/** Notifiche locali: insight ad alta priorità, consensi bancari in scadenza, scadenze dei prossimi 7 giorni. */
export function Notifications() {
  const model = useFinanceModel();
  const consents = useLiveQuery(() => db.bank_connections.toArray(), []);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, [open]);

  const notes: Note[] = [];
  for (const c of consents ?? []) {
    const left = new Date(c.validUntil).getTime() - Date.now();
    if (c.status !== 'active' || left < 7 * 86400000) notes.push({ id: `c-${c.id}`, kind: 'alta', text: `${c.aspspName}: consenso ${c.status !== 'active' || left < 0 ? 'scaduto' : 'in scadenza'}`, href: '#/banks' });
  }
  if (model) {
    for (const i of model.insights.filter((i) => i.priority === 'alta')) notes.push({ id: i.id, kind: 'alta', text: i.title, href: i.href ?? '#/insights' });
    const week = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    for (const u of model.upcoming.filter((u) => u.date <= week)) notes.push({ id: `u-${u.item.id}-${u.date}`, kind: 'info', text: `${formatDate(u.date)} · ${u.item.name} ${formatMoney(u.item.amount, u.item.currency, { sign: true })}`, href: '#/budgets' });
  }
  const urgent = notes.filter((n) => n.kind === 'alta').length;

  return (
    <div className="notif" ref={ref}>
      <button className="btn icon-btn" aria-label={`Notifiche: ${notes.length}`} aria-expanded={open} onClick={() => setOpen(!open)} data-testid="notifications">
        <Bell size={16} />
        {notes.length > 0 && <span className={`notif-badge${urgent ? ' urgent' : ''}`}>{notes.length}</span>}
      </button>
      {open && (
        <div className="notif-menu" role="dialog" aria-label="Notifiche">
          {notes.length === 0 ? (
            <p className="small muted" style={{ padding: 12 }}>Nessuna notifica.</p>
          ) : (
            notes.map((n) => (
              <a key={n.id} href={n.href} className={`notif-item ${n.kind}`} onClick={() => setOpen(false)}>
                {n.text}
              </a>
            ))
          )}
        </div>
      )}
    </div>
  );
}
