import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, Database, RefreshCw, Target } from 'lucide-react';
import { COST_BASIS_KEY, DEFAULT_RISK, EMERGENCY_MONTHS_KEY, RISK_PROFILE_KEY, useSetting, type RiskProfile } from '../../hooks/useSetting';
import { useToast } from '../../hooks/useToast';
import { clearResearchCache, researchStatus, type BridgeResearchStatus } from '../../services/research/bridge';

/** Fondo di emergenza, profilo di rischio, investimenti al costo. */
export function PlanningSettings() {
  const toast = useToast();
  const [months, setMonths] = useSetting<number>(EMERGENCY_MONTHS_KEY, 6);
  const [costBasis, setCostBasis] = useSetting<boolean>(COST_BASIS_KEY, true);
  const [risk, setRisk] = useSetting<RiskProfile>(RISK_PROFILE_KEY, DEFAULT_RISK);
  const [draft, setDraft] = useState({ months: String(months), horizon: String(risk.horizonYears), max: String(Math.round(risk.maxSinglePosition * 100)), tolerance: risk.tolerance });
  useEffect(() => setDraft({ months: String(months), horizon: String(risk.horizonYears), max: String(Math.round(risk.maxSinglePosition * 100)), tolerance: risk.tolerance }), [months, risk]);

  const save = async () => {
    const m = Number(draft.months);
    const h = Number(draft.horizon);
    const mx = Number(draft.max);
    if (!(m >= 1 && m <= 36)) return toast.error(new Error('I mesi del fondo di emergenza vanno da 1 a 36.'));
    if (!(h >= 1 && h <= 60)) return toast.error(new Error("L'orizzonte va da 1 a 60 anni."));
    if (!(mx >= 1 && mx <= 100)) return toast.error(new Error('La quota massima per titolo va da 1% a 100%.'));
    await setMonths(Math.round(m));
    await setRisk({ horizonYears: Math.round(h), tolerance: draft.tolerance, maxSinglePosition: mx / 100 });
    toast.success('Pianificazione salvata.');
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>
          <Target size={16} style={{ verticalAlign: -3, marginRight: 8 }} />
          Pianificazione e profilo di rischio
        </h2>
      </div>
      <div className="stack" style={{ gap: 12 }}>
        <div className="form-row">
          <div className="field">
            <label htmlFor="em-months">Fondo di emergenza (mesi di spesa)</label>
            <input id="em-months" className="input" inputMode="numeric" value={draft.months} onChange={(e) => setDraft({ ...draft, months: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="risk-h">Orizzonte di investimento (anni)</label>
            <input id="risk-h" className="input" inputMode="numeric" value={draft.horizon} onChange={(e) => setDraft({ ...draft, horizon: e.target.value })} />
          </div>
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="risk-t">Tolleranza al rischio</label>
            <select id="risk-t" className="select" value={draft.tolerance} onChange={(e) => setDraft({ ...draft, tolerance: e.target.value as RiskProfile['tolerance'] })}>
              <option value="bassa">Bassa</option>
              <option value="media">Media</option>
              <option value="alta">Alta</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="risk-max">Quota massima in un singolo titolo (%)</label>
            <input id="risk-max" className="input" inputMode="numeric" value={draft.max} onChange={(e) => setDraft({ ...draft, max: e.target.value })} />
          </div>
        </div>
        <p className="xs muted">Il profilo serve solo al simulatore per segnalare impatti fuori dai limiti che hai scelto: non è una profilazione MiFID e non genera consigli.</p>
        <label className="check">
          <input type="checkbox" checked={costBasis} onChange={(e) => void setCostBasis(e.target.checked)} />
          <span>
            Conta nel patrimonio i titoli acquistati dai conti (categoria "Acquisto investimenti"), al costo.
            <span className="xs muted" style={{ display: 'block' }}>Disattivalo se inserisci gli stessi titoli anche in Investimenti, per non contarli due volte.</span>
          </span>
        </label>
        <div className="actions">
          <button className="btn btn-primary" onClick={save}>
            Salva pianificazione
          </button>
        </div>
      </div>
    </section>
  );
}

const PROVIDER_LABEL: Record<string, string> = { sec: 'SEC EDGAR', alphavantage: 'Alpha Vantage', finnhub: 'Finnhub', tiingo: 'Tiingo' };

/** Stato delle fonti di dati di mercato configurate nel bridge (le chiavi restano nel bridge). */
export function ResearchSettings() {
  const toast = useToast();
  const [st, setSt] = useState<BridgeResearchStatus | null | 'loading'>('loading');
  const load = async () => {
    setSt('loading');
    setSt(await researchStatus());
  };
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="panel" data-testid="research-settings">
      <div className="panel-head">
        <h2>
          <Database size={16} style={{ verticalAlign: -3, marginRight: 8 }} />
          Fonti dati di mercato
        </h2>
        <button className="btn btn-ghost btn-sm" onClick={() => void load()}>
          <RefreshCw size={14} /> Verifica
        </button>
      </div>
      <p className="small muted" style={{ marginBottom: 10 }}>
        Investment Research è facoltativo e separato dalla finanza personale: usa il bridge locale per scaricare dati pubblici sulle aziende. Ai fornitori arrivano solo i simboli che cerchi, mai i tuoi dati. Le chiavi si inseriscono nella sezione <code>research</code> di <code>bridge/config.json</code>, mai nell'app.
      </p>
      {st === 'loading' ? (
        <p className="small muted">Verifica in corso…</p>
      ) : st === null ? (
        <p className="small">Bridge non raggiungibile: avvialo con <code>npm run bridge</code>. Senza bridge la finanza personale funziona normalmente.</p>
      ) : (
        <ul className="plain-list">
          {Object.entries(st.providers).map(([id, p]) => (
            <li key={id} className="provider-row">
              {p.configured ? <CheckCircle2 size={15} className="pos" /> : <Circle size={15} className="muted" />}
              <div>
                <strong>{PROVIDER_LABEL[id] ?? id}</strong> <span className="xs muted">{p.configured ? 'configurato' : `manca ${p.needs}`}</span>
                <div className="xs muted">{p.coverage}{p.usedToday !== undefined && p.configured ? ` · richieste oggi (da quando il bridge è avviato): ${p.usedToday}/25` : ''}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="actions" style={{ marginTop: 10 }}>
        <button
          className="btn btn-sm"
          onClick={async () => {
            const n = await clearResearchCache();
            toast.success(`Cache dei dati di mercato svuotata (${n} risposte).`);
          }}
        >
          Svuota cache dati di mercato
        </button>
      </div>
    </section>
  );
}
