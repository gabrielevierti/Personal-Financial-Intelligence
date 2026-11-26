import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Star, Trash2 } from 'lucide-react';
import { db } from '../../database/db';
import { useToast } from '../../hooks/useToast';
import { loadQuote } from '../../services/research/registry';
import type { Quote } from '../../services/research/types';
import { addToWatchlist, removeFromWatchlist, updateWatchItem } from '../../services/research/watchlist';
import { useAiPage } from '../../components/ai/AiProvider';
import { EmptyState } from '../../components/ui/States';
import { CompanySearch } from './ResearchPage';
import { fmtPct, fmtPrice, pctClass } from './format';

export function WatchlistPage() {
  const toast = useToast();
  const items = useLiveQuery(() => db.watchlist.toArray(), []);
  const [quotes, setQuotes] = useState<Record<string, Quote | null | 'loading'>>({});
  const [list, setList] = useState('Principale');
  const [newList, setNewList] = useState('');
  useEffect(() => {
    for (const w of items ?? []) {
      if (quotes[w.symbol] !== undefined) continue;
      setQuotes((q) => ({ ...q, [w.symbol]: 'loading' }));
      void loadQuote(w.symbol).then((r) => setQuotes((q) => ({ ...q, [w.symbol]: r.quote })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);
  const lists = [...new Set([...(items ?? []).map((i) => i.list), 'Principale'])];
  const shown = (items ?? []).filter((i) => i.list === list).sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.symbol.localeCompare(b.symbol));
  useAiPage({ section: 'market', label: `Watchlist · ${list}`, skipPersonal: true, blocks: () => [{ title: 'WATCHLIST', body: shown.map((w) => { const q = quotes[w.symbol]; return `${w.symbol} ${w.name}: ${q && q !== 'loading' ? `${fmtPrice(q.price, w.currency)} (${fmtPct((q.changePct ?? 0) / 100, 2, true)}) al ${q.asOf}` : 'quotazione non disponibile'}`; }).join('\n') }] }, [shown, quotes]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Watchlist</h1>
          <p>Aziende che segui. Le quotazioni sono ritardate: data e ora dell'ultimo dato sono sempre indicate.</p>
        </div>
      </div>
      <div className="row" style={{ gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {lists.map((l) => (
          <button key={l} className={`btn btn-sm${l === list ? ' is-active' : ''}`} onClick={() => setList(l)}>
            {l}
          </button>
        ))}
        <form
          className="row"
          style={{ gap: 4 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (newList.trim()) setList(newList.trim().slice(0, 40));
            setNewList('');
          }}
        >
          <label htmlFor="new-list" className="sr-only">Nome della nuova lista</label>
          <input id="new-list" className="input input-sm" placeholder="Nuova lista" value={newList} onChange={(e) => setNewList(e.target.value)} style={{ width: 140 }} />
          <button className="btn btn-ghost btn-sm" disabled={!newList.trim()}>Crea</button>
        </form>
      </div>
      <CompanySearch
        compact
        onPick={async (r) => {
          await addToWatchlist({ symbol: r.symbol, name: r.name, exchange: r.exchange, currency: r.currency }, list);
          toast.success(`${r.symbol} aggiunto a ${list}.`);
        }}
      />
      <section className="panel" data-testid="watchlist">
        {shown.length === 0 ? (
          <EmptyState compact icon={<Star size={20} />} title="Lista vuota" text="Cerca un'azienda qui sopra per aggiungerla." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th />
                  <th>Titolo</th>
                  <th className="right">Prezzo</th>
                  <th className="right">Variazione</th>
                  <th>Ultimo dato</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((w) => {
                  const q = quotes[w.symbol];
                  return (
                    <tr key={w.id}>
                      <td>
                        <button className={`btn btn-ghost icon-btn${w.favorite ? ' fav' : ''}`} aria-pressed={w.favorite} aria-label={`Preferito: ${w.symbol}`} onClick={() => void updateWatchItem(w.id, { favorite: !w.favorite })}>
                          <Star size={14} />
                        </button>
                      </td>
                      <td>
                        <a href={`#/research?symbol=${w.symbol}`}>
                          <strong className="num">{w.symbol}</strong> {w.name}
                        </a>
                        <div className="xs muted">{w.exchange}</div>
                      </td>
                      <td className="right num">{q === 'loading' ? '…' : q ? fmtPrice(q.price, w.currency) : '—'}</td>
                      <td className={`right num ${q && q !== 'loading' ? pctClass(q.changePct) : ''}`}>{q && q !== 'loading' && q.changePct !== undefined ? fmtPct(q.changePct / 100, 2, true) : '—'}</td>
                      <td className="xs muted">{q && q !== 'loading' ? `${new Date(q.asOf).toLocaleString('it-IT')} · ${q.prov.source}` : q === null ? 'non disponibile' : ''}</td>
                      <td className="right">
                        <button className="btn btn-ghost icon-btn" aria-label={`Rimuovi ${w.symbol}`} onClick={() => void removeFromWatchlist(w.id)}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
