import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Building2, Search } from 'lucide-react';
import { db } from '../../database/db';
import { navigate, useRoute } from '../../hooks/useRoute';
import { searchCompanies, type Attempt } from '../../services/research/registry';
import type { SearchResult } from '../../services/research/types';
import { Callout, EmptyState } from '../../components/ui/States';
import { CompanyView } from './CompanyView';

export function AttemptsNote({ attempts }: { attempts: Attempt[] }) {
  const failed = attempts.filter((a) => !a.ok && a.message);
  if (!failed.length) return null;
  const uniq = [...new Map(failed.map((a) => [`${a.provider}|${a.message}`, a])).values()];
  return (
    <details className="attempts xs muted">
      <summary>Fonti non disponibili o senza dati ({uniq.length})</summary>
      <ul>
        {uniq.map((a, i) => (
          <li key={i}>
            <strong>{a.provider}</strong> · {a.what}: {a.message}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function ResearchPage() {
  const route = useRoute();
  const symbol = route.params.get('symbol');
  if (symbol) return <CompanyView symbol={symbol.toUpperCase()} cik={route.params.get('cik') ?? undefined} tab={route.params.get('tab') ?? 'overview'} />;
  return <CompanySearch />;
}

export function CompanySearch({ onPick, compact }: { onPick?: (r: SearchResult) => void; compact?: boolean }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ results: SearchResult[]; attempts: Attempt[] } | null>(null);
  const recent = useLiveQuery(() => db.company_snapshots.orderBy('createdAt').reverse().limit(6).toArray(), []);
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 350);
    return () => window.clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (debounced.length < 2) return setRes(null);
    let alive = true;
    setBusy(true);
    void searchCompanies(debounced).then((r) => {
      if (alive) {
        setRes(r);
        setBusy(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [debounced]);
  const pick = (r: SearchResult) => (onPick ? onPick(r) : navigate('research', { symbol: r.symbol, ...(r.cik ? { cik: r.cik } : {}) }));
  const allDown = res && res.results.length === 0 && res.attempts.length > 0 && res.attempts.every((a) => !a.ok && a.message);

  return (
    <div>
      {!compact && (
        <div className="page-head">
          <div>
            <h1>Aziende</h1>
            <p>Cerca un'azienda per nome, ticker, ISIN o borsa. I dati arrivano da fonti pubbliche tramite il bridge locale, con fonte e data di ogni valore. Nessun tuo dato personale viene inviato.</p>
          </div>
          <div className="actions">
            <a className="btn" href="#/market">Mercati</a>
            <a className="btn" href="#/compare">Confronta aziende</a>
          </div>
        </div>
      )}
      <div className="panel" style={{ marginBottom: 16 }}>
        <label htmlFor="co-search" className="sr-only">
          Cerca azienda
        </label>
        <div className="search-box">
          <Search size={16} aria-hidden="true" />
          <input id="co-search" className="input" placeholder="Es. Apple, MSFT, US0378331005, NASDAQ" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" data-testid="company-search" />
        </div>
        {busy && <p className="small muted" style={{ marginTop: 8 }}>Ricerca in corso…</p>}
        {allDown && (
          <div style={{ marginTop: 10 }}>
            <Callout kind="warning">Nessuna fonte di dati disponibile. Avvia il bridge (<code>npm run bridge</code>) e configura almeno una fonte nella sezione <code>research</code> di <code>bridge/config.json</code> (vedi <a href="#/settings">Impostazioni</a>).</Callout>
          </div>
        )}
        {res && res.results.length > 0 && (
          <ul className="result-list" data-testid="search-results">
            {res.results.map((r) => (
              <li key={`${r.symbol}-${r.source}`}>
                <button className="result" onClick={() => pick(r)}>
                  <span className="result-sym num">{r.symbol}</span>
                  <span className="result-name">{r.name}</span>
                  <span className="xs muted">{[r.exchange, r.region, r.type, r.currency, r.isin && `ISIN ${r.isin}`].filter(Boolean).join(' · ')}</span>
                  <span className="xs muted">{r.source}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {res && res.results.length === 0 && !allDown && <p className="small muted" style={{ marginTop: 8 }}>Nessun risultato.</p>}
        {res && <AttemptsNote attempts={res.attempts} />}
      </div>
      {!compact && !res && (
        <div className="panel">
          {recent && recent.length > 0 ? (
            <>
              <div className="panel-head">
                <h2>Report salvati</h2>
              </div>
              <ul className="plain-list">
                {recent.map((s) => (
                  <li key={s.id} className="row-between small">
                    <a href={`#/research?symbol=${s.symbol}&tab=report`}>
                      {s.name} <span className="muted num">{s.symbol}</span>
                    </a>
                    <span className="xs muted">{new Date(s.createdAt).toLocaleString('it-IT')}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <EmptyState compact icon={<Building2 size={20} />} title="Inizia con una ricerca" text="Per le società USA i bilanci arrivano dalla SEC (fonte ufficiale). Per le altre servono Alpha Vantage o Finnhub con una chiave gratuita." />
          )}
        </div>
      )}
    </div>
  );
}
