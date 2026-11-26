import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../database/db';
import { pricePerformance, type PricePerformance } from '../../services/research/metrics';
import { loadHistory } from '../../services/research/registry';
import type { PriceHistory } from '../../services/research/types';
import { SourceTag } from '../../components/finance/Provenance';
import { Sparkline } from '../../components/finance/Sparkline';
import { useAiPage } from '../../components/ai/AiProvider';
import { fmtPct, fmtPrice, pctClass } from './format';

/** ETF usati come indicatori dei mercati: sono strumenti quotati, non gli indici stessi. */
export const MARKET_PROXIES: Array<{ symbol: string; label: string }> = [
  { symbol: 'SPY', label: 'USA · S&P 500' },
  { symbol: 'QQQ', label: 'USA · Nasdaq 100' },
  { symbol: 'DIA', label: 'USA · Dow Jones' },
  { symbol: 'IWM', label: 'USA · Russell 2000' },
  { symbol: 'VGK', label: 'Europa' },
  { symbol: 'EWJ', label: 'Giappone' },
  { symbol: 'EEM', label: 'Mercati emergenti' },
  { symbol: 'TLT', label: 'Titoli di Stato USA 20+ anni' },
  { symbol: 'GLD', label: 'Oro' },
];

type Row = { symbol: string; label: string; perf: PricePerformance | null; hist: PriceHistory | null; day: number | null; done: boolean };

export function MarketPage() {
  const favorites = useLiveQuery(() => db.watchlist.filter((w) => w.favorite).toArray(), []);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const all = [...MARKET_PROXIES, ...(favorites ?? []).map((f) => ({ symbol: f.symbol, label: f.name }))];
  useEffect(() => {
    for (const r of all) {
      if (rows[r.symbol]) continue;
      setRows((x) => ({ ...x, [r.symbol]: { ...r, perf: null, hist: null, day: null, done: false } }));
      void loadHistory(r.symbol).then((h) => {
        const hist = h.daily ?? h.weekly;
        const pts = hist?.points ?? [];
        const day = h.daily && pts.length > 1 ? pts[pts.length - 1].close / pts[pts.length - 2].close - 1 : null;
        setRows((x) => ({ ...x, [r.symbol]: { ...r, hist, perf: pts.length ? pricePerformance(pts) : null, day, done: true } }));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all.map((a) => a.symbol).join(',')]);
  const list = all.map((a) => rows[a.symbol]).filter(Boolean);
  useAiPage({ section: 'market', label: 'Market Overview', skipPersonal: true, blocks: () => [{ title: 'MERCATI (ETF di riferimento, dati di fine giornata)', body: list.map((r) => `${r.label} (${r.symbol}): ultimo ${r.perf?.last ? `${fmtPrice(r.perf.last.close)} al ${r.perf.last.date}` : 'n.d.'}, 1G ${fmtPct(r.day)}, 1M ${fmtPct(r.perf?.returns['1M'])}, YTD ${fmtPct(r.perf?.returns.YTD)}, 1A ${fmtPct(r.perf?.returns['1Y'])}`).join('\n') }] }, [list]);
  const src = list.find((r) => r.hist)?.hist?.prov;
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Market Overview</h1>
          <p>Andamento dei principali mercati tramite ETF quotati che li replicano, più i tuoi preferiti della watchlist. Dati di fine giornata, non in tempo reale.</p>
        </div>
      </div>
      <section className="panel" data-testid="market">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Mercato</th>
                <th className="right">Ultimo</th>
                <th>Data</th>
                <th className="right">1G</th>
                <th className="right">1S</th>
                <th className="right">1M</th>
                <th className="right">YTD</th>
                <th className="right">1A</th>
                <th className="right">5A</th>
                <th>12 mesi</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.symbol}>
                  <td>
                    <a href={`#/research?symbol=${r.symbol}`}>{r.label}</a> <span className="xs muted num">{r.symbol}</span>
                  </td>
                  <td className="right num">{r.perf?.last ? fmtPrice(r.perf.last.close) : !r.done ? '…' : '—'}</td>
                  <td className="xs muted num">{r.perf?.last?.date ?? ''}</td>
                  {[r.day, r.perf?.returns['1W'], r.perf?.returns['1M'], r.perf?.returns.YTD, r.perf?.returns['1Y'], r.perf?.returns['5Y']].map((v, i) => (
                    <td key={i} className={`right num ${pctClass(v)}`}>
                      {fmtPct(v, 1, true)}
                    </td>
                  ))}
                  <td>{r.hist && <Sparkline values={r.hist.points.slice(-252).filter((_, i, a) => i % 5 === 0 || i === a.length - 1).map((p) => p.close)} label={`Andamento di ${r.label}`} width={100} height={24} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {src ? <SourceTag prov={src} /> : <p className="xs muted">Se le righe restano vuote, configura Tiingo o Alpha Vantage nel bridge (Impostazioni → Fonti dati di mercato).</p>}
      </section>
    </div>
  );
}
