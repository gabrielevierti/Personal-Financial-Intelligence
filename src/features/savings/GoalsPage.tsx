import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../database/db';
import { Flag, Minus, Pencil, Plus, Target, Trash2 } from 'lucide-react';
import type { Cents, GoalPriority, SavingsGoal } from '../../types';
import { useDataSet } from '../../hooks/useData';
import { errorMessage, useToast } from '../../hooks/useToast';
import { goalProgress, makeConverter, monthlySeries } from '../../services/finance';
import { contributeToGoal, createGoal, deleteGoal, updateGoal, type GoalInput } from '../../services/repository';
import { addMonths, currentMonth, formatDate } from '../../utils/date';
import { formatMoney, formatPercent } from '../../utils/money';
import { Modal } from '../../components/ui/Modal';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState, PageSkeleton, ProgressBar, Tip } from '../../components/ui/States';

const PRIORITY: Record<GoalPriority, { label: string; cls: string; order: number }> = {
  high: { label: 'Priorità alta', cls: 'badge-expense', order: 0 },
  medium: { label: 'Priorità media', cls: 'badge-warning', order: 1 },
  low: { label: 'Priorità bassa', cls: 'badge-sage', order: 2 },
};

function monthsText(n: number | null): string {
  if (n === null) return '—';
  if (n === 0) return 'Raggiunto';
  if (n < 12) return `${n} ${n === 1 ? 'mese' : 'mesi'}`;
  const y = Math.floor(n / 12);
  const m = n % 12;
  return `${y} ${y === 1 ? 'anno' : 'anni'}${m ? ` e ${m} ${m === 1 ? 'mese' : 'mesi'}` : ''}`;
}

