import { useEffect, useMemo, useState } from 'react';
import { FileUp, PlugZap, Merge, ArrowLeftRight, Banknote, Building2, CreditCard, Landmark, LineChart as LineIcon, Pencil, PiggyBank, Plus, Trash2, Wallet, HandCoins, Package } from 'lucide-react';
import type { Account, AccountType, Cents } from '../../types';
import { useDataSet } from '../../hooks/useData';
import { errorMessage, useToast } from '../../hooks/useToast';
import { navigate, useRoute } from '../../hooks/useRoute';
import { ACCOUNT_TYPE_LABELS, balanceHistory, balancesByAccount, convert } from '../../services/finance';
import { createAccount, deleteAccount, updateAccount, type AccountInput } from '../../services/repository';
import { findDuplicateAccounts, mergeAccounts } from '../../services/dataQuality';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../database/db';
import { Callout } from '../../components/ui/States';
import { ACCOUNT_TYPES } from '../../services/validation';
import { formatDate, todayISO } from '../../utils/date';
import { CURRENCIES, formatMoney } from '../../utils/money';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { EmptyState, PageSkeleton } from '../../components/ui/States';
import { Money } from '../../components/ui/Money';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { axisPropsFor, gridPropsFor, makeMoneyTooltip } from '../../components/charts/ChartTooltip';
import { useChartColors } from '../../hooks/useTheme';

export const ACCOUNT_ICONS: Record<AccountType, typeof Wallet> = {
  checking: Landmark,
  deposit: PiggyBank,
  cash: Banknote,
  debit_card: CreditCard,
  credit_card: CreditCard,
  investment: LineIcon,
  loan: HandCoins,
  other: Package,
};

