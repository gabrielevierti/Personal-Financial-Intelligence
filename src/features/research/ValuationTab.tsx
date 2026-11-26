import { useEffect, useMemo, useState } from 'react';
import { comparablesValue, dcf, dcfSensitivity, ddm, historicalPe, multiples, validateDcf, yearMetrics, type DcfInputs } from '../../services/research/metrics';
import { baseAssumptions, buildScenarios, fairValueRange } from '../../services/research/scenarios';
import { SourceTag } from '../../components/finance/Provenance';
import { AiButton } from '../../components/ai/AiPanel';
import { Callout } from '../../components/ui/States';
import { fmtBig, fmtNum, fmtPct, fmtPrice, fmtX, pctClass } from './format';
import { mergedPrices } from './CompanyView';
import type { CompanyState } from './useCompany';

/** Campo percentuale: l'utente scrive "9" per 9%. */
function PctField({ id, label, value, onChange, help }: { id: string; label: string; value: number; onChange: (v: number) => void; help?: string }) {
  const [t, setT] = useState((value * 100).toFixed(1).replace('.', ','));
  useEffect(() => setT((value * 100).toFixed(1).replace('.', ',')), [value]);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input input-money"
        inputMode="decimal"
        value={t}
        onChange={(e) => {
          setT(e.target.value);
          const n = Number(e.target.value.replace(',', '.'));
          if (Number.isFinite(n)) onChange(n / 100);
        }}
      />
      {help && <span className="help">{help}</span>}
    </div>
  );
}

