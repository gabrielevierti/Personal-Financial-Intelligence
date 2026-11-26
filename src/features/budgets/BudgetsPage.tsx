import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Copy, Pencil, PiggyBank, Plus, Trash2 } from 'lucide-react';
import type { Budget, Category, Cents } from '../../types';
import { useDataSet } from '../../hooks/useData';
import { errorMessage, useToast } from '../../hooks/useToast';
import { budgetStatuses, makeConverter, monthlySeries, type BudgetLevel, type BudgetStatus } from '../../services/finance';
import { copyBudgets, deleteBudget, upsertBudget } from '../../services/repository';
import { addMonths, currentMonth, formatMonth } from '../../utils/date';
import { formatMoney, formatPercent } from '../../utils/money';
import { Modal } from '../../components/ui/Modal';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Callout, EmptyState, PageSkeleton, ProgressBar } from '../../components/ui/States';
import { CategoryIcon } from '../../components/ui/CategoryIcon';
import { BudgetEvolutionChart } from '../../components/charts/Charts';
import { ScheduledManager } from './ScheduledManager';

const LEVEL_TEXT: Record<BudgetLevel, string> = {
  ok: 'Nei limiti',
  warning75: 'Raggiunto il 75%',
  warning90: 'Raggiunto il 90%',
  exceeded: 'Budget superato',
};