export function AccountsPage() {
  const ds = useDataSet();
  const route = useRoute();
  const toast = useToast();
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [merging, setMerging] = useState<{ source: string; target: string } | null>(null);
  const linkedIds = useLiveQuery(async () => new Set((await db.bank_links.toArray()).map((l) => l.accountId).filter(Boolean) as string[]), []);
  const duplicates = useMemo(() => (ds ? findDuplicateAccounts(ds.accounts, ds.transactions) : []), [ds]);

  useEffect(() => {
    if (route.params.get('new') === '1') {
      setEditing('new');
      window.history.replaceState(null, '', '#/accounts');
    }
  }, [route]);

  const balances = useMemo(() => (ds ? balancesByAccount(ds.accounts, ds.transactions) : new Map<string, Cents>()), [ds]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    ds?.transactions.forEach((t) => m.set(t.accountId, (m.get(t.accountId) ?? 0) + 1));
    return m;
  }, [ds]);

  if (!ds) return <PageSkeleton />;
  const cur = ds.settings.baseCurrency;
  const current = ds.accounts.find((a) => a.id === selected) ?? null;
  let total = 0;
  let unconverted = 0;
  for (const a of ds.accounts) {
    const v = convert(balances.get(a.id) ?? 0, a.currency, ds.settings);
    if (v === null) unconverted++;
    else total += v;
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Conti</h1>
          <p>
            {ds.accounts.length} conti · saldo complessivo <Money value={total} currency={cur} />
            {unconverted > 0 && ` (${unconverted} in valuta estera senza tasso di cambio)`}
          </p>
        </div>
        <div className="actions">
          <a className="btn" href="#/banks">
            <PlugZap size={16} /> Collegamenti bancari
          </a>
          <a className="btn" href="#/import">
            <FileUp size={16} /> Importa estratto
          </a>
          {ds.accounts.length >= 2 && (
            <button className="btn" onClick={() => navigate('transactions', { new: 'transfer' })}>
              <ArrowLeftRight size={16} /> Nuovo trasferimento
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Plus size={16} /> Nuovo conto
          </button>
        </div>
      </div>

      {duplicates.map((d) => {
        const A = ds.accounts.find((a) => a.id === d.a)!;
        const B = ds.accounts.find((a) => a.id === d.b)!;
        // si propone di tenere il conto collegato alla banca
        const keep = linkedIds?.has(B.id) && !linkedIds?.has(A.id) ? B : A;
        const drop = keep.id === A.id ? B : A;
        return (
          <div key={`${d.a}|${d.b}`} style={{ marginBottom: 12 }} data-testid="duplicate-accounts">
            <Callout kind="warning">
              <strong>
                "{A.name}" e "{B.name}" sembrano lo stesso conto
              </strong>
              : {d.matches.length} movimenti uguali tra il {formatDate(d.overlapFrom)} e il {formatDate(d.overlapTo)}. Così entrate, uscite e patrimonio vengono contati due volte.{' '}
              <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => setMerging({ source: drop.id, target: keep.id })}>
                Unisci i conti
              </button>
            </Callout>
          </div>
        );
      })}

      {ds.accounts.length === 0 ? (
        <div className="panel">
          <EmptyState icon={<Building2 size={22} />} title="Nessun conto" text="Aggiungi conti correnti, depositi, contanti, carte, conti investimento o prestiti. Il saldo viene calcolato dal saldo iniziale più i movimenti.">
            <button className="btn btn-primary" onClick={() => setEditing('new')}>
              <Plus size={16} /> Crea il primo conto
            </button>
          </EmptyState>
        </div>
      ) : (
        <div className="tile-grid" style={{ marginBottom: 20 }}>
          {ds.accounts.map((a) => {
            const Icon = ACCOUNT_ICONS[a.type];
            const bal = balances.get(a.id) ?? 0;
            return (
              <article key={a.id} className={`tile${selected === a.id ? ' is-selected' : ''}`} data-testid="account-tile">
                <div className="tile-top">
                  <div className="row">
                    <div className="item-icon" style={a.color ? { color: a.color } : undefined}>
                      <Icon size={18} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className="item-title">{a.name}</div>
                      <div className="item-meta">
                        {ACCOUNT_TYPE_LABELS[a.type]}
                        {a.institution ? ` · ${a.institution}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="row" style={{ gap: 2 }}>
                    <button className="btn btn-ghost icon-btn" aria-label={`Modifica ${a.name}`} onClick={() => setEditing(a)}>
                      <Pencil size={15} />
                    </button>
                    {ds.accounts.length > 1 && (
                      <button className="btn btn-ghost icon-btn" aria-label={`Unisci ${a.name} in un altro conto`} title="Unisci in un altro conto" onClick={() => setMerging({ source: a.id, target: ds.accounts.find((x) => x.id !== a.id && x.currency === a.currency)?.id ?? '' })}>
                        <Merge size={15} />
                      </button>
                    )}
                    <button className="btn btn-ghost icon-btn" aria-label={`Elimina ${a.name}`} onClick={() => setDeleting(a)}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                <div className={`tile-value num ${bal < 0 ? 'neg' : ''}`} data-testid="account-balance">
                  {formatMoney(bal, a.currency)}
                </div>
                <div className="spread small muted">
                  <span>{counts.get(a.id) ?? 0} movimenti</span>
                  <button className="btn btn-sm" onClick={() => setSelected(selected === a.id ? null : a.id)} aria-expanded={selected === a.id}>
                    {selected === a.id ? 'Chiudi storico' : 'Vedi storico'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {current && <AccountHistory account={current} />}

      {merging && (
        <MergeDialog
          accounts={ds.accounts}
          linked={linkedIds ?? new Set()}
          initial={merging}
          onClose={() => setMerging(null)}
          onMerge={async (source, target) => {
            try {
              const r = await mergeAccounts(source, target);
              toast.success(`Conti uniti: ${r.moved} movimenti spostati, ${r.duplicates} doppioni eliminati.`);
              setMerging(null);
            } catch (e) {
              toast.error(e);
            }
          }}
        />
      )}
      {editing && <AccountForm account={editing === 'new' ? null : editing} hasTransactions={editing !== 'new' && (counts.get(editing.id) ?? 0) > 0} onClose={() => setEditing(null)} />}
      {deleting && (
        <ConfirmDialog
          title={`Eliminare "${deleting.name}"?`}
          message={
            <>
              Verranno eliminati il conto e i suoi <strong>{counts.get(deleting.id) ?? 0} movimenti</strong>. I trasferimenti verso altri conti restano su quei conti come movimenti normali. L'operazione non si può annullare.
            </>
          }
          confirmLabel="Elimina conto"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await deleteAccount(deleting.id);
              if (selected === deleting.id) setSelected(null);
              toast.success('Conto eliminato.');
            } catch (e) {
              toast.error(e);
            }
          }}
        />
      )}
    </div>
  );

  function AccountHistory({ account }: { account: Account }) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const cc = useChartColors();
    const axisProps = axisPropsFor(cc);
    const gridProps = gridPropsFor(cc);
    const own = ds!.transactions.filter((t) => t.accountId === account.id);
    const hist = balanceHistory(account, own);
    const recent = [...own].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 8);
    const cat = new Map(ds!.categories.map((c) => [c.id, c.name]));
    const accName = new Map(ds!.accounts.map((a) => [a.id, a.name]));
    return (
      <section className="panel" aria-label={`Storico ${account.name}`}>
        <div className="panel-head">
          <h2>Storico saldo · {account.name}</h2>
          <a className="hint" href={`#/transactions?account=${account.id}`}>
            Tutti i movimenti del conto
          </a>
        </div>
        {hist.length > 1 ? (
          <div className="chart-box" data-testid="chart-account-history">
            <ResponsiveContainer>
              <AreaChart data={hist} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="acc-g" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={cc.accent} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={cc.accent} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="date" tickFormatter={(d: string) => formatDate(d).slice(0, 5)} {...axisProps} minTickGap={24} />
                <YAxis tickFormatter={(v: number) => formatMoney(v, account.currency, { compact: true })} width={64} {...axisProps} />
                <Tooltip content={makeMoneyTooltip(account.currency, formatDate)} />
                <Area type="stepAfter" dataKey="balance" name="Saldo"  stroke={cc.accent} strokeWidth={2} fill="url(#acc-g)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState compact icon={<Wallet size={20} />} title="Nessun movimento su questo conto" text={`Saldo iniziale di ${formatMoney(account.initialBalance, account.currency)} dal ${formatDate(account.createdAt)}.`} />
        )}
        {recent.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 16 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Descrizione</th>
                  <th className="hide-mobile">Categoria</th>
                  <th className="right">Importo</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((t) => (
                  <tr key={t.id}>
                    <td className="num">{formatDate(t.date)}</td>
                    <td className="cell-desc">{t.description}</td>
                    <td className="hide-mobile muted">{t.type === 'transfer' ? `Trasferimento ${t.amount < 0 ? 'verso' : 'da'} ${accName.get(t.counterAccountId ?? '') ?? '—'}` : cat.get(t.categoryId ?? '') ?? '—'}</td>
                    <td className={`amount ${t.amount < 0 ? 'neg' : 'pos'}`}>{formatMoney(t.amount, t.currency, { sign: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  }
}

function AccountForm({ account, hasTransactions, onClose }: { account: Account | null; hasTransactions: boolean; onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<AccountInput>(
    account
      ? { name: account.name, institution: account.institution, type: account.type, currency: account.currency, initialBalance: account.initialBalance, createdAt: account.createdAt, notes: account.notes }
      : { name: '', institution: '', type: 'checking', currency: 'EUR', initialBalance: 0, createdAt: todayISO() },
  );
  const [balance, setBalance] = useState<Cents | null>(form.initialBalance);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof AccountInput>(k: K, v: AccountInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (balance === null && form.initialBalance !== 0) return setError('Inserisci un saldo iniziale valido.');
    setBusy(true);
    setError(null);
    try {
      const input = { ...form, initialBalance: balance ?? 0 };
      if (account) {
        await updateAccount(account.id, input);
        toast.success('Conto aggiornato.');
      } else {
        await createAccount(input);
        toast.success('Conto creato.');
      }
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={account ? 'Modifica conto' : 'Nuovo conto'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            Annulla
          </button>
          <button className="btn btn-primary" type="submit" form="account-form" disabled={busy}>
            {account ? 'Salva modifiche' : 'Crea conto'}
          </button>
        </>
      }
    >
      <form id="account-form" className="form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="acc-name">Nome</label>
          <input id="acc-name" className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Es. Conto principale" maxLength={80} required />
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="acc-inst">Istituto</label>
            <input id="acc-inst" className="input" value={form.institution} onChange={(e) => set('institution', e.target.value)} placeholder="Es. Intesa Sanpaolo" maxLength={80} />
          </div>
          <div className="field">
            <label htmlFor="acc-type">Tipologia</label>
            <select id="acc-type" className="select" value={form.type} onChange={(e) => set('type', e.target.value as AccountType)}>
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ACCOUNT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="acc-cur">Valuta</label>
            <select id="acc-cur" className="select" value={form.currency} onChange={(e) => set('currency', e.target.value)} disabled={hasTransactions}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            {hasTransactions && <span className="help">Non modificabile: il conto ha già movimenti.</span>}
          </div>
          <div className="field">
            <label htmlFor="acc-bal">Saldo iniziale</label>
            <MoneyInput id="acc-bal" value={balance} onChange={setBalance} allowNegative currency={form.currency} />
            <span className="help">{form.type === 'credit_card' || form.type === 'loan' ? 'Per debiti usa un valore negativo, es. -1200,00' : 'Saldo alla data di creazione'}</span>
          </div>
        </div>
        <div className="field">
          <label htmlFor="acc-date">Data di creazione</label>
          <input id="acc-date" type="date" className="input" value={form.createdAt} onChange={(e) => set('createdAt', e.target.value)} />
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

function MergeDialog({
  accounts,
  linked,
  initial,
  onClose,
  onMerge,
}: {
  accounts: Account[];
  linked: Set<string>;
  initial: { source: string; target: string };
  onClose: () => void;
  onMerge: (source: string, target: string) => Promise<void>;
}) {
  const [source, setSource] = useState(initial.source);
  const [target, setTarget] = useState(initial.target);
  const [busy, setBusy] = useState(false);
  const src = accounts.find((a) => a.id === source);
  const dst = accounts.find((a) => a.id === target);
  const valid = !!src && !!dst && src.id !== dst.id && src.currency === dst.currency;
  return (
    <Modal
      title="Unisci due conti"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Annulla
          </button>
          <button
            className="btn btn-primary"
            disabled={!valid || busy}
            data-testid="merge-confirm"
            onClick={async () => {
              setBusy(true);
              await onMerge(source, target);
              setBusy(false);
            }}
          >
            Unisci conti
          </button>
        </>
      }
    >
      <div className="form">
        <div className="form-row">
          <div className="field">
            <label htmlFor="mg-src">Conto da eliminare</label>
            <select id="mg-src" className="select" value={source} onChange={(e) => setSource(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {linked.has(a.id) ? ' (collegato alla banca)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="mg-dst">Conto da tenere</label>
            <select id="mg-dst" className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
              {accounts
                .filter((a) => a.id !== source)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {linked.has(a.id) ? ' (collegato alla banca)' : ''}
                  </option>
                ))}
            </select>
          </div>
        </div>
        <p className="small muted">
          I movimenti di "{src?.name}" passano a "{dst?.name}". Quelli già presenti in entrambi (stesso importo, date entro 2 giorni, descrizione simile) vengono contati una volta sola. Il saldo attuale resta quello {linked.has(source) || linked.has(target) ? 'della banca' : `di "${dst?.name}"`}. "{src?.name}" viene eliminato.
        </p>
        {src && dst && src.currency !== dst.currency && <p className="small" style={{ color: 'var(--danger)' }}>I conti hanno valute diverse.</p>}
      </div>
    </Modal>
  );
}
