import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ExternalLink, FlaskConical, RefreshCw, Star } from 'lucide-react';
import { db } from '../../database/db';
import { navigate } from '../../hooks/useRoute';
import { useToast } from '../../hooks/useToast';
import { drawdownSeries, filterRange, findAnomalies, multiples, normalizeTogether, pricePerformance, yearMetrics } from '../../services/research/metrics';
import { loadHistory } from '../../services/research/registry';
import { addToWatchlist, removeFromWatchlist } from '../../services/research/watchlist';
import type { PricePoint } from '../../services/research/types';
import { SourceTag } from '../../components/finance/Provenance';
import { AiButton } from '../../components/ai/AiPanel';
import { useAiPage } from '../../components/ai/AiProvider';
import { Callout, Skeleton } from '../../components/ui/States';
import { AttemptsNote } from './ResearchPage';
import { CompareChart, DrawdownChart, PriceChart, VolumeChart } from './charts';
import { fmtBig, fmtNum, fmtPct, fmtPrice, fmtX, pctClass } from './format';
import { useCompany, type CompanyState } from './useCompany';
import { DebtTab, StatementsTab } from './StatementTabs';
import { ValuationTab } from './ValuationTab';
import { ReportTab } from './ReportTab';
import { CompanyLogo } from './Logo';

const TABS = [
  ['overview', 'Overview'],
  ['financials', 'Financials'],
  ['balance', 'Balance Sheet'],
  ['debt', 'Debt'],
  ['valuation', 'Valuation'],
  ['analysts', 'Analysts'],
  ['risks', 'Risks'],
  ['report', 'AI Report'],
] as const;

const RANGES = ['1M', '6M', 'YTD', '1Y', '3Y', '5Y', 'MAX'] as const;

/** Storico unico: giornaliero se disponibile, integrato dal settimanale per il periodo più lontano. */
export function mergedPrices(c: Pick<CompanyState, 'daily' | 'weekly'>): PricePoint[] {
  const d = c.daily?.points ?? [];
  const w = c.weekly?.points ?? [];
  if (!w.length) return d;
  const first = d[0]?.date ?? '9999';
  return [...w.filter((p) => p.date < first), ...d];
}

export function companyContext(c: CompanyState): string {
  const d = c.data;
  if (!d) return '';
  const p = d.profile;
  const y = d.statements[0];
  const m = yearMetrics(d.statements);
  const perf = pricePerformance(mergedPrices(c));
  const lines = [
    `Azienda: ${p?.name ?? d.symbol} (${d.symbol}), ${[p?.exchange, p?.country, p?.sector, p?.industry].filter(Boolean).join(', ')}`,
    d.quote ? `Prezzo: ${fmtPrice(d.quote.price, p?.currency)} al ${d.quote.asOf} [${d.quote.prov.source}, ${d.quote.prov.delay ?? ''}]` : 'Prezzo: non disponibile',
    `Capitalizzazione: ${fmtBig(p?.marketCap?.value, p?.currency)}`,
    `Rendimenti: 1M ${fmtPct(perf.returns['1M'])}, YTD ${fmtPct(perf.returns.YTD)}, 1A ${fmtPct(perf.returns['1Y'])}, 5A ${fmtPct(perf.returns['5Y'])}`,
  ];
  if (y) lines.push(`Ultimo esercizio (${y.periodEnd}, ${y.currency}, fonte ${y.prov.source}): ricavi ${fmtBig(y.revenue)}, utile netto ${fmtBig(y.netIncome)}, FCF ${fmtBig(m[0].fcf)}, debito netto ${fmtBig(m[0].netDebt)}, margine operativo ${fmtPct(m[0].operatingMargin)}, ROE ${fmtPct(m[0].roe)}, ND/EBITDA ${fmtX(m[0].netDebtToEbitda)}`);
  for (const r of m.slice(1, 5)) lines.push(`Esercizio ${r.fiscalYear}: ricavi ${fmtBig(r.revenue)}, utile ${fmtBig(r.netIncome)}, FCF ${fmtBig(r.fcf)}, margine op. ${fmtPct(r.operatingMargin)}`);
  const an = findAnomalies(m).slice(0, 6);
  if (an.length) lines.push(`Segnali: ${an.map((a) => `${a.fiscalYear} ${a.message}`).join('; ')}`);
  if (p?.description) lines.push(`Descrizione (fonte): ${p.description.slice(0, 800)}`);
  return lines.join('\n');
}

