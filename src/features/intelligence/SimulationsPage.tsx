import { useMemo, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { useFinanceModel } from '../../hooks/useFinanceModel';
import { DEFAULT_RISK, RISK_PROFILE_KEY, useSetting, type RiskProfile } from '../../hooks/useSetting';
import { assetValue, FINANCIAL_ASSET_TYPES } from '../../services/finance';
import { simulateInvestment } from '../../services/simulation';
import { formatMoney, formatPercent } from '../../utils/money';
import { normalizeText } from '../../utils/text';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { AiButton } from '../../components/ai/AiPanel';
import { useAiPage } from '../../components/ai/AiProvider';
import { Callout, PageSkeleton } from '../../components/ui/States';
import { useRoute } from '../../hooks/useRoute';

export function SimulationsPage() {
  const model = useFinanceModel();
  const route = useRoute();
  const [risk] = useSetting<RiskProfile>(RISK_PROFILE_KEY, DEFAULT_RISK);
  const [amount, setAmount] = useState<number | null>(route.params.get('amount') ? Number(route.params.get('amount')) : null);
  const [name, setName] = useState(route.params.get('symbol') ?? '');

  const result = useMemo(() => {
    if (!model || amount === null) return null;
    const conv = model.conv;
    const q = normalizeText(name);
    const existing = q ? model.ds.assets.filter((a) => FINANCIAL_ASSET_TYPES.includes(a.type) && normalizeText(a.name).includes(q)).reduce((s, a) => s + conv(assetValue(a), a.currency), 0) : 0;
    const physical = model.ds.assets.filter((a) => !FINANCIAL_ASSET_TYPES.includes(a.type)).reduce((s, a) => s + conv(assetValue(a), a.currency), 0);
    return {
      existing,
      r: simulateInvestment({
        amount,
        netWorth: model.kpis.kpis.netWorth.value ?? 0,
        liquidity: model.kpis.kpis.liquidity.value ?? 0,
        investments: model.kpis.kpis.investments.value ?? 0,
        physical,
        avgMonthlyExpense: model.kpis.avgMonthlyExpense,
        existingPosition: existing,
        emergencyTargetMonths: model.emergencyMonths,
        maxSinglePosition: risk.maxSinglePosition,
        horizonYears: risk.horizonYears,
        tolerance: risk.tolerance,
      }),
    };
  }, [model, amount, name, risk]);

  const cur = model?.ds.settings.baseCurrency ?? 'EUR';
  const focus = result
    ? [
        `Simulazione: investire ${formatMoney(amount ?? 0, cur)}${name ? ` in ${name}` : ''}`,
        `Quota del patrimonio netto: ${formatPercent(result.r.shareOfNetWorth)}`,
        `Liquidità dopo: ${formatMoney(result.r.liquidityAfter, cur)}`,
        `Fondo di emergenza: da ${result.r.coverageBefore?.toFixed(1) ?? '—'} a ${result.r.coverageAfter?.toFixed(1) ?? '—'} mesi (obiettivo ${model?.emergencyMonths})`,
        `Concentrazione nel titolo dopo: ${formatPercent(result.r.concentrationAfter)} (limite scelto ${formatPercent(risk.maxSinglePosition, 0)})`,
        `Avvisi: ${result.r.warnings.join(' | ') || 'nessuno'}`,
        `Profilo: orizzonte ${risk.horizonYears} anni, tolleranza ${risk.tolerance}`,
      ].join('\n')
    : '';
  useAiPage(result ? { section: 'simulations', label: 'Simulazione di investimento', blocks: () => [{ title: 'SIMULAZIONE', body: focus }] } : null, [focus]);

  if (!model) return <PageSkeleton />;
  const a = result?.r;
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Analisi e simulazioni</h1>
          <p>Cosa succederebbe alla tua situazione se investissi una certa cifra. Solo informativo: PFI non è un consulente finanziario abilitato e non promette rendimenti.</p>
        </div>
      </div>
      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head">
          <h2>
            <FlaskConical size={16} style={{ verticalAlign: -3, marginRight: 8 }} />
            Simulatore di investimento
          </h2>
          <a className="hint" href="#/settings">
            Profilo: {risk.horizonYears} anni · rischio {risk.tolerance} · max {formatPercent(risk.maxSinglePosition, 0)} per titolo
          </a>
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="sim-amount">Importo da investire</label>
            <MoneyInput id="sim-amount" value={amount} onChange={setAmount} currency={cur} />
          </div>
          <div className="field">
            <label htmlFor="sim-name">Titolo (facoltativo, per la concentrazione)</label>
            <input id="sim-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Es. AAPL o nome dell'asset" />
            {result && result.existing > 0 && <span className="help">Già detenuto: {formatMoney(result.existing, cur)}</span>}
          </div>
        </div>
      </section>
      {a && (
        <section className="panel" data-testid="simulation-result">
          <div className="panel-head">
            <h2>Impatto sulla tua situazione</h2>
            <AiButton prompt="Spiegami l'impatto di questa simulazione sulla mia situazione" focus={focus} />
          </div>
          <div className="grid grid-4">
            <div><span className="xs muted">Quota del patrimonio netto</span><div className="num fc-big">{formatPercent(a.shareOfNetWorth)}</div></div>
            <div><span className="xs muted">Liquidità residua</span><div className={`num fc-big ${a.liquidityAfter < 0 ? 'neg' : ''}`}>{formatMoney(a.liquidityAfter, cur)}</div></div>
            <div><span className="xs muted">Fondo di emergenza</span><div className="num fc-big">{a.coverageBefore === null ? '—' : `${a.coverageBefore.toFixed(1)} → ${a.coverageAfter?.toFixed(1)} mesi`}</div></div>
            <div><span className="xs muted">Concentrazione nel titolo</span><div className="num fc-big">{formatPercent(a.concentrationAfter)}</div></div>
          </div>
          {a.allocationBefore && a.allocationAfter && (
            <table className="table compact" style={{ marginTop: 14 }}>
              <thead><tr><th>Allocazione</th><th className="right">Prima</th><th className="right">Dopo</th></tr></thead>
              <tbody>
                <tr><td>Liquidità</td><td className="right num">{formatPercent(a.allocationBefore.liquidity)}</td><td className="right num">{formatPercent(a.allocationAfter.liquidity)}</td></tr>
                <tr><td>Investimenti</td><td className="right num">{formatPercent(a.allocationBefore.investments)}</td><td className="right num">{formatPercent(a.allocationAfter.investments)}</td></tr>
                <tr><td>Beni fisici e altro</td><td className="right num">{formatPercent(a.allocationBefore.other)}</td><td className="right num">{formatPercent(a.allocationAfter.other)}</td></tr>
              </tbody>
            </table>
          )}
          <div className="stack" style={{ marginTop: 14, gap: 8 }}>
            {a.warnings.map((w) => <Callout key={w} kind="warning">{w}</Callout>)}
            {a.warnings.length === 0 && <Callout>Nessun limite del tuo profilo superato. Questo non significa che l'investimento sia adatto o conveniente.</Callout>}
          </div>
        </section>
      )}
    </div>
  );
}
