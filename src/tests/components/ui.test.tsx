import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ToastProvider } from '../../hooks/useToast';
import { PrefsProvider } from '../../hooks/usePrefs';
import { App } from '../../App';
import { resetDb } from '../dbReset';
import * as repo from '../../services/repository';

function MoneyHarness({ onValue }: { onValue: (v: number | null) => void }) {
  const [v, setV] = useState<number | null>(null);
  return (
    <MoneyInput
      ariaLabel="importo"
      value={v}
      onChange={(x) => {
        setV(x);
        onValue(x);
      }}
    />
  );
}

describe('MoneyInput', () => {
  it('converte il testo in centesimi e blocca caratteri non validi', async () => {
    const spy = vi.fn();
    render(<MoneyHarness onValue={spy} />);
    const input = screen.getByLabelText('importo');
    await userEvent.type(input, '1.234,5x');
    expect(spy).toHaveBeenLastCalledWith(123450);
    expect(input).toHaveValue('1.234,5');
  });
  it('rifiuta il segno negativo se non consentito', async () => {
    const spy = vi.fn();
    render(<MoneyHarness onValue={spy} />);
    await userEvent.type(screen.getByLabelText('importo'), '-5');
    expect(spy).toHaveBeenLastCalledWith(500);
  });
});

describe('ConfirmDialog', () => {
  it('richiede la parola di conferma prima di abilitare il pulsante', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog title="Sicuro?" message="Test" confirmLabel="Elimina" requireText="ELIMINA" onConfirm={onConfirm} onClose={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Elimina' });
    expect(btn).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Digita/), 'ELIMINA');
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

// Recharts usa ResizeObserver, assente in jsdom
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

describe('App', () => {
  beforeEach(async () => {
    await resetDb();
    localStorage.clear();
    window.location.hash = '';
  });
  it('mostra lo stato vuoto della dashboard senza dati', async () => {
    render(<App />);
    expect(await screen.findByText('Inizia aggiungendo il tuo primo conto')).toBeInTheDocument();
  });
  it('mostra la dashboard con indicatori calcolati dai dati reali', async () => {
    const a = await repo.createAccount({ name: 'C', institution: '', type: 'checking', currency: 'EUR', initialBalance: 100000, createdAt: '2020-01-01' });
    const today = new Date().toISOString().slice(0, 10);
    await repo.createTransaction({ accountId: a, date: today, description: 'Stipendio', amount: 200000, type: 'income', categoryId: 'inc-salary' });
    await repo.createTransaction({ accountId: a, date: today, description: 'Affitto', amount: 50000, type: 'expense', categoryId: 'exp-home' });
    render(<App />);
    const nw = await screen.findByTestId('kpi-networth');
    await waitFor(() => expect(nw.textContent?.replace(/\s/g, ' ')).toContain('2.500,00'));
    expect(screen.getByTestId('kpi-saving-rate')).toHaveTextContent('75,0%');
  });
  it('la navigazione a pagine inesistenti mostra un messaggio', async () => {
    window.location.hash = '#/boh';
    render(
      <ToastProvider>
        <PrefsProvider>
          <App />
        </PrefsProvider>
      </ToastProvider>,
    );
    expect(await screen.findByText('Questa pagina non esiste')).toBeInTheDocument();
  });
});
