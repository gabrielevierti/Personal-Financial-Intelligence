import { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { Category, CategoryKind, Transaction } from '../../types';
import { createCategory, deleteCategory, updateCategory } from '../../services/repository';
import { errorMessage, useToast } from '../../hooks/useToast';
import { Modal } from '../../components/ui/Modal';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../database/db';
import { deleteRule } from '../../services/categorize';
import { CATEGORY_ICONS, CategoryIcon, PALETTE } from '../../components/ui/CategoryIcon';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';

export function CategoryManager({ categories, transactions, onClose }: { categories: Category[]; transactions: Transaction[]; onClose: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<CategoryKind | 'rules'>('expense');
  const rules = useLiveQuery(() => db.category_rules.toArray(), []);
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    transactions.forEach((t) => t.categoryId && m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + 1));
    return m;
  }, [transactions]);
  const list = categories.filter((c) => c.kind === kind);
  const catName = new Map(categories.map((c) => [c.id, c]));

  return (
    <Modal title="Categorie" onClose={onClose} wide>
      <div className="spread" style={{ marginBottom: 14 }}>
        <div className="segmented" role="group" aria-label="Tipo di categoria">
          <button type="button" className="seg-expense" aria-pressed={kind === 'expense'} onClick={() => setKind('expense')}>
            Uscite
          </button>
          <button type="button" className="seg-income" aria-pressed={kind === 'income'} onClick={() => setKind('income')}>
            Entrate
          </button>
          <button type="button" aria-pressed={kind === 'rules'} onClick={() => setKind('rules')}>
            Regole ({rules?.length ?? 0})
          </button>
        </div>
        {kind !== 'rules' && (
          <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
            <Plus size={14} /> Nuova categoria
          </button>
        )}
      </div>
      {kind === 'rules' && (
        <div className="item-list panel flush">
          {!rules?.length ? (
            <p className="small muted" style={{ padding: 16 }}>
              Nessuna regola. Quando cambi la categoria di un movimento, PFI può ricordarla per tutti i movimenti dello stesso esercente.
            </p>
          ) : (
            rules
              .sort((a, b) => a.pattern.localeCompare(b.pattern))
              .map((r) => {
                const c = catName.get(r.categoryId);
                return (
                  <div className="item" key={r.id}>
                    <div className="item-icon" style={{ color: c?.color }}>
                      <CategoryIcon icon={c?.icon ?? 'tag'} size={16} />
                    </div>
                    <div>
                      <div className="item-title">«{r.pattern}» → {c?.name ?? 'categoria eliminata'}</div>
                      <div className="item-meta">{r.kind === 'income' ? 'Entrate' : 'Uscite'} · {r.source === 'ai' ? 'suggerita dall’AI e confermata' : 'creata da te'}</div>
                    </div>
                    <button className="btn btn-ghost icon-btn" aria-label={`Elimina regola ${r.pattern}`} onClick={() => deleteRule(r.id)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })
          )}
        </div>
      )}
      <div className="item-list panel flush" hidden={kind === 'rules'}>
        {list.map((c) => (
          <div className="item" key={c.id}>
            <div className="item-icon" style={{ color: c.color }}>
              <CategoryIcon icon={c.icon} size={17} />
            </div>
            <div>
              <div className="item-title">{c.name}</div>
              <div className="item-meta">
                {counts.get(c.id) ?? 0} movimenti{c.isDefault ? ' · predefinita' : ''}
              </div>
            </div>
            <div className="row" style={{ gap: 0 }}>
              <button className="btn btn-ghost icon-btn" aria-label={`Modifica ${c.name}`} onClick={() => setEditing(c)}>
                <Pencil size={14} />
              </button>
              {!c.isDefault && (
                <button className="btn btn-ghost icon-btn" aria-label={`Elimina ${c.name}`} onClick={() => setDeleting(c)}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {editing && kind !== 'rules' && <CategoryForm category={editing === 'new' ? null : editing} kind={kind} onClose={() => setEditing(null)} />}
      {deleting && (
        <ConfirmDialog
          title={`Eliminare "${deleting.name}"?`}
          message={`${counts.get(deleting.id) ?? 0} movimenti passeranno alla categoria "${deleting.kind === 'income' ? 'Altre entrate' : 'Altre spese'}". I budget collegati verranno rimossi.`}
          confirmLabel="Elimina categoria"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await deleteCategory(deleting.id);
              toast.success('Categoria eliminata.');
            } catch (e) {
              toast.error(e);
            }
          }}
        />
      )}
    </Modal>
  );
}

function CategoryForm({ category, kind, onClose }: { category: Category | null; kind: CategoryKind; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(category?.name ?? '');
  const [color, setColor] = useState(category?.color ?? PALETTE[0]);
  const [icon, setIcon] = useState(category?.icon ?? 'tag');
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (category) await updateCategory(category.id, { name, color, icon });
      else await createCategory({ name, kind, color, icon });
      toast.success(category ? 'Categoria aggiornata.' : 'Categoria creata.');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Modal
      title={category ? 'Modifica categoria' : `Nuova categoria di ${kind === 'income' ? 'entrata' : 'uscita'}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Annulla
          </button>
          <button className="btn btn-primary" type="submit" form="cat-form">
            {category ? 'Salva modifiche' : 'Crea categoria'}
          </button>
        </>
      }
    >
      <form id="cat-form" className="form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="cat-name">Nome</label>
          <input id="cat-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </div>
        <div className="field">
          <span className="field-label">Colore</span>
          <div className="color-swatches">
            {PALETTE.map((c) => (
              <button type="button" key={c} style={{ background: c }} aria-label={`Colore ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label">Icona</span>
          <div className="color-swatches">
            {Object.keys(CATEGORY_ICONS).map((k) => (
              <button
                type="button"
                key={k}
                aria-label={`Icona ${k}`}
                aria-pressed={icon === k}
                onClick={() => setIcon(k)}
                style={{ background: 'var(--surface-3)', display: 'grid', placeItems: 'center', width: 32, height: 32, borderRadius: 8 }}
              >
                <CategoryIcon icon={k} size={15} color={icon === k ? color : undefined} />
              </button>
            ))}
          </div>
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