export function BudgetsPage() {
  const ds = useDataSet();
  const toast = useToast();
  const [month, setMonth] = useState(currentMonth());
  const [editing, setEditing] = useState<Budget | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Budget | null>(null);

  const view = useMemo(() => {
    if (!ds) return null;
    const conv = makeConverter(ds.settings);
    const statuses = budgetStatuses(ds.budgets, ds.transactions, month, conv);
    const total = statuses.find((s) => s.budget.categoryId === null) ?? null;
    const byCat = statuses.filter((s) => s.budget.categoryId !== null).sort((a, b) => b.usage - a.usage);
    const months = Array.from({ length: 6 }, (_, i) => addMonths(month, i - 5));
    const series = monthlySeries(ds.transactions, months, conv);
    const evolution = months.map((m, i) => {
      const bs = ds.budgets.filter((b) => b.month === m);
      const t = bs.find((b) => b.categoryId === null);
      return { month: m, budget: t ? t.limit : bs.reduce((s, b) => s + b.limit, 0), spent: series[i].expense };
    });
    const prevHas = ds.budgets.some((b) => b.month === addMonths(month, -1));
    return { statuses, total, byCat, evolution, prevHas };
  }, [ds, month]);

  if (!ds || !view) return <PageSkeleton />;
  const cur = ds.settings.baseCurrency;
  const catMap = new Map(ds.categories.map((c) => [c.id, c]));
  const alerts = view.statuses.filter((s) => s.level !== 'ok');
  const sumCat = view.byCat.reduce((s, b) => s + b.budget.limit, 0);
  const spentCat = view.byCat.reduce((s, b) => s + b.spent, 0);
  const headline: { limit: Cents; spent: Cents } | null = view.total ? { limit: view.total.budget.limit, spent: view.total.spent } : view.byCat.length ? { limit: sumCat, spent: spentCat } : null;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Budget</h1>
          <p>Limiti di spesa mensili, totali o per categoria. Gli avvisi scattano al 75%, al 90% e oltre il 100%.</p>
        </div>
        <div className="actions">
          <div className="row" style={{ gap: 4 }}>
            <button className="btn icon-btn" aria-label="Mese precedente" onClick={() => setMonth(addMonths(month, -1))}>
              <ChevronLeft size={16} />
            </button>
            <span style={{ minWidth: 130, textAlign: 'center', fontWeight: 500, textTransform: 'capitalize' }} data-testid="budget-month">
              {formatMonth(month, true)}
            </span>
            <button className="btn icon-btn" aria-label="Mese successivo" onClick={() => setMonth(addMonths(month, 1))}>
              <ChevronRight size={16} />
            </button>
          </div>
          {view.prevHas && (
            <button
              className="btn"
              onClick={async () => {
                try {
                  const n = await copyBudgets(addMonths(month, -1), month);
                  toast.success(`Copiati ${n} budget da ${formatMonth(addMonths(month, -1), true)}.`);
                } catch (e) {
                  toast.error(e);
                }
              }}
            >
              <Copy size={15} /> Copia dal mese precedente
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Plus size={16} /> Nuovo budget
          </button>
        </div>
      </div>

      {view.statuses.length === 0 ? (
        <div className="panel">
          <EmptyState icon={<PiggyBank size={22} />} title={`Nessun budget per ${formatMonth(month, true)}`} text="Definisci un budget totale per il mese o limiti per singole categorie di spesa.">
            <button className="btn btn-primary" onClick={() => setEditing('new')}>
              <Plus size={16} /> Crea un budget
            </button>
          </EmptyState>
        </div>
      ) : (
        <>
          {alerts.length > 0 && (
            <div className="stack" style={{ marginBottom: 16, gap: 8 }} data-testid="budget-alerts">
              {alerts.map((a) => (
                <Callout key={a.budget.id} kind={a.level === 'exceeded' ? 'danger' : 'warning'}>
                  <strong>{a.budget.categoryId ? catMap.get(a.budget.categoryId)?.name : 'Budget totale'}</strong>: {LEVEL_TEXT[a.level].toLowerCase()} ({formatPercent(a.usage, 0)} · {formatMoney(a.spent, cur)} su {formatMoney(a.budget.limit, cur)})
                </Callout>
              ))}
            </div>
          )}
          {headline && (
            <section className="ledger" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
              <div className="ledger-cell">
                <div className="ledger-label">{view.total ? 'Budget totale' : 'Somma budget di categoria'}</div>
                <div className="ledger-value num">{formatMoney(headline.limit, cur)}</div>
              </div>
              <div className="ledger-cell">
                <div className="ledger-label">Speso</div>
                <div className="ledger-value num neg">{formatMoney(headline.spent, cur)}</div>
              </div>
              <div className="ledger-cell">
                <div className="ledger-label">Residuo</div>
                <div className={`ledger-value num ${headline.limit - headline.spent < 0 ? 'neg' : 'pos'}`}>{formatMoney(headline.limit - headline.spent, cur)}</div>
              </div>
              <div className="ledger-cell">
                <div className="ledger-label">Percentuale utilizzata</div>
                <div className="ledger-value num">{formatPercent(headline.limit > 0 ? headline.spent / headline.limit : null, 0)}</div>
              </div>
            </section>
          )}
          <div className="grid grid-main-side">
            <section className="panel flush">
              <div className="panel-head">
                <h2>Budget del mese</h2>
                <span className="hint">{view.statuses.length} limiti</span>
              </div>
              <div className="item-list" style={{ marginTop: 8 }}>
                {[...(view.total ? [view.total] : []), ...view.byCat].map((s) => (
                  <BudgetRow key={s.budget.id} s={s} cur={cur} cat={s.budget.categoryId ? catMap.get(s.budget.categoryId) : undefined} onEdit={() => setEditing(s.budget)} onDelete={() => setDeleting(s.budget)} />
                ))}
              </div>
            </section>
            <section className="panel">
              <div className="panel-head">
                <h2>Evoluzione dei budget</h2>
                <span className="hint">Ultimi 6 mesi</span>
              </div>
              <BudgetEvolutionChart data={view.evolution} currency={cur} />
            </section>
          </div>
        </>
      )}

      {editing && <BudgetForm month={month} budget={editing === 'new' ? null : editing} existing={view.statuses.map((s) => s.budget)} categories={ds.categories} currency={cur} onClose={() => setEditing(null)} />}
      {deleting && (
        <ConfirmDialog
          title="Eliminare questo budget?"
          message={`Il limite per ${deleting.categoryId ? catMap.get(deleting.categoryId)?.name : 'il totale del mese'} di ${formatMonth(month, true)} verrà rimosso. I movimenti non vengono toccati.`}
          confirmLabel="Elimina budget"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await deleteBudget(deleting.id);
            toast.success('Budget eliminato.');
          }}
        />
      )}
      <div style={{ marginTop: 16 }}>
        <ScheduledManager />
      </div>
    </div>
  );
}

