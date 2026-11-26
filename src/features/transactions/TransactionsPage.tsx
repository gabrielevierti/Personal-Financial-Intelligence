import { useEffect, useMemo, useState } from 'react';
import { Wand2, ArrowDown, ArrowLeftRight, ArrowUp, ChevronLeft, ChevronRight, Download, FileUp, Pencil, Plus, Receipt, Search, Tags, Trash2, X } from 'lucide-react';
import type { Transaction } from '../../types';
import { useDataSet } from '../../hooks/useData';
import { usePrefs } from '../../hooks/usePrefs';
import { useRoute, navigate } from '../../hooks/useRoute';
import { useToast } from '../../hooks/useToast';
import { deleteTransaction, deleteTransactions } from '../../services/repository';
import { downloadText, transactionsToCsv } from '../../services/exporters';
import { flowOf } from '../../services/finance';
import { formatDate } from '../../utils/date';
import { formatMoney } from '../../utils/money';
import { normalizeText } from '../../utils/text';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { EmptyState, PageSkeleton } from '../../components/ui/States';
import { CategoryIcon } from '../../components/ui/CategoryIcon';
import { Money } from '../../components/ui/Money';
import { TransactionForm } from './TransactionForm';
import { CategoryManager } from './CategoryManager';
import { TransferReview } from './TransferReview';
import { recategorizeUncategorized } from '../../services/categorize';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../database/db';
import { detectTransfers, getIgnoredPairs, getOwnerNames } from '../../services/transfers';

type SortKey = 'date' | 'amount' | 'description';
type TypeFilter = 'all' | 'income' | 'expense' | 'transfer';