export function ValuationTab({ c }: { c: CompanyState }) {
  const d = c.data!;
  const years = d.statements;
  const m = useMemo(() => yearMetrics(years), [years]);
  const prices = useMemo(() => mergedPrices(c), [c]);
  const y0 = years[0];
  const price = d.quote?.price ?? (prices.length ? prices[prices.length - 1].close : null);
  const shares = d.profile?.sharesOutstanding?.value ?? y0?.sharesDiluted ?? null;
  const mult = multiples({ price, shares, marketCap: d.profile?.marketCap?.value ?? null }, y0);
  const base = useMemo(() => baseAssumptions(years, m, shares), [years, m, shares]);
  const [inp, setInp] = useState<DcfInputs | null>(base?.inputs ?? null);
  useEffect(() => setInp(base?.inputs ?? null), [base]);
  const [ddmR, setDdmR] = useState(0.08);
  const [ddmG, setDdmG] = useState(0.03);
  const [peerPe, setPeerPe] = useState('');
  const [peerEv, setPeerEv] = useState('');
  const priceCur = d.profile?.currency ?? y0?.currency;
  const stmtCur = y0?.currency;
  const curMismatch = priceCur && stmtCur && priceCur !== stmtCur;

  if (!y0 || !base || !inp) return <Callout>Servono i bilanci (con ricavi positivi) per la valutazione.</Callout>;
  const errors = validateDcf(inp);
  const r = dcf(inp);
  const sens = r ? dcfSensitivity(inp) : [];
  const scenarios = buildScenarios(inp, price);
  const range = fairValueRange(scenarios);
  const dps = m[0].dividendsPerShare;
  const ddmValue = ddm(dps, ddmR, ddmG);
  const nums = (s: string) => s.split(/[;\s]+/).map((x) => Number(x.replace(',', '.'))).filter((x) => Number.isFinite(x) && x > 0);
  const eps = y0.epsDiluted ?? (y0.netIncome !== null && shares ? y0.netIncome / shares : null);
  const comps = comparablesValue(nums(peerPe), eps, nums(peerEv), m[0].ebitda, m[0].netDebt, shares);
  const hpe = historicalPe(years.slice(0, 8), prices);
  const set = (k: keyof DcfInputs) => (v: number) => setInp({ ...inp, [k]: v });
  const ratio = (label: string, v: string, src?: Parameters<typeof SourceTag>[0]['prov']) => (
    <div className="stat">
      <span className="xs muted">{label}</span>
      <span className="num">{v}</span>
      {src && <SourceTag prov={src} compact />}
    </div>
  );
  const focus = [
    `Prezzo ${fmtPrice(price, priceCur)}; multipli calcolati: P/E ${fmtX(mult.pe)}, EV/EBITDA ${fmtX(mult.evEbitda)}, P/B ${fmtX(mult.pb)}, FCF yield ${fmtPct(mult.fcfYield)}`,
    `DCF (ipotesi utente): crescita ${fmtPct(inp.revenueGrowth)}, margine ${fmtPct(inp.operatingMargin)}, tasse ${fmtPct(inp.taxRate)}, reinvestimento ${fmtPct(inp.reinvestmentRate)}, WACC ${fmtPct(inp.wacc)}, g ${fmtPct(inp.terminalGrowth)}, ${inp.years} anni → ${r ? fmtPrice(r.perShare, stmtCur) : 'non calcolabile'} per azione; peso del valore terminale ${r ? fmtPct(r.terminalShare) : 'n.d.'}`,
    `Scenari: ${scenarios.map((s) => `${s.id} ${fmtPrice(s.fairValue, stmtCur)} (${fmtPct(s.upside, 0, true)})`).join('; ')}`,
  ].join('\n');

  return (
    <div className="stack">
      {curMismatch && <Callout kind="warning">Prezzo in {priceCur}, bilanci in {stmtCur}: multipli e fair value confrontano valute diverse. Usali con cautela.</Callout>}
      <section className="panel">
        <div className="panel-head">
          <h2>Multipli e redditività</h2>
          <AiButton prompt="Commenta la valutazione di questa azienda" focus={focus} />
        </div>
        <div className="stat-grid">
          {ratio('P/E', fmtX(mult.pe))}
          {ratio('P/S', fmtX(mult.ps))}
          {ratio('P/B', fmtX(mult.pb))}
          {ratio('EV/EBITDA', fmtX(mult.evEbitda))}
          {ratio('EV/Ricavi', fmtX(mult.evSales))}
          {ratio('FCF yield', fmtPct(mult.fcfYield))}
          {ratio('Dividend yield', fmtPct(mult.dividendYield))}
          {ratio('ROE', fmtPct(m[0].roe))}
          {ratio('ROA', fmtPct(m[0].roa))}
          {ratio('ROIC', fmtPct(m[0].roic))}
          {ratio('Margine operativo', fmtPct(m[0].operatingMargin))}
          {ratio('Margine netto', fmtPct(m[0].netMargin))}
        </div>
        <p className="xs muted" style={{ marginTop: 8 }}>Calcolati da PFI con il prezzo attuale e l'ultimo esercizio ({y0.periodEnd}). {d.ratios.pe && `P/E secondo ${d.ratios.pe.prov.source}: ${fmtX(d.ratios.pe.value)} (${d.ratios.pe.prov.period ?? 'TTM'}): può differire perché usa gli ultimi 12 mesi.`}</p>
      </section>

      <section className="panel" data-testid="dcf">
        <div className="panel-head">
          <h2>DCF modificabile</h2>
          <button className="btn btn-ghost btn-sm" onClick={() => setInp(base.inputs)}>
            Ripristina ipotesi
          </button>
        </div>
        <div className="form-grid-4">
          <PctField id="dcf-g" label="Crescita ricavi annua" value={inp.revenueGrowth} onChange={set('revenueGrowth')} />
          <PctField id="dcf-m" label="Margine operativo" value={inp.operatingMargin} onChange={set('operatingMargin')} />
          <PctField id="dcf-t" label="Aliquota fiscale" value={inp.taxRate} onChange={set('taxRate')} />
          <PctField id="dcf-r" label="Reinvestimento del NOPAT" value={inp.reinvestmentRate} onChange={set('reinvestmentRate')} />
          <PctField id="dcf-w" label="WACC" value={inp.wacc} onChange={set('wacc')} help="Ipotesi, non calcolata dai dati" />
          <PctField id="dcf-tg" label="Crescita terminale" value={inp.terminalGrowth} onChange={set('terminalGrowth')} />
          <div className="field">
            <label htmlFor="dcf-y">Anni di previsione</label>
            <input id="dcf-y" className="input" inputMode="numeric" value={inp.years} onChange={(e) => setInp({ ...inp, years: Math.round(Number(e.target.value) || 0) })} />
          </div>
          <div className="field">
            <span className="xs muted">Debito netto · azioni</span>
            <span className="num small">
              {fmtBig(inp.netDebt, stmtCur)} · {fmtBig(inp.shares)}
            </span>
          </div>
        </div>
        <ul className="xs muted assumption-notes">
          {base.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
        {errors.length > 0 && <Callout kind="warning">{errors.join(' ')}</Callout>}
        {r && (
          <>
            <div className="stat-grid" style={{ marginTop: 10 }}>
              <div className="stat"><span className="xs muted">Valore per azione</span><span className="num fc-big" data-testid="dcf-value">{fmtPrice(r.perShare, stmtCur)}</span></div>
              <div className="stat"><span className="xs muted">Rispetto al prezzo</span><span className={`num fc-big ${pctClass(price ? r.perShare / price - 1 : null)}`}>{price ? fmtPct(r.perShare / price - 1, 0, true) : '—'}</span></div>
              <div className="stat"><span className="xs muted">Enterprise value</span><span className="num">{fmtBig(r.enterpriseValue, stmtCur)}</span></div>
              <div className="stat"><span className="xs muted">Peso del valore terminale</span><span className="num">{fmtPct(r.terminalShare, 0)}</span></div>
            </div>
            <details style={{ marginTop: 10 }}>
              <summary className="small">Flussi anno per anno e sensibilità</summary>
              <div className="grid grid-2" style={{ marginTop: 8 }}>
                <table className="table compact">
                  <thead><tr><th>Anno</th><th className="right">Ricavi</th><th className="right">FCFF</th><th className="right">Valore attuale</th></tr></thead>
                  <tbody>
                    {r.rows.map((x) => <tr key={x.year}><td>{x.year}</td><td className="right num">{fmtBig(x.revenue)}</td><td className="right num">{fmtBig(x.fcff)}</td><td className="right num">{fmtBig(x.pv)}</td></tr>)}
                    <tr><td>Terminale</td><td /><td className="right num">{fmtBig(r.terminalValue)}</td><td className="right num">{fmtBig(r.pvTerminal)}</td></tr>
                  </tbody>
                </table>
                <table className="table compact">
                  <thead><tr><th>WACC \ g</th>{[...new Set(sens.map((s) => s.g))].map((g) => <th key={g} className="right">{fmtPct(g)}</th>)}</tr></thead>
                  <tbody>
                    {[...new Set(sens.map((s) => s.wacc))].map((w) => (
                      <tr key={w}><th scope="row">{fmtPct(w)}</th>{sens.filter((s) => s.wacc === w).map((s) => <td key={s.g} className="right num">{fmtPrice(s.perShare)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </section>

      <section className="panel" data-testid="scenarios">
        <div className="panel-head">
          <h2>Scenari e intervallo di fair value</h2>
        </div>
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>Scenario</th><th>Regole applicate alle ipotesi</th><th className="right">Fair value</th><th className="right">vs prezzo</th><th>Rischi</th></tr></thead>
            <tbody>
              {scenarios.map((s) => (
                <tr key={s.id}>
                  <td className="cap">{s.id}<div className="xs muted">{s.horizonYears} anni</div></td>
                  <td className="xs">{s.rules.join('; ')}<div className="muted">crescita {fmtPct(s.inputs.revenueGrowth)}, margine {fmtPct(s.inputs.operatingMargin)}, WACC {fmtPct(s.inputs.wacc)}, g {fmtPct(s.inputs.terminalGrowth)}</div></td>
                  <td className="right num">{fmtPrice(s.fairValue, stmtCur)}</td>
                  <td className={`right num ${pctClass(s.upside)}`}>{fmtPct(s.upside, 0, true)}</td>
                  <td className="xs muted">{s.risks.join('; ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {range && (
          <p className="small" style={{ marginTop: 8 }}>
            Intervallo: <strong className="num">{fmtPrice(range.low, stmtCur)} – {fmtPrice(range.high, stmtCur)}</strong>. Non è un valore oggettivo: cambia con le ipotesi. Nessuna probabilità è assegnata agli scenari.
          </p>
        )}
      </section>

      <div className="grid grid-2">
        <section className="panel">
          <div className="panel-head"><h2>Modello a dividendi (DDM)</h2></div>
          {dps ? (
            <>
              <p className="small muted">Dividendo per azione dell'ultimo esercizio: <span className="num">{fmtNum(dps)}</span> {stmtCur}</p>
              <div className="form-row">
                <PctField id="ddm-r" label="Rendimento richiesto" value={ddmR} onChange={setDdmR} />
                <PctField id="ddm-g" label="Crescita del dividendo" value={ddmG} onChange={setDdmG} />
              </div>
              <p className="small">Valore: <strong className="num">{ddmValue === null ? 'non calcolabile (il rendimento richiesto deve superare la crescita)' : fmtPrice(ddmValue, stmtCur)}</strong></p>
            </>
          ) : (
            <p className="small muted">L'azienda non risulta pagare dividendi nell'ultimo esercizio: il DDM non si applica.</p>
          )}
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Comparabili</h2><a className="hint" href="#/compare">Confronta aziende</a></div>
          <p className="xs muted">Inserisci i multipli delle aziende che consideri comparabili (separati da spazio o punto e virgola). PFI usa la mediana.</p>
          <div className="form-row">
            <div className="field"><label htmlFor="peer-pe">P/E dei comparabili</label><input id="peer-pe" className="input" value={peerPe} onChange={(e) => setPeerPe(e.target.value)} placeholder="Es. 18 22 25" /></div>
            <div className="field"><label htmlFor="peer-ev">EV/EBITDA dei comparabili</label><input id="peer-ev" className="input" value={peerEv} onChange={(e) => setPeerEv(e.target.value)} placeholder="Es. 12 14" /></div>
          </div>
          <p className="small">Da P/E mediano {fmtX(comps.medianPe)}: <strong className="num">{fmtPrice(comps.byPe, stmtCur)}</strong> · da EV/EBITDA mediano {fmtX(comps.medianEvEbitda)}: <strong className="num">{fmtPrice(comps.byEvEbitda, stmtCur)}</strong></p>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head"><h2>Valutazione storica (P/E a fine esercizio)</h2></div>
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>Esercizio</th><th className="right">Prezzo a fine esercizio</th><th className="right">EPS</th><th className="right">P/E</th></tr></thead>
            <tbody>
              {hpe.map((h) => <tr key={h.fiscalYear}><td>{h.fiscalYear}</td><td className="right num">{fmtPrice(h.price)}</td><td className="right num">{fmtNum(h.eps)}</td><td className="right num">{fmtX(h.pe)}</td></tr>)}
            </tbody>
          </table>
        </div>
        <p className="xs muted" style={{ marginTop: 6 }}>Prezzo dallo storico disponibile (vuoto se lo storico non copre quella data). Prezzi non rettificati per eventuali frazionamenti possono rendere il P/E storico non confrontabile.</p>
      </section>
    </div>
  );
}
