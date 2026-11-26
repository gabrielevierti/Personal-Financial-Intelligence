import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download, FileText, Save, Sparkles, Square } from 'lucide-react';
import { db } from '../../database/db';
import { useToast } from '../../hooks/useToast';
import { AiClient, getAiSettings } from '../../services/ai/client';
import { AI_TIMEOUT_MS } from '../../services/ai/context';
import { yearMetrics } from '../../services/research/metrics';
import { addAiNarrative, buildReport, exportReportPdf, saveSnapshot, type CompanyReport } from '../../services/research/report';
import { baseAssumptions } from '../../services/research/scenarios';
import { Callout } from '../../components/ui/States';
import { ClaimList, mergedPrices } from './CompanyView';
import { fmtPct, fmtPrice, pctClass } from './format';
import type { CompanyState } from './useCompany';

export function ReportTab({ c }: { c: CompanyState }) {
  const d = c.data!;
  const toast = useToast();
  const [report, setReport] = useState<CompanyReport | null>(null);
  const [busy, setBusy] = useState<'ai' | null>(null);
  const abort = useRef<AbortController | null>(null);
  const prices = useMemo(() => mergedPrices(c), [c]);
  const snaps = useLiveQuery(() => db.company_snapshots.where('symbol').equals(d.symbol).reverse().sortBy('createdAt'), [d.symbol]);
  const shares = d.profile?.sharesOutstanding?.value ?? d.statements[0]?.sharesDiluted ?? null;
  const base = useMemo(() => baseAssumptions(d.statements, yearMetrics(d.statements), shares), [d.statements, shares]);

  const generate = async (withAi: boolean) => {
    if (!base) return;
    const r = buildReport(d, prices, base.inputs, base.notes);
    setReport(r);
    if (!withAi) return;
    setBusy('ai');
    const ac = new AbortController();
    abort.current = ac;
    const t = window.setTimeout(() => ac.abort(), AI_TIMEOUT_MS * 2);
    try {
      const client = new AiClient(await getAiSettings());
      setReport(await addAiNarrative(r, client, d.profile?.description, ac.signal));
    } catch (e) {
      setReport({ ...r, ai: { generated: false, error: (e as Error).name === 'AbortError' ? 'Generazione interrotta.' : (e as Error).message } });
    } finally {
      window.clearTimeout(t);
      setBusy(null);
    }
  };

  if (!base) return <Callout>Servono i bilanci per generare il report.</Callout>;
  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <h2>
            <FileText size={16} style={{ verticalAlign: -3, marginRight: 8 }} />
            Company Intelligence
          </h2>
        </div>
        <p className="small muted">Tredici sezioni. Numeri, metriche e scenari li calcola PFI dai dati delle fonti; il modello locale aggiunge solo i commenti, marcando ogni affermazione come fatto, interpretazione o ipotesi. Solo informativo: non è una raccomandazione di investimento.</p>
        <div className="actions" style={{ marginTop: 10 }}>
          <button className="btn btn-primary" onClick={() => void generate(true)} disabled={!!busy} data-testid="report-generate">
            <Sparkles size={15} /> Genera report con AI locale
          </button>
          <button className="btn" onClick={() => void generate(false)} disabled={!!busy}>
            Solo dati e calcoli
          </button>
          {busy && (
            <button className="btn btn-ghost" onClick={() => abort.current?.abort()}>
              <Square size={14} /> Interrompi
            </button>
          )}
          {report && !busy && (
            <>
              <button
                className="btn"
                onClick={async () => {
                  await saveSnapshot(report, { statements: d.statements, prices: prices.length });
                  toast.success('Istantanea salvata: dati, fonti e ipotesi di oggi.');
                }}
                data-testid="report-save"
              >
                <Save size={15} /> Salva istantanea
              </button>
              <button className="btn" onClick={() => void exportReportPdf(report)}>
                <Download size={15} /> Esporta PDF
              </button>
            </>
          )}
        </div>
        {busy && <p className="small muted" style={{ marginTop: 8 }}>Il modello locale sta scrivendo i commenti…</p>}
      </section>
      {report && <ReportView r={report} />}
      {snaps && snaps.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>Istantanee salvate</h2>
          </div>
          <ul className="plain-list">
            {snaps.map((s) => (
              <li key={s.id} className="row-between small">
                <button className="link-btn" onClick={() => setReport((s.payload as { report: CompanyReport }).report)}>
                  {new Date(s.createdAt).toLocaleString('it-IT')}
                </button>
                <span className="xs muted">{s.sources.join(' · ')}</span>
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={async () => {
                    await db.company_snapshots.delete(s.id);
                    toast.success('Istantanea eliminata.');
                  }}
                >
                  Elimina
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ReportView({ r }: { r: CompanyReport }) {
  return (
    <article className="panel report" data-testid="report">
      <header className="report-head">
        <h2>
          {r.name} <span className="muted num">{r.symbol}</span>
        </h2>
        <p className="xs muted">
          Generato il {new Date(r.createdAt).toLocaleString('it-IT')} · prezzo {fmtPrice(r.price)} {r.priceAsOf && `al ${r.priceAsOf}`} · fonti: {r.sources.join('; ') || 'n.d.'} · {r.ai.generated ? `commenti del modello locale ${r.ai.model}` : 'commenti AI non generati'}
        </p>
        {r.ai.error && <Callout kind="warning">AI: {r.ai.error} Il report contiene comunque tutti i dati e i calcoli.</Callout>}
      </header>
      {r.sections.map((s, i) => (
        <section key={s.id} className="report-sec">
          <h3>
            <span className="muted num">{i + 1}.</span> {s.title}
          </h3>
          {s.facts.length > 0 && (
            <table className="table compact">
              <tbody>
                {s.facts.map((f, j) => (
                  <tr key={j}>
                    <th scope="row">{f.label}</th>
                    <td className="num">{f.value}</td>
                    <td className="xs muted">{f.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {i === 8 && (
            <div className="scenario-cards">
              {r.scenarios.map((sc) => (
                <div key={sc.id} className="scenario">
                  <strong className="cap">{sc.id}</strong>
                  <span className="num fc-big">{fmtPrice(sc.fairValue, r.currency)}</span>
                  <span className={`num small ${pctClass(sc.upside)}`}>{fmtPct(sc.upside, 0, true)} vs prezzo</span>
                  <span className="xs muted">Orizzonte {sc.horizonYears} anni · {sc.rules.join('; ')}</span>
                  <span className="xs">Rischi: {sc.risks.join('; ')}</span>
                </div>
              ))}
            </div>
          )}
          {i === 8 && <ul className="xs muted assumption-notes">{r.assumptionNotes.map((n) => <li key={n}>{n}</li>)}</ul>}
          {s.narrative && <p className="small report-narr">{s.narrative}</p>}
          {s.claims && s.claims.length > 0 && <ClaimList claims={s.claims} />}
        </section>
      ))}
    </article>
  );
}