export function GoalsPage() {
  const ds = useDataSet();
  const toast = useToast();
  const [editing, setEditing] = useState<SavingsGoal | 'new' | null>(null);
  const [moving, setMoving] = useState<{ goal: SavingsGoal; dir: 1 | -1 } | null>(null);
  const [deleting, setDeleting] = useState<SavingsGoal | null>(null);
  const live = useLiveQuery(() => db.savings_goals.toArray(), []);

  const avgSavings = useMemo(() => {
    if (!ds) return 0;
    const months = Array.from({ length: 6 }, (_, i) => addMonths(currentMonth(), i - 6));
    const s = monthlySeries(ds.transactions, months, makeConverter(ds.settings)).filter((p) => p.income || p.expense);
    return s.length ? Math.round(s.reduce((a, p) => a + p.net, 0) / s.length) : 0;
  }, [ds]);

  if (!ds || !live) return <PageSkeleton />;
  const cur = ds.settings.baseCurrency;
  const list = live.slice().sort((a, b) => PRIORITY[a.priority].order - PRIORITY[b.priority].order || (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999'));
  const totalTarget = list.reduce((s, g) => s + g.targetAmount, 0);
  const totalSaved = list.reduce((s, g) => s + Math.min(g.currentAmount, g.targetAmount), 0);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Obiettivi di risparmio</h1>
          <p>
            {list.length > 0 ? (
              <>
                {formatMoney(totalSaved, cur)} accantonati su {formatMoney(totalTarget, cur)} ({formatPercent(totalTarget ? totalSaved / totalTarget : null, 0)}). Risparmio medio mensile degli ultimi 6 mesi: <strong className="num">{formatMoney(avgSavings, cur)}</strong>{' '}
                <Tip text="Usato per stimare il tempo necessario a raggiungere ciascun obiettivo, se dedicato interamente a quell'obiettivo." />
              </>
            ) : (
              'Dai un nome a ciò per cui stai risparmiando e segui i progressi.'
            )}
          </p>
        </div>
        <div className="actions">
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Plus size={16} /> Nuovo obiettivo
          </button>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="panel">
          <EmptyState icon={<Target size={22} />} title="Nessun obiettivo" text="Fondo di emergenza, auto nuova, viaggio: imposta importo e data, PFI calcola quanto mettere da parte ogni mese.">
            <button className="btn btn-primary" onClick={() => setEditing('new')}>
              <Plus size={16} /> Crea un obiettivo
            </button>
          </EmptyState>
        </div>
      ) : (
        <div className="tile-grid">
          {list.map((g) => {
            const p = goalProgress(g, avgSavings);
            return (
              <article className="tile" key={g.id} data-testid="goal-tile">
                <div className="tile-top">
                  <div style={{ minWidth: 0 }}>
                    <div className="item-title">{g.name}</div>
                    <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      <span className={`badge ${PRIORITY[g.priority].cls}`}>
                        <Flag size={10} /> {PRIORITY[g.priority].label}
                      </span>
                      {p.completed && <span className="badge badge-income">Completato</span>}
                      {p.overdue && <span className="badge badge-expense">Scaduto</span>}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 0 }}>
                    <button className="btn btn-ghost icon-btn" aria-label={`Modifica ${g.name}`} onClick={() => setEditing(g)}>
                      <Pencil size={14} />
                    </button>
                    <button className="btn btn-ghost icon-btn" aria-label={`Elimina ${g.name}`} onClick={() => setDeleting(g)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {g.description && <p className="small muted">{g.description}</p>}
                <div>
                  <div className="spread" style={{ marginBottom: 8 }}>
                    <span className="tile-value num">{formatMoney(g.currentAmount, cur)}</span>
                    <span className="small muted num">su {formatMoney(g.targetAmount, cur)}</span>
                  </div>
                  <ProgressBar value={p.progress} thick kind={p.completed ? 'income' : undefined} label={`Avanzamento ${g.name}`} />
                </div>
                <dl className="kv">
                  <dt>Completato</dt>
                  <dd data-testid="goal-progress">{formatPercent(p.progress, 0)}</dd>
                  <dt>Importo rimanente</dt>
                  <dd>{formatMoney(p.remaining, cur)}</dd>
                  <dt>Data obiettivo</dt>
                  <dd>{g.targetDate ? formatDate(g.targetDate) : 'Non impostata'}</dd>
                  <dt>Risparmio mensile necessario</dt>
                  <dd>{p.monthlyNeeded === null ? 'Serve una data' : formatMoney(p.monthlyNeeded, cur)}</dd>
                  <dt>Tempo stimato</dt>
                  <dd>{p.estimatedMonths === null ? 'Risparmio medio non positivo' : monthsText(p.estimatedMonths)}</dd>
                </dl>
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn btn-sm" style={{ flex: 1 }} onClick={() => setMoving({ goal: g, dir: 1 })}>
                    <Plus size={13} /> Aggiungi
                  </button>
                  <button className="btn btn-sm btn-ghost" style={{ flex: 1 }} disabled={g.currentAmount === 0} onClick={() => setMoving({ goal: g, dir: -1 })}>
                    <Minus size={13} /> Preleva
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {editing && <GoalForm goal={editing === 'new' ? null : editing} currency={cur} onClose={() => setEditing(null)} />}
      {moving && <ContributionForm goal={moving.goal} dir={moving.dir} currency={cur} onClose={() => setMoving(null)} />}
      {deleting && (
        <ConfirmDialog
          title={`Eliminare "${deleting.name}"?`}
          message="L'obiettivo e l'importo accumulato registrato verranno rimossi. I conti e i movimenti non vengono toccati."
          confirmLabel="Elimina obiettivo"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await deleteGoal(deleting.id);
            toast.success('Obiettivo eliminato.');
          }}
        />
      )}
    </div>
  );
}


function GoalForm({ goal, currency, onClose }: { goal: SavingsGoal | null; currency: string; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<GoalInput>(goal ? { name: goal.name, targetAmount: goal.targetAmount, currentAmount: goal.currentAmount, targetDate: goal.targetDate, priority: goal.priority, description: goal.description } : { name: '', targetAmount: 0, currentAmount: 0, targetDate: null, priority: 'medium', description: '' });
  const [target, setTarget] = useState<Cents | null>(goal?.targetAmount ?? null);
  const [current, setCurrent] = useState<Cents | null>(goal?.currentAmount ?? 0);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const input = { ...f, targetAmount: target ?? 0, currentAmount: current ?? 0 };
      if (goal) await updateGoal(goal.id, input);
      else await createGoal(input);
      toast.success(goal ? 'Obiettivo aggiornato.' : 'Obiettivo creato.');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Modal
      title={goal ? 'Modifica obiettivo' : 'Nuovo obiettivo'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Annulla
          </button>
          <button className="btn btn-primary" type="submit" form="goal-form">
            {goal ? 'Salva modifiche' : 'Crea obiettivo'}
          </button>
        </>
      }
    >
      <form id="goal-form" className="form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="g-name">Nome</label>
          <input id="g-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Es. Fondo di emergenza" maxLength={80} />
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="g-target">Importo desiderato</label>
            <MoneyInput id="g-target" value={target} onChange={setTarget} currency={currency} />
          </div>
          <div className="field">
            <label htmlFor="g-current">Importo già accumulato</label>
            <MoneyInput id="g-current" value={current} onChange={setCurrent} currency={currency} />
          </div>
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="g-date">Data obiettivo</label>
            <input id="g-date" type="date" className="input" value={f.targetDate ?? ''} onChange={(e) => setF({ ...f, targetDate: e.target.value || null })} />
          </div>
          <div className="field">
            <label htmlFor="g-prio">Priorità</label>
            <select id="g-prio" className="select" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as GoalPriority })}>
              <option value="high">Alta</option>
              <option value="medium">Media</option>
              <option value="low">Bassa</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="g-desc">Descrizione</label>
          <textarea id="g-desc" className="textarea" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={500} />
        </div>
        {error && (
          <p className="small" role="alert" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

function ContributionForm({ goal, dir, currency, onClose }: { goal: SavingsGoal; dir: 1 | -1; currency: string; onClose: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState<Cents | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || amount <= 0) return setError('Inserisci un importo maggiore di zero.');
    try {
      await contributeToGoal(goal.id, dir * amount);
      toast.success(dir > 0 ? `Aggiunti ${formatMoney(amount, currency)} a ${goal.name}.` : `Prelevati ${formatMoney(amount, currency)} da ${goal.name}.`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Modal
      title={dir > 0 ? `Aggiungi a ${goal.name}` : `Preleva da ${goal.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Annulla
          </button>
          <button className="btn btn-primary" type="submit" form="contrib-form">
            {dir > 0 ? 'Aggiungi importo' : 'Preleva importo'}
          </button>
        </>
      }
    >
      <form id="contrib-form" className="form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="c-amount">Importo</label>
          <MoneyInput id="c-amount" value={amount} onChange={setAmount} currency={currency} />
          <span className="help">Aggiorna solo l'importo accumulato dell'obiettivo. Per spostare denaro tra conti usa un trasferimento.</span>
        </div>
        {error && (
          <p className="small" role="alert" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
