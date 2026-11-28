import { useState } from 'react';
import type { Cents, Transaction } from '../../types';
import type { DataSet } from '../../services/reports';
import { createTransaction, createTransfer, markAsTransfer, unmarkTransfer, updateTransaction, updateTransfer } from '../../services/repository';
import { errorMessage, useToast } from '../../hooks/useToast';
import { todayISO } from '../../utils/date';
import { FALLBACK_CATEGORY } from '../../database/seed';
import { Modal } from '../../components/ui/Modal';
import { applyCategoryToMerchant, similarTransactions } from '../../services/categorize';
import { merchantKey } from '../../services/merchant';
import { MoneyInput } from '../../components/ui/MoneyInput';

type Mode = 'income' | 'expense' | 'transfer';

interface Props {
  ds: DataSet;
  tx: Transaction | null;
  initialMode: Mode;
  defaultAccountId?: string;
  onClose: () => void;
}

export function TransactionForm({ ds, tx, initialMode, defaultAccountId, onClose }: Props) {
  const toast = useToast();
  const isEdit = !!tx;
  const legs = tx?.transferId ? ds.transactions.filter((t) => t.transferId === tx.transferId) : [];
  const outLeg = legs.find((l) => l.amount < 0);
  const inLeg = legs.find((l) => l.amount > 0);

  const firstAccount = defaultAccountId ?? ds.accounts[0]?.id ?? '';
  const [mode, setMode] = useState<Mode>(initialMode);
  const [accountId, setAccountId] = useState(tx?.accountId ?? firstAccount);
  const [date, setDate] = useState(tx?.date ?? todayISO());
  const [description, setDescription] = useState(tx?.description ?? '');
  const [amount, setAmount] = useState<Cents | null>(tx ? Math.abs(outLeg?.amount ?? tx.amount) : null);
  const [categoryId, setCategoryId] = useState<string>(tx?.categoryId ?? FALLBACK_CATEGORY[initialMode === 'income' ? 'income' : 'expense']);
  const [notes, setNotes] = useState(tx?.notes ?? '');
  const [fromId, setFromId] = useState(outLeg?.accountId ?? firstAccount);
  const [toId, setToId] = useState(inLeg?.accountId ?? ds.accounts.find((a) => a.id !== firstAccount)?.id ?? '');
  const [toAmount, setToAmount] = useState<Cents | null>(inLeg ? inLeg.amount : null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [applySimilar, setApplySimilar] = useState(true);
  const similar = tx && tx.type !== 'transfer' ? similarTransactions(ds.transactions, { id: tx.id, description: description || tx.description, type: mode === 'income' ? 'income' : 'expense' }) : [];
  const categoryChanged = !!tx && tx.type !== 'transfer' && categoryId !== tx.categoryId;

  const from = ds.accounts.find((a) => a.id === fromId);
  const to = ds.accounts.find((a) => a.id === toId);
  const crossCurrency = !!from && !!to && from.currency !== to.currency;
  const account = ds.accounts.find((a) => a.id === accountId);
  const cats = ds.categories.filter((c) => c.kind === (mode === 'income' ? 'income' : 'expense'));

  const switchMode = (m: Mode) => {
    setMode(m);
    if (m !== 'transfer') {
      const cat = ds.categories.find((c) => c.id === categoryId);
      if (!cat || cat.kind !== m) setCategoryId(FALLBACK_CATEGORY[m]);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (amount === null || amount <= 0) return setError("Inserisci un importo maggiore di zero.");
    setBusy(true);
    try {
      if (mode === 'transfer') {
        if (isEdit && tx && tx.type !== 'transfer') {
          // Cambio tipo: da entrata/uscita a giroconto
          await markAsTransfer(tx.id);
          toast.success('Movimento convertito in giroconto: non conterà più tra entrate e uscite.');
        } else if (isEdit && tx?.transferId) {
          if (crossCurrency && (toAmount === null || toAmount <= 0)) throw new Error("Indica l'importo accreditato nella valuta del conto di destinazione.");
          const input = { fromAccountId: fromId, toAccountId: toId, date, amount, toAmount: crossCurrency ? (toAmount ?? undefined) : undefined, description, notes };
          await updateTransfer(tx.transferId, input);
          toast.success('Trasferimento aggiornato.');
        } else {
          if (crossCurrency && (toAmount === null || toAmount <= 0)) throw new Error("Indica l'importo accreditato nella valuta del conto di destinazione.");
          const input = { fromAccountId: fromId, toAccountId: toId, date, amount, toAmount: crossCurrency ? (toAmount ?? undefined) : undefined, description, notes };
          await createTransfer(input);
          toast.success('Trasferimento registrato.');
        }
      } else {
        if (isEdit && tx && tx.type === 'transfer') {
          // Cambio tipo: da giroconto a entrata/uscita
          await unmarkTransfer(tx.id);
          toast.success(`Movimento ripristinato come ${mode === 'income' ? 'entrata' : 'uscita'}.`);
        } else {
          const input = { accountId, date, description, amount, type: mode, categoryId, notes };
          if (tx) await updateTransaction(tx.id, input);
          else await createTransaction(input);
          if (tx && categoryChanged && applySimilar) {
            const n = await applyCategoryToMerchant(description, mode, categoryId);
            toast.success(n ? `Movimento aggiornato. Categoria applicata ad altri ${n} movimenti simili e ricordata per il futuro.` : 'Movimento aggiornato. La categoria verrà usata per questo esercente anche in futuro.');
          } else toast.success(isEdit ? 'Movimento aggiornato.' : 'Movimento registrato.');
        }
      }
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const title = isEdit ? (mode === 'transfer' ? 'Modifica trasferimento' : 'Modifica movimento') : mode === 'transfer' ? 'Nuovo trasferimento' : 'Nuovo movimento';

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Annulla
          </button>
          <button type="submit" form="tx-form" className="btn btn-primary" disabled={busy}>
            {isEdit ? 'Salva modifiche' : mode === 'transfer' ? 'Registra trasferimento' : 'Registra movimento'}
          </button>
        </>
      }
    >
      <form id="tx-form" className="form" onSubmit={submit} noValidate>
        <div className="segmented" role="group" aria-label="Tipo di movimento">
          <button type="button" className="seg-expense" aria-pressed={mode === 'expense'} onClick={() => switchMode('expense')}>
            Uscita
          </button>
          <button type="button" className="seg-income" aria-pressed={mode === 'income'} onClick={() => switchMode('income')}>
            Entrata
          </button>
          {ds.accounts.length >= 2 && (
            <button type="button" aria-pressed={mode === 'transfer'} onClick={() => switchMode('transfer')}>
              Giroconto
            </button>
          )}
        </div>

        {mode === 'transfer' ? (
          <>
            <div className="form-row">
              <div className="field">
                <label htmlFor="tr-from">Dal conto</label>
                <select id="tr-from" className="select" value={fromId} onChange={(e) => setFromId(e.target.value)}>
                  {ds.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.currency})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="tr-to">Al conto</label>
                <select id="tr-to" className="select" value={toId} onChange={(e) => setToId(e.target.value)}>
                  <option value="">Seleziona…</option>
                  {ds.accounts
                    .filter((a) => a.id !== fromId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.currency})
                      </option>
                    ))}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="tr-amount">Importo trasferito</label>
                <MoneyInput id="tr-amount" value={amount} onChange={setAmount} currency={from?.currency} />
              </div>
              {crossCurrency ? (
                <div className="field">
                  <label htmlFor="tr-to-amount">Importo accreditato</label>
                  <MoneyInput id="tr-to-amount" value={toAmount} onChange={setToAmount} currency={to?.currency} />
                </div>
              ) : (
                <div className="field">
                  <label htmlFor="tr-date">Data</label>
                  <input id="tr-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
              )}
            </div>
            {crossCurrency && (
              <div className="field">
                <label htmlFor="tr-date2">Data</label>
                <input id="tr-date2" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
            )}
            <div className="field">
              <label htmlFor="tr-desc">Descrizione</label>
              <input id="tr-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Facoltativa, es. Giroconto risparmi" maxLength={300} />
              <span className="help">I trasferimenti spostano denaro tra i tuoi conti e non vengono conteggiati come entrate o uscite.</span>
            </div>
          </>
        ) : (
          <>
            <div className="form-row">
              <div className="field">
                <label htmlFor="tx-account">Conto</label>
                <select id="tx-account" className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  {ds.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="tx-date">Data</label>
                <input id="tx-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="tx-desc">Descrizione</label>
              <input id="tx-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={mode === 'income' ? 'Es. Stipendio di marzo' : 'Es. Spesa supermercato'} maxLength={300} />
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="tx-amount">Importo</label>
                <MoneyInput id="tx-amount" value={amount} onChange={setAmount} currency={account?.currency} />
              </div>
              <div className="field">
                <label htmlFor="tx-cat">Categoria</label>
                <select id="tx-cat" className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  {cats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}
        {mode !== 'transfer' && categoryChanged && (
          <label className="check" data-testid="apply-similar">
            <input type="checkbox" checked={applySimilar} onChange={(e) => setApplySimilar(e.target.checked)} />
            Usa questa categoria per tutti i movimenti di «{merchantKey(description)}»{similar.length ? ` (altri ${similar.length})` : ''} e per quelli futuri
          </label>
        )}
        <div className="field">
          <label htmlFor="tx-notes">Note</label>
          <textarea id="tx-notes" className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={2} />
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