export function TransactionsPage() {
  const ds = useDataSet();
  const route = useRoute();
  const toast = useToast();
  const { period, prefs, setPrefs } = usePrefs();

  const [q, setQ] = useState('');
  const [accountId, setAccountId] = useState(route.params.get('account') ?? '');
  const [categoryId, setCategoryId] = useState('');
  const [type, setType] = useState<TypeFilter>('all');
  const [min, setMin] = useState<number | null>(null);
  const [max, setMax] = useState<number | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'date', dir: -1 });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<{ tx: Transaction | null; mode: 'income' | 'expense' | 'transfer' } | null>(null);
  const [confirm, setConfirm] = useState<{ ids: string[] } | null>(null);
  const [manageCats, setManageCats] = useState(false);
  const [reviewTransfers, setReviewTransfers] = useState(false);
  const transferCtx = useLiveQuery(async () => ({ links: await db.bank_links.toArray(), names: await getOwnerNames(), ignored: await getIgnoredPairs() }), []);
  const transferCandidates = useMemo(
    () => (ds && transferCtx ? detectTransfers(ds.transactions, ds.accounts, transferCtx.links, transferCtx.names, transferCtx.ignored) : []),
    [ds, transferCtx],
  );

  useEffect(() => {
    const n = route.params.get('new');
    if (n) {
      setForm({ tx: null, mode: n === 'transfer' ? 'transfer' : 'expense' });
      window.history.replaceState(null, '', '#/transactions');
    }
    const acc = route.params.get('account');
    if (acc) setAccountId(acc);
  }, [route]);

  useEffect(() => {
    setPage(0);
  }, [q, accountId, categoryId, type, min, max, period, sort]);

  const filtered = useMemo(() => {
    if (!ds) return [];
    const nq = normalizeText(q);
    const list = ds.transactions.filter((t) => {
      if (t.date < period.start || t.date > period.end) return false;
      if (accountId && t.accountId !== accountId) return false;
      if (categoryId && t.categoryId !== categoryId) return false;
      if (type !== 'all' && t.type !== type) return false;
      const abs = Math.abs(t.amount);
      if (min !== null && abs < min) return false;
      if (max !== null && abs > max) return false;
      if (nq && !normalizeText(`${t.description} ${t.notes ?? ''}`).includes(nq)) return false;
      return true;
    });
    list.sort((a, b) => {
      let c = 0;
      if (sort.key === 'date') c = a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt < b.createdAt ? -1 : 1;
      else if (sort.key === 'amount') c = a.amount - b.amount;
      else c = a.description.localeCompare(b.description, 'it');
      return c * sort.dir;
    });
    return list;
  }, [ds, q, accountId, categoryId, type, min, max, period, sort]);

  if (!ds) return <PageSkeleton />;

  const pageSize = prefs.pageSize;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const rows = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const accMap = new Map(ds.accounts.map((a) => [a.id, a]));
  const catMap = new Map(ds.categories.map((c) => [c.id, c]));
  const hasFilters = q || accountId || categoryId || type !== 'all' || min !== null || max !== null;
  const totals = filtered.reduce(
    (s, t) => {
      const f = flowOf(t);
      s.inc += f.income;
      s.exp += f.expense;
      return s;
    },
    { inc: 0, exp: 0 },
  );
  const multiCurrency = new Set(filtered.map((t) => t.currency)).size > 1;
  const cur = ds.settings.baseCurrency;

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === 'description' ? 1 : -1 }));
  const SortIcon = ({ k }: { k: SortKey }) => (sort.key === k ? sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : null);
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const clearFilters = () => {
    setQ('');
    setAccountId('');
    setCategoryId('');
    setType('all');
    setMin(null);
    setMax(null);
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Movimenti</h1>
          <p>
            {filtered.length} movimenti · {period.label}
            {!multiCurrency && filtered.length > 0 && (
              <>
                {' '}· entrate <Money value={totals.inc} currency={filtered[0]?.currency ?? cur} className="pos" /> · uscite <Money value={totals.exp} currency={filtered[0]?.currency ?? cur} className="neg" />
              </>
            )}
          </p>
        </div>
        <div className="actions">
          <button className="btn btn-ghost" onClick={() => setManageCats(true)}>
            <Tags size={16} /> Categorie
          </button>
          <button
            className="btn btn-ghost"
            data-testid="auto-categorize"
            onClick={async () => {
              const n = await recategorizeUncategorized();
              toast.success(n ? `${n} movimenti categorizzati automaticamente.` : 'Nessun movimento da categorizzare con le regole: prova con l’assistente AI.');
            }}
          >
            <Wand2 size={16} /> Categorizza
          </button>
          <button
            className="btn btn-ghost"
            disabled={filtered.length === 0}
            onClick={() => {
              downloadText(transactionsToCsv(filtered, ds.accounts, ds.categories), `pfi-movimenti-${period.start}_${period.end}.csv`, 'text/csv;charset=utf-8');
              toast.success(`Esportati ${filtered.length} movimenti in CSV.`);
            }}
          >
            <Download size={16} /> Esporta CSV
          </button>
          <button className="btn" disabled={ds.accounts.length < 2} title={ds.accounts.length < 2 ? 'Servono almeno due conti' : undefined} onClick={() => setForm({ tx: null, mode: 'transfer' })}>
            <ArrowLeftRight size={16} /> Trasferimento
          </button>
          <button className="btn btn-primary" disabled={ds.accounts.length === 0} onClick={() => setForm({ tx: null, mode: 'expense' })}>
            <Plus size={16} /> Nuovo movimento
          </button>
        </div>
      </div>

      {transferCandidates.length > 0 && (
        <div className="callout" style={{ marginBottom: 16, justifyContent: 'space-between', alignItems: 'center' }} data-testid="transfer-banner">
          <span>
            <ArrowLeftRight size={15} style={{ verticalAlign: -3, marginRight: 8, color: 'var(--sage)' }} />
            {transferCandidates.length} {transferCandidates.length === 1 ? 'coppia di movimenti sembra un trasferimento' : 'coppie di movimenti sembrano trasferimenti'} tra i tuoi conti, ma sono ancora contate come entrate e uscite.
          </span>
          <button className="btn btn-sm" onClick={() => setReviewTransfers(true)}>
            Controlla
          </button>
        </div>
      )}

      {ds.accounts.length === 0 ? (
        <div className="panel">
          <EmptyState icon={<Receipt size={22} />} title="Crea un conto per registrare movimenti" text="Ogni movimento appartiene a un conto: il saldo si aggiorna automaticamente.">
            <button className="btn btn-primary" onClick={() => navigate('accounts', { new: '1' })}>
              <Plus size={16} /> Crea un conto
            </button>
          </EmptyState>
        </div>
      ) : (
        <section className="panel flush">
          <div className="filters" role="search">
            <div className="search">
              <Search size={15} />
              <label className="sr-only" htmlFor="f-q">
                Cerca nella descrizione
              </label>
              <input id="f-q" className="input" placeholder="Cerca nella descrizione o nelle note" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select className="select" aria-label="Filtra per conto" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Tutti i conti</option>
              {ds.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <select className="select" aria-label="Filtra per categoria" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Tutte le categorie</option>
              <optgroup label="Entrate">
                {ds.categories.filter((c) => c.kind === 'income').map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Uscite">
                {ds.categories.filter((c) => c.kind === 'expense').map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            </select>
            <select className="select" aria-label="Filtra per tipologia" value={type} onChange={(e) => setType(e.target.value as TypeFilter)}>
              <option value="all">Tutte le tipologie</option>
              <option value="income">Entrate</option>
              <option value="expense">Uscite</option>
              <option value="transfer">Trasferimenti</option>
            </select>
            <div className="row" style={{ gap: 6 }}>
              <MoneyInput value={min} onChange={setMin} placeholder="Min" ariaLabel="Importo minimo" />
              <MoneyInput value={max} onChange={setMax} placeholder="Max" ariaLabel="Importo massimo" />
            </div>
          </div>

          {selected.size > 0 && (
            <div className="spread" style={{ padding: '10px 16px', background: 'var(--sage-wash)', borderBottom: '1px solid var(--line)' }}>
              <span className="small">{selected.size} selezionati</span>
              <div className="actions">
                <button className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())}>
                  Deseleziona
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => setConfirm({ ids: [...selected] })}>
                  <Trash2 size={14} /> Elimina selezionati
                </button>
              </div>
            </div>
          )}

          {filtered.length === 0 ? (
            hasFilters ? (
              <EmptyState icon={<Search size={20} />} title="Nessun movimento corrisponde ai filtri" text="Modifica i filtri o amplia il periodo dall'intestazione.">
                <button className="btn" onClick={clearFilters}>
                  <X size={15} /> Azzera filtri
                </button>
              </EmptyState>
            ) : (
              <EmptyState icon={<Receipt size={20} />} title="Nessun movimento nel periodo" text="Registra un movimento o importa un estratto conto. Puoi anche cambiare periodo dall'intestazione.">
                <button className="btn btn-primary" onClick={() => setForm({ tx: null, mode: 'expense' })}>
                  <Plus size={15} /> Nuovo movimento
                </button>
                <button className="btn" onClick={() => navigate('import')}>
                  <FileUp size={15} /> Importa estratto
                </button>
              </EmptyState>
            )
          ) : (
            <>
              <div className="table-wrap">
                <table className="table" data-testid="tx-table">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}>
                        <input
                          type="checkbox"
                          aria-label="Seleziona tutti nella pagina"
                          checked={allOnPage}
                          onChange={() =>
                            setSelected((s) => {
                              const n = new Set(s);
                              rows.forEach((r) => (allOnPage ? n.delete(r.id) : n.add(r.id)));
                              return n;
                            })
                          }
                        />
                      </th>
                      <th>
                        <button onClick={() => toggleSort('date')}>
                          Data <SortIcon k="date" />
                        </button>
                      </th>
                      <th>
                        <button onClick={() => toggleSort('description')}>
                          Descrizione <SortIcon k="description" />
                        </button>
                      </th>
                      <th className="hide-mobile">Categoria</th>
                      <th className="hide-mobile">Conto</th>
                      <th className="right">
                        <button onClick={() => toggleSort('amount')}>
                          Importo <SortIcon k="amount" />
                        </button>
                      </th>
                      <th style={{ width: 80 }}>
                        <span className="sr-only">Azioni</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((t) => {
                      const c = t.categoryId ? catMap.get(t.categoryId) : undefined;
                      const acc = accMap.get(t.accountId);
                      const counter = t.counterAccountId ? accMap.get(t.counterAccountId) : undefined;
                      return (
                        <tr key={t.id} data-testid="tx-row">
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Seleziona ${t.description}`}
                              checked={selected.has(t.id)}
                              onChange={() =>
                                setSelected((s) => {
                                  const n = new Set(s);
                                  if (n.has(t.id)) n.delete(t.id);
                                  else n.add(t.id);
                                  return n;
                                })
                              }
                            />
                          </td>
                          <td className="num" style={{ whiteSpace: 'nowrap' }}>
                            {formatDate(t.date)}
                          </td>
                          <td>
                            <div className="cell-desc" title={t.description}>
                              {t.pending && (
                                <span className="badge badge-warning" style={{ marginRight: 6 }} title="Non ancora contabilizzato dalla banca: verrà aggiornato alla prossima sincronizzazione">
                                  In attesa
                                </span>
                              )}
                              {t.description}
                            </div>
                            <div className="xs muted show-mobile">{t.type === 'transfer' ? 'Trasferimento' : c?.name}</div>
                          </td>
                          <td className="hide-mobile">
                            {t.type === 'transfer' ? (
                              <span className="badge badge-sage">
                                <ArrowLeftRight size={11} /> {t.amount < 0 ? 'verso' : 'da'} {counter?.name ?? 'conto eliminato'}
                              </span>
                            ) : c ? (
                              <span className="badge">
                                <CategoryIcon icon={c.icon} size={12} color={c.color} /> {c.name}
                              </span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td className="hide-mobile muted">{acc?.name}</td>
                          <td className={`amount ${t.type === 'transfer' ? '' : t.amount < 0 ? 'neg' : 'pos'}`}>{formatMoney(t.amount, t.currency, { sign: true })}</td>
                          <td>
                            <div className="row" style={{ gap: 0, justifyContent: 'flex-end' }}>
                              <button className="btn btn-ghost icon-btn" aria-label={`Modifica ${t.description}`} onClick={() => setForm({ tx: t, mode: t.type })}>
                                <Pencil size={14} />
                              </button>
                              <button className="btn btn-ghost icon-btn" aria-label={`Elimina ${t.description}`} onClick={() => setConfirm({ ids: [t.id] })}>
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="pager">
                <div className="row">
                  <label htmlFor="ps-size" className="xs">
                    Per pagina
                  </label>
                  <select id="ps-size" className="select" style={{ width: 80, height: 30 }} value={pageSize} onChange={(e) => setPrefs({ pageSize: Number(e.target.value) })}>
                    {[10, 25, 50, 100].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </div>
                <span>
                  {safePage * pageSize + 1}–{Math.min(filtered.length, (safePage + 1) * pageSize)} di {filtered.length}
                </span>
                <div className="row" style={{ gap: 4 }}>
                  <button className="btn btn-sm" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} aria-label="Pagina precedente">
                    <ChevronLeft size={14} />
                  </button>
                  <span className="xs">
                    Pagina {safePage + 1} di {pages}
                  </span>
                  <button className="btn btn-sm" disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)} aria-label="Pagina successiva">
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {form && <TransactionForm ds={ds} tx={form.tx} initialMode={form.mode} defaultAccountId={accountId || undefined} onClose={() => setForm(null)} />}
      {reviewTransfers && (
        <TransferReview
          candidates={transferCandidates}
          transactions={new Map(ds.transactions.map((t) => [t.id, t]))}
          accounts={accMap}
          onClose={() => setReviewTransfers(false)}
        />
      )}
      {manageCats && <CategoryManager categories={ds.categories} transactions={ds.transactions} onClose={() => setManageCats(false)} />}
      {confirm && (
        <ConfirmDialog
          title={confirm.ids.length === 1 ? 'Eliminare il movimento?' : `Eliminare ${confirm.ids.length} movimenti?`}
          message="I saldi dei conti verranno ricalcolati. Per i trasferimenti viene eliminata anche la controparte sull'altro conto."
          confirmLabel="Elimina"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            try {
              if (confirm.ids.length === 1) {
                await deleteTransaction(confirm.ids[0]);
                toast.success('Movimento eliminato.');
              } else {
                const n = await deleteTransactions(confirm.ids);
                toast.success(`${n} movimenti eliminati.`);
              }
              setSelected(new Set());
            } catch (e) {
              toast.error(e);
            }
          }}
        />
      )}
    </div>
  );
}
