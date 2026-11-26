import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarPlus, Pencil, Plus, Repeat, Trash2 } from 'lucide-react';
import { db } from '../../database/db';
import { useDataSet } from '../../hooks/useData';
import { useToast } from '../../hooks/useToast';
import { buildInsights } from '../../services/ai/insights';
import { deleteScheduled, FREQUENCY_LABELS, saveScheduled, SCHEDULED_KIND_LABELS } from '../../services/scheduled';
import type { ScheduledItem } from '../../types';
import { formatDate, todayISO } from '../../utils/date';
import { formatMoney } from '../../utils/money';
import { Modal } from '../../components/ui/Modal';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';

type Draft = Omit<ScheduledItem, 'id'> & { id?: string };

const KIND_FROM_CATEGORY: Record<string, ScheduledItem['kind']> = { 'exp-subscriptions': 'subscription', 'exp-bills': 'bill', 'exp-insurance': 'insurance', 'exp-home': 'rent', 'inv-buy': 'investment' };

/** Movimenti pianificati: alimentano la previsione di fine mese e le proiezioni. */
export function ScheduledManager() {
  const ds = useDataSet();
  const toast = useToast();
  const items = useLiveQuery(() => db.scheduled_items.orderBy('nextDate').toArray(), []);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [del, setDel] = useState<ScheduledItem | null>(null);
  const suggestions = useMemo(() => {
    if (!ds || !items) return [];
    const have = new Set(items.map((i) => i.merchant).filter(Boolean));
    return buildInsights(ds).recurring.filter((r) => !have.has(r.merchant));
  }, [ds, items]);
  const cur = ds?.settings.baseCurrency ?? 'EUR';

  const blank = (): Draft => ({ name: '', kind: 'bill', amount: 0, currency: cur, frequency: 'monthly', nextDate: todayISO(), endDate: null, accountId: null, fixedAmount: true });

  return (
    <section className="panel" id="pianificati" data-testid="scheduled">
      <div className="panel-head">
        <h2>
          <CalendarPlus size={16} style={{ verticalAlign: -3, marginRight: 8 }} />
          Movimenti pianificati
        </h2>
        <button className="btn btn-sm" onClick={() => setEdit(blank())}>
          <Plus size={14} /> Aggiungi
        </button>
      </div>
      <p className="small muted" style={{ marginBottom: 10 }}>
        Stipendio, affitto, bollette, assicurazioni, abbonamenti e rate. Gli importi fissi entrano nella previsione come <strong>programmati</strong>, quelli variabili come <strong>stimati</strong>.
      </p>
      {items && items.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Voce</th>
                <th>Frequenza</th>
                <th>Prossima</th>
                <th className="right">Importo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>
                    {i.name} <span className="xs muted">· {SCHEDULED_KIND_LABELS[i.kind]}{i.fixedAmount ? '' : ' · importo stimato'}</span>
                  </td>
                  <td>{FREQUENCY_LABELS[i.frequency]}</td>
                  <td className="num">{formatDate(i.nextDate)}</td>
                  <td className={`amount ${i.amount < 0 ? 'neg' : 'pos'}`}>{formatMoney(i.amount, i.currency, { sign: true })}</td>
                  <td className="right">
                    <button className="btn btn-ghost icon-btn" aria-label={`Modifica ${i.name}`} onClick={() => setEdit(i)}>
                      <Pencil size={14} />
                    </button>
                    <button className="btn btn-ghost icon-btn" aria-label={`Elimina ${i.name}`} onClick={() => setDel(i)}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="small muted">Nessun movimento pianificato.</p>
      )}
      {suggestions.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <p className="small" style={{ marginBottom: 6 }}>
            <Repeat size={13} style={{ verticalAlign: -2 }} /> Ricorrenti rilevati nei tuoi movimenti (aggiungili per renderli programmati):
          </p>
          <div className="chips">
            {suggestions.slice(0, 10).map((r) => (
              <button
                key={r.merchant}
                className="chip"
                onClick={() =>
                  setEdit({
                    ...blank(),
                    name: r.description,
                    kind: r.kind === 'income' ? 'income' : (KIND_FROM_CATEGORY[r.categoryId ?? ''] ?? 'other'),
                    amount: r.kind === 'income' ? r.amount : -r.amount,
                    nextDate: r.nextExpected < todayISO() ? todayISO() : r.nextExpected,
                    merchant: r.merchant,
                  })
                }
              >
                {r.description} · {formatMoney(r.kind === 'income' ? r.amount : -r.amount, cur, { sign: true })}
              </button>
            ))}
          </div>
        </div>
      )}
      {edit && <ScheduledForm draft={edit} accounts={ds?.accounts ?? []} onClose={() => setEdit(null)} onSave={async (d) => {
        await saveScheduled(d);
        toast.success(d.id ? 'Movimento pianificato aggiornato.' : 'Movimento pianificato aggiunto.');
        setEdit(null);
      }} />}
      {del && (
        <ConfirmDialog
          title="Eliminare questo movimento pianificato?"
          message={`"${del.name}" non verrà più considerato nelle previsioni. I movimenti registrati non vengono toccati.`}
          confirmLabel="Elimina"
          onClose={() => setDel(null)}
          onConfirm={async () => {
            await deleteScheduled(del.id);
            toast.success('Movimento pianificato eliminato.');
          }}
        />
      )}
    </section>
  );
}

