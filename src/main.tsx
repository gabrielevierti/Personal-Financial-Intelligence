import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { App } from './App';
import { registerServiceWorker } from './services/pwa';
import { db } from './database/db';
import { applyTheme, readThemePref, resolveTheme } from './hooks/useTheme';

applyTheme(resolveTheme(readThemePref()));

const root = createRoot(document.getElementById('root')!);

// Ritorno dalla banca: se il redirect punta a questa app, il codice arriva nella query string.
// Lo si sposta in sessionStorage e si pulisce l'indirizzo, poi si apre la pagina dei collegamenti.
{
  const params = new URLSearchParams(window.location.search);
  if (params.has('code') || params.has('error')) {
    sessionStorage.setItem('pfi.bankCallback', window.location.href);
    window.history.replaceState(null, '', `${window.location.pathname}#/banks`);
  }
}

db.open()
  .then(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    root.render(
      <div className="error-state" role="alert" style={{ maxWidth: 560, margin: '10vh auto' }}>
        <h1 style={{ marginBottom: 12 }}>Impossibile aprire il database locale</h1>
        <p className="muted">
          PFI salva i dati in IndexedDB. Il browser non ne consente l'uso (modalità privata restrittiva, spazio esaurito o permessi negati). Dettaglio: {msg}
        </p>
      </div>,
    );
  });

registerServiceWorker();