function BudgetRow({ s, cur, cat, onEdit, onDelete }: { s: BudgetStatus; cur: string; cat?: { name: string; icon: string; color: string }; onEdit: () => void; onDelete: () => void }) {
  const kind = s.level === 'exceeded' ? 'danger' : s.level === 'ok' ? undefined : 'warning';
  return (
    <div className="item" style={{ gridTemplateColumns: 'auto 1fr auto' }} data-testid="budget-row">
      <div className="item-icon" style={cat ? { color: cat.color } : undefined}>
        {cat ? <CategoryIcon icon={cat.icon} size={17} /> : <PiggyBank size={17} />}
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="spread">
          <span className="item-title">{cat ? cat.name : 'Budget totale del mese'}</span>
          <span className="small num">
            {formatMoney(s.spent, cur)} <span className="muted">/ {formatMoney(s.budget.limit, cur)}</span>
          </span>
        </div>
        <div style={{ margin: '8px 0 6px' }}>
          <ProgressBar value={s.usage} kind={kind} label={`Utilizzo ${cat?.name ?? 'totale'}`} />
        </div>
        <div className="spread xs">
          <span className={s.level === 'ok' ? 'muted' : s.level === 'exceeded' ? 'neg' : 'warn'}>
            {s.level !== 'ok' && <AlertTriangle size={11} style={{ verticalAlign: -1, marginRight: 4 }} />}
            {LEVEL_TEXT[s.level]} · {formatPercent(Number.isFinite(s.usage) ? s.usage : null, 0)}
          </span>
          <span className={`num ${s.remaining < 0 ? 'neg' : 'muted'}`}>{s.remaining < 0 ? `Sforato di ${formatMoney(-s.remaining, cur)}` : `Residuo ${formatMoney(s.remaining, cur)}`}</span>
        </div>
      </div>
      <div className="row" style={{ gap: 0 }}>
        <button className="btn btn-ghost icon-btn" aria-label="Modifica budget" onClick={onEdit}>
          <Pencil size={14} />
        </button>
        <button className="btn btn-ghost icon-btn" aria-label="Elimina budget" onClick={onDelete}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function BudgetForm({ month, budget, existing, categories, currency, onClose }: { month: string; budget: Budget | null; existing: Budget[]; categories: Category[]; currency: string; onClose: () => void }) {
  const toast = useToast();
  const taken = new Set(existing.filter((b) => b.id !== budget?.id).map((b) => b.categoryId ?? ''));
  const firstFree = taken.has('') ? (categories.find((c) => c.kind === 'expense' && !taken.has(c.id))?.id ?? '') : '';
  const [categoryId, setCategoryId] = useState<string>(budget ? (budget.categoryId ?? '') : firstFree);
  const [limit, setLimit] = useState<Cents | null>(budget?.limit ?? null);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!limit || limit <= 0) return setError('Inserisci un limite maggiore di zero.');
    try {
      await upsertBudget(month, categoryId || null, limit);
      toast.success(budget ? 'Budget aggiornato.' : 'Budget creato.');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Modal
      title={budget ? 'Modifica budget' : `Nuovo budget · ${formatMonth(month, true)}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Annulla
          </button>
          <button className="btn btn-primary" type="submit" form="budget-form">
            {budget ? 'Salva modifiche' : 'Crea budget'}
          </button>
        </>
      }
    >
      <form id="budget-form" className="form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="b-cat">Ambito</label>
          <select id="b-cat" className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!!budget}>
            <option value="" disabled={taken.has('')}>
              Totale del mese (tutte le uscite)
            </option>
            {categories
              .filter((c) => c.kind === 'expense')
              .map((c) => (
                <option key={c.id} value={c.id} disabled={taken.has(c.id)}>
                  {c.name}
                  {taken.has(c.id) ? ' (già presente)' : ''}
                </option>
              ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="b-limit">Limite mensile</label>
          <MoneyInput id="b-limit" value={limit} onChange={setLimit} currency={currency} />
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