function ScheduledForm({ draft, accounts, onClose, onSave }: { draft: Draft; accounts: Array<{ id: string; name: string }>; onClose: () => void; onSave: (d: Draft) => Promise<void> }) {
  const toast = useToast();
  const [d, setD] = useState<Draft>(draft);
  const [abs, setAbs] = useState<number | null>(draft.amount ? Math.abs(draft.amount) : null);
  const isIncome = d.kind === 'income';
  const submit = async () => {
    try {
      await onSave({ ...d, amount: (abs ?? 0) * (isIncome ? 1 : -1) });
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Modal
      title={d.id ? 'Modifica movimento pianificato' : 'Nuovo movimento pianificato'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Annulla
          </button>
          <button className="btn btn-primary" onClick={submit}>
            Salva
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        <div className="field">
          <label htmlFor="sc-name">Nome</label>
          <input id="sc-name" className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="sc-kind">Tipo</label>
            <select id="sc-kind" className="select" value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as ScheduledItem['kind'] })}>
              {Object.entries(SCHEDULED_KIND_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sc-amount">{isIncome ? 'Importo in entrata' : 'Importo in uscita'}</label>
            <MoneyInput id="sc-amount" value={abs} onChange={setAbs} currency={d.currency} />
          </div>
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="sc-freq">Frequenza</label>
            <select id="sc-freq" className="select" value={d.frequency} onChange={(e) => setD({ ...d, frequency: e.target.value as ScheduledItem['frequency'] })}>
              {Object.entries(FREQUENCY_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sc-next">Prossima scadenza</label>
            <input id="sc-next" type="date" className="input" value={d.nextDate} onChange={(e) => setD({ ...d, nextDate: e.target.value })} />
          </div>
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="sc-end">Fine (facoltativa)</label>
            <input id="sc-end" type="date" className="input" value={d.endDate ?? ''} onChange={(e) => setD({ ...d, endDate: e.target.value || null })} />
          </div>
          <div className="field">
            <label htmlFor="sc-acc">Conto (facoltativo)</label>
            <select id="sc-acc" className="select" value={d.accountId ?? ''} onChange={(e) => setD({ ...d, accountId: e.target.value || null })}>
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={d.fixedAmount} onChange={(e) => setD({ ...d, fixedAmount: e.target.checked })} />
          <span>Importo fisso (contratto, stipendio). Se varia, come una bolletta, lascialo deselezionato: sarà una stima.</span>
        </label>
      </div>
    </Modal>
  );
}
