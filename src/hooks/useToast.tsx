import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { ValidationError } from '../services/validation';

type Kind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: Kind;
  message: string;
}

interface ToastApi {
  success: (m: string) => void;
  error: (m: string | unknown) => void;
  info: (m: string) => void;
}

const Ctx = createContext<ToastApi | null>(null);

export function errorMessage(e: unknown): string {
  if (e instanceof ValidationError) return e.issues.join(' ');
  if (e instanceof Error) {
    if (e.name === 'QuotaExceededError') return 'Spazio di archiviazione del browser esaurito.';
    return e.message || 'Si è verificato un errore.';
  }
  if (typeof e === 'string') return e;
  return 'Si è verificato un errore imprevisto.';
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (kind: Kind, message: string) => {
      const id = next.current++;
      setToasts((t) => [...t.slice(-3), { id, kind, message }]);
      window.setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 3800);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', errorMessage(m)),
      info: (m) => push('info', m),
    }),
    [push],
  );
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : undefined}>
            {t.kind === 'success' ? <CheckCircle2 size={18} /> : t.kind === 'error' ? <AlertCircle size={18} /> : <Info size={18} />}
            <p>{t.message}</p>
            <button onClick={() => dismiss(t.id)} aria-label="Chiudi notifica">
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToast fuori da ToastProvider');
  return c;
}
