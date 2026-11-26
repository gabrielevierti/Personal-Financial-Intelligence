import { useState, type ReactNode } from 'react';
import { Modal } from './Modal';

interface Props {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** Se impostato, l'utente deve digitare questa parola per confermare. */
  requireText?: string;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

export function ConfirmDialog({ title, message, confirmLabel, danger = true, requireText, onConfirm, onClose }: Props) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = !requireText || typed.trim() === requireText;
  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Annulla
          </button>
          <button className={danger ? 'btn btn-danger solid' : 'btn btn-primary'} disabled={!ok || busy} onClick={run}>
            {busy ? 'Attendi…' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="muted">{message}</div>
        {requireText && (
          <div className="field">
            <label htmlFor="confirm-text">
              Digita <strong>{requireText}</strong> per confermare
            </label>
            <input id="confirm-text" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </div>
        )}
      </div>
    </Modal>
  );
}