export function CompanyView({ symbol, cik, tab }: { symbol: string; cik?: string; tab: string }) {
  const c = useCompany(symbol, cik);
  const toast = useToast();
  const watch = useLiveQuery(() => db.watchlist.where('symbol').equals(symbol).first(), [symbol]);
  const d = c.data;
  const p = d?.profile;
  const setTab = (t: string) => navigate('research', { symbol, ...(cik ? { cik } : {}), tab: t });

  useAiPage(d ? { section: `research:${symbol}`, label: `${p?.name ?? symbol} · ${TABS.find((t) => t[0] === tab)?.[1] ?? ''}`, skipPersonal: true, blocks: () => [{ title: 'DATI AZIENDA (da fonti pubbliche, calcoli di PFI)', body: companyContext(c) }] } : null, [d, c.daily, c.weekly, tab]);

  if (!d && c.loading)
    return (
      <div className="stack">
        <Skeleton h={80} />
        <Skeleton h={300} />
      </div>
    );
  if (!d) return <Callout kind="danger">{c.error ?? 'Dati non disponibili.'}</Callout>;

  const q = d.quote;
  const noData = !p && !q && !d.statements.length;
  return (
    <div>
      <div className="co-head">
        <a className="btn btn-ghost icon-btn" href="#/research" aria-label="Torna alla ricerca">
          <ArrowLeft size={16} />
        </a>
        <CompanyLogo url={p?.logo} name={p?.name ?? symbol} />
        <div className="co-title">
          <h1>
            {p?.name ?? symbol} <span className="muted num">{symbol}</span>
          </h1>
          <div className="xs muted">{[p?.exchange, p?.country, p?.sector, p?.industry, p?.currency].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="co-price">
          {q ? (
            <>
              <div className="num fc-big" data-testid="co-price">
                {fmtPrice(q.price, p?.currency ?? q.currency)}
              </div>
              <div className={`num small ${pctClass(q.change)}`}>
                {q.change !== undefined && `${q.change > 0 ? '+' : ''}${fmtNum(q.change)}`} {q.changePct !== undefined && `(${fmtPct(q.changePct / 100, 2, true)})`}
              </div>
              <div className="xs muted" title={q.prov.delay}>
                Ultimo dato: {new Date(q.asOf).toLocaleString('it-IT')} · non in tempo reale
              </div>
            </>
          ) : (
            <span className="small muted">Quotazione non disponibile</span>
          )}
        </div>
        <div className="actions">
          <button
            className={`btn btn-sm${watch ? ' is-active' : ''}`}
            onClick={async () => {
              if (watch) await removeFromWatchlist(watch.id);
              else await addToWatchlist({ symbol, name: p?.name ?? symbol, exchange: p?.exchange, currency: p?.currency });
              toast.success(watch ? 'Rimosso dalla watchlist.' : 'Aggiunto alla watchlist.');
            }}
            aria-pressed={!!watch}
          >
            <Star size={14} /> {watch ? 'In watchlist' : 'Watchlist'}
          </button>
          <a className="btn btn-sm" href={`#/simulations?symbol=${encodeURIComponent(symbol)}`}>
            <FlaskConical size={14} /> Simula
          </a>
          <button className="btn btn-ghost btn-sm" onClick={() => void c.refresh()} disabled={c.loading} aria-label="Scarica di nuovo i dati">
            <RefreshCw size={14} className={c.loading ? 'spin' : ''} />
          </button>
        </div>
      </div>
      {noData && <Callout kind="warning">Nessuna fonte ha restituito dati per {symbol}. Controlla il simbolo o le fonti configurate.</Callout>}
      <AttemptsNote attempts={[...d.attempts, ...c.historyAttempts]} />
      <div className="tabs" role="tablist" aria-label="Sezioni dell'analisi">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`tab${tab === id ? ' is-active' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'overview' && <Overview c={c} />}
        {tab === 'financials' && <StatementsTab years={d.statements} kind="income" />}
        {tab === 'balance' && <StatementsTab years={d.statements} kind="balance" />}
        {tab === 'debt' && <DebtTab years={d.statements} filings={d.filings} />}
        {tab === 'valuation' && <ValuationTab c={c} />}
        {tab === 'analysts' && <AnalystsTab c={c} />}
        {tab === 'risks' && <RisksTab c={c} />}
        {tab === 'report' && <ReportTab c={c} />}
      </div>
    </div>
  );
}

function Overview({ c }: { c: CompanyState }) {
  const d = c.data!;
  const p = d.profile;
  const [range, setRange] = useState<(typeof RANGES)[number]>('1Y');
  const [bench, setBench] = useState<PricePoint[] | null>(null);
  const all = useMemo(() => mergedPrices(c), [c]);
  const pts = useMemo(() => filterRange(all, range), [all, range]);
  const perf = useMemo(() => pricePerformance(all), [all]);
  const y0 = d.statements[0];
  const mult = multiples({ price: d.quote?.price ?? perf.last?.close ?? null, shares: p?.sharesOutstanding?.value ?? y0?.sharesDiluted ?? null, marketCap: p?.marketCap?.value ?? null }, y0);
  const hist = c.daily ?? c.weekly;
  useEffect(() => {
    let alive = true;
    void loadHistory('SPY').then((h) => alive && setBench(h.daily?.points ?? h.weekly?.points ?? []));
    return () => {
      alive = false;
    };
  }, []);
  const benchData = bench?.length ? normalizeTogether(pts, bench) : [];
  const cur = p?.currency;
  const ratios = d.ratios;
  const stat = (label: string, value: string, src?: Parameters<typeof SourceTag>[0]['prov']) => (
    <div className="stat">
      <span className="xs muted">{label}</span>
      <span className="num">{value}</span>
      {src && <SourceTag prov={src} compact />}
    </div>
  );
  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <h2>Prezzo</h2>
          <div className="row" style={{ gap: 4 }}>
            {RANGES.map((r) => (
              <button key={r} className={`btn btn-xs${range === r ? ' is-active' : ''}`} onClick={() => setRange(r)} aria-pressed={range === r}>
                {r}
              </button>
            ))}
          </div>
        </div>
        {pts.length > 1 ? (
          <>
            <PriceChart points={pts} currency={cur} />
            <VolumeChart points={pts} />
            {hist && <SourceTag prov={hist.prov} />}
          </>
        ) : (
          <p className="small muted">Storico prezzi non disponibile: serve Tiingo o Alpha Vantage nel bridge.</p>
        )}
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Performance e dati di mercato</h2>
          <AiButton prompt="Commenta l'andamento del titolo" focus={`Rendimenti: ${Object.entries(perf.returns).map(([k, v]) => `${k} ${fmtPct(v)}`).join(', ')}; 52 settimane ${fmtPrice(perf.high52)} / ${fmtPrice(perf.low52)}; max drawdown 12 mesi ${fmtPct(perf.maxDrawdown)}`} />
        </div>
        <div className="stat-grid">
          {stat('1 giorno', fmtPct(d.quote?.changePct !== undefined ? d.quote.changePct / 100 : null, 2, true), d.quote?.prov)}
          {(['1W', '1M', 'YTD', '1Y', '3Y', '5Y'] as const).map((k) => stat({ '1W': '1 settimana', '1M': '1 mese', YTD: 'Da inizio anno', '1Y': '1 anno', '3Y': '3 anni', '5Y': '5 anni' }[k], fmtPct(perf.returns[k], 1, true)))}
          {stat('Massimo 52 settimane', fmtPrice(perf.high52 ?? ratios.high52?.value, cur), ratios.high52?.prov)}
          {stat('Minimo 52 settimane', fmtPrice(perf.low52 ?? ratios.low52?.value, cur), ratios.low52?.prov)}
          {stat('Volume medio 3 mesi', fmtBig(perf.avgVolume3m ?? ratios.avgVolume3m?.value), ratios.avgVolume3m?.prov)}
          {stat('Capitalizzazione', fmtBig(mult.marketCap, cur), p?.marketCap?.prov)}
          {stat('Enterprise value', fmtBig(mult.enterpriseValue, y0?.currency), y0 ? { ...y0.prov, source: 'calcolato da PFI', status: 'calcolato' } : undefined)}
          {stat('Beta', fmtNum(ratios.beta?.value), ratios.beta?.prov)}
        </div>
        <p className="xs muted" style={{ marginTop: 8 }}>Rendimenti di prezzo calcolati dallo storico (dividendi esclusi). I prezzi delle fonti gratuite sono di fine giornata o ritardati.</p>
      </section>
      <div className="grid grid-2">
        <section className="panel">
          <div className="panel-head">
            <h2>Confronto con S&amp;P 500 (SPY)</h2>
            <span className="hint">base 100 · {range}</span>
          </div>
          {benchData.length > 1 ? <CompareChart data={benchData} aLabel={d.symbol} bLabel="SPY" /> : <p className="small muted">Benchmark non disponibile.</p>}
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Drawdown</h2>
            <span className="hint">distanza dal massimo · {range}</span>
          </div>
          {pts.length > 1 ? <DrawdownChart data={drawdownSeries(pts)} /> : <p className="small muted">Storico non disponibile.</p>}
        </section>
      </div>
      <div className="grid grid-2">
        <section className="panel">
          <div className="panel-head">
            <h2>Profilo</h2>
          </div>
          {p?.description && <p className="small">{p.description}</p>}
          <dl className="kv" style={{ marginTop: 10 }}>
            {p?.website && (
              <>
                <dt>Sito</dt>
                <dd>
                  <a href={p.website} target="_blank" rel="noreferrer noopener">
                    {p.website.replace(/^https?:\/\//, '')} <ExternalLink size={11} />
                  </a>
                </dd>
              </>
            )}
            {p?.ipo && (
              <>
                <dt>Quotata dal</dt>
                <dd>{p.ipo}</dd>
              </>
            )}
            {p?.cik && (
              <>
                <dt>CIK SEC</dt>
                <dd className="num">{p.cik}</dd>
              </>
            )}
            {p?.fiscalYearEnd && (
              <>
                <dt>Chiusura esercizio</dt>
                <dd>{p.fiscalYearEnd}</dd>
              </>
            )}
          </dl>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {p?.sources.map((s, i) => <SourceTag key={i} prov={s} compact />)}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Notizie recenti</h2>
            <span className="hint">ultimi 30 giorni</span>
          </div>
          {d.news.length ? (
            <ul className="plain-list news">
              {d.news.slice(0, 8).map((n) => (
                <li key={n.url}>
                  <a href={n.url} target="_blank" rel="noreferrer noopener" className="small">
                    {n.headline}
                  </a>
                  <div className="xs muted">
                    {n.source} · {new Date(n.datetime).toLocaleDateString('it-IT')}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">Nessuna notizia: richiede Finnhub nel bridge.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function AnalystsTab({ c }: { c: CompanyState }) {
  const a = c.data!.analysts;
  const rec = a.recommendations;
  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <h2>Raccomandazioni degli analisti</h2>
          {rec && <SourceTag prov={rec.prov} />}
        </div>
        {rec ? (
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th>Periodo</th>
                  <th className="right">Strong buy</th>
                  <th className="right">Buy</th>
                  <th className="right">Hold</th>
                  <th className="right">Sell</th>
                  <th className="right">Strong sell</th>
                </tr>
              </thead>
              <tbody>
                {rec.value.map((r) => (
                  <tr key={r.period}>
                    <td>{r.period}</td>
                    <td className="right num">{r.strongBuy}</td>
                    <td className="right num">{r.buy}</td>
                    <td className="right num">{r.hold}</td>
                    <td className="right num">{r.sell}</td>
                    <td className="right num">{r.strongSell}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="small muted">Non disponibili.</p>
        )}
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Prezzo obiettivo</h2>
          {a.priceTarget && <SourceTag prov={a.priceTarget.prov} />}
        </div>
        {a.priceTarget ? (
          <div className="stat-grid">
            <div className="stat"><span className="xs muted">Medio</span><span className="num">{fmtPrice(a.priceTarget.value.mean)}</span></div>
            <div className="stat"><span className="xs muted">Massimo</span><span className="num">{fmtPrice(a.priceTarget.value.high)}</span></div>
            <div className="stat"><span className="xs muted">Minimo</span><span className="num">{fmtPrice(a.priceTarget.value.low)}</span></div>
          </div>
        ) : (
          <p className="small muted">Non disponibile.</p>
        )}
      </section>
      {a.unavailable.length > 0 && (
        <Callout>
          {a.unavailable.join(' ')} PFI non simula né stima il consenso degli analisti.
        </Callout>
      )}
    </div>
  );
}

function RisksTab({ c }: { c: CompanyState }) {
  const d = c.data!;
  const m = yearMetrics(d.statements);
  const an = findAnomalies(m);
  const perf = pricePerformance(mergedPrices(c));
  const snaps = useLiveQuery(() => db.company_snapshots.where('symbol').equals(d.symbol).reverse().sortBy('createdAt'), [d.symbol]);
  const report = (snaps?.[0]?.payload as { report?: { sections: Array<{ title: string; claims?: Array<{ text: string; type: string }> }> } } | undefined)?.report;
  const swot = report?.sections[11]?.claims ?? [];
  const risks = report?.sections[10]?.claims ?? [];
  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <h2>Segnali dai bilanci</h2>
          <span className="hint">regole fisse di PFI</span>
        </div>
        {an.length ? (
          <ul className="plain-list">
            {an.map((a, i) => (
              <li key={i} className={`small sev-${a.severity}`}>
                <span className="num muted">{a.fiscalYear}</span> {a.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">{d.statements.length ? 'Nessuna anomalia rilevata.' : 'Bilanci non disponibili.'}</p>
        )}
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Rischio di mercato</h2>
        </div>
        <div className="stat-grid">
          <div className="stat"><span className="xs muted">Massimo drawdown 12 mesi</span><span className="num">{fmtPct(perf.maxDrawdown)}</span></div>
          <div className="stat"><span className="xs muted">Beta</span><span className="num">{fmtNum(d.ratios.beta?.value)}</span>{d.ratios.beta && <SourceTag prov={d.ratios.beta.prov} compact />}</div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Rischi qualitativi e SWOT</h2>
          {snaps?.[0] && <span className="hint">dall'ultimo report AI ({new Date(snaps[0].createdAt).toLocaleDateString('it-IT')})</span>}
        </div>
        {swot.length || risks.length ? (
          <ClaimList claims={[...risks, ...swot]} />
        ) : (
          <p className="small muted">
            Genera il <a href={`#/research?symbol=${d.symbol}&tab=report`}>report AI</a> per un'analisi qualitativa che separa fatti, interpretazioni e ipotesi.
          </p>
        )}
      </section>
    </div>
  );
}

export function ClaimList({ claims }: { claims: Array<{ text: string; type: string }> }) {
  return (
    <ul className="plain-list claims">
      {claims.map((c, i) => (
        <li key={i} className="small">
          <span className={`claim claim-${c.type}`}>{c.type}</span> {c.text}
        </li>
      ))}
    </ul>
  );
}
