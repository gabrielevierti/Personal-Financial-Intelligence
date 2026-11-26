import { useState } from 'react';
import { ArrowRight, Check, X } from 'lucide-react';
import type { Account, Transaction } from '../../types';
import type { TransferCandidate } from '../../services/transfers';
import { ignorePair } from '../../services/transfers';
import { linkAsTransfer } from '../../services/repository';
import { useToast } from '../../hooks/useToast';
import { formatDate } from '../../utils/date';
import { formatMoney } from '../../utils/money';
import { Modal } from '../../components/ui/Modal';

interface Props {
  candidates: TransferCandidate[];
  transactions: Map<string, Transaction>;
  accounts: Map<string, Account>;
  onClose: () => void;
}

/** Revisione delle coppie uscita/entrata che sembrano trasferimenti tra i propri conti. */
export function TransferReview({ candidates, transactions, accounts, onClose }: Props) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const rows = candidates
    .map((c) => ({ c, out: transactions.get(c.outId), inn: transactions.get(c.inId) }))
    .filter((r): r is { c: TransferCandidate; out: Transaction; inn: Transaction } => !!r.out && !!r.inn);

  const confirm = async (c: TransferCandidate) => {
    try {
      await linkAsTransfer(c.outId, c.inId);
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <Modal
      title="Trasferimenti tra i tuoi conti"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Chiudi
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || rows.length === 0}
            data-testid="confirm-all-transfers"
            onClick={async () => {
              setBusy(true);
              for (const r of rows) await confirm(r.c);
              setBusy(false);
              toast.success(`${rows.length} trasferimenti collegati.`);
              onClose();
            }}
          >
            Sono tutti trasferimenti
          </button>
        </>
      }
    >
      <p className="small muted" style={{ marginBottom: 14 }}>
        Queste uscite e entrate hanno lo stesso importo su due tuoi conti, a pochi giorni di distanza. Se le confermi diventano trasferimenti: spariscono da entrate, uscite e budget, e i saldi dei conti non cambiano.
      </p>
      {rows.length === 0 ? (
        <p className="small muted">Nessun possibile trasferimento da controllare.</p>
      ) : (
        <div className="item-list panel flush">
          {rows.map(({ c, out, inn }) => (
            <div className="item" key={`${c.outId}|${c.inId}`} style={{ gridTemplateColumns: '1fr auto' }} data-testid="transfer-candidate">
              <div style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <strong className="num">{formatMoney(-out.amount, out.currency)}</strong>
                  <span className="muted small">{accounts.get(out.accountId)?.name}</span>
                  <ArrowRight size={14} className="muted" />
                  <span className="muted small">{accounts.get(inn.accountId)?.name}</span>
                </div>
                <div className="xs muted" style={{ marginTop: 4 }}>
                  {formatDate(out.date)} · {out.description}
                </div>
                <div className="xs muted">
                  {formatDate(inn.date)} · {inn.description}
                </div>
                <div className="xs" style={{ marginTop: 4, color: c.certain ? 'var(--income)' : 'var(--warning)' }}>
                  {c.certain ? 'Molto probabile' : 'Possibile'}: {c.reasons.join(', ')}
                </div>
              </div>
              <div className="actions">
                <button className="btn btn-sm btn-primary" onClick={() => confirm(c)} aria-label="Conferma trasferimento">
                  <Check size={13} /> Trasferimento
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  aria-label="Non è un trasferimento"
                  onClick={async () => {
                    await ignorePair(c.outId, c.inId);
                  }}
                >
                  <X size={13} /> No
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
