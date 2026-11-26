import { ChevronRight } from 'lucide-react';
import { useFinanceModel, type FinanceModel } from '../../hooks/useFinanceModel';
import type { MonthEndForecast, Projection } from '../../services/forecast';
import type { FinancialInsight } from '../../services/financialInsights';
import { formatDate, formatMonth } from '../../utils/date';
import { formatMoney, formatPercent } from '../../utils/money';
import { AiButton } from '../../components/ai/AiPanel';
import { useAiPage } from '../../components/ai/AiProvider';
import { Skeleton, Tip } from '../../components/ui/States';

export const KPI_DEFS = {
  netWorth: { label: 'Patrimonio netto', tip: 'Tutto ciò che possiedi (conti, investimenti, beni fisici) meno i debiti.', href: '#/networth' },
  liquidity: { label: 'Liquidità', tip: 'Saldi positivi di conti correnti, depositi, contanti e carte di debito. Esclusi investimenti e beni.', href: '#/accounts' },
  investments: { label: 'Capitale investito', tip: 'Conti investimento, asset finanziari e titoli acquistati dai conti (al costo).', href: '#/investments' },
  income: { label: 'Entrate', tip: 'Entrate del periodo. Esclusi i trasferimenti tra i tuoi conti e le vendite di titoli.', href: '#/transactions?type=income' },
  expense: { label: 'Uscite (spese reali)', tip: 'Spese del periodo. Esclusi i trasferimenti tra i tuoi conti e gli acquisti di titoli: quelli non sono soldi spesi.', href: '#/transactions?type=expense' },
  net: { label: 'Risparmio netto', tip: 'Entrate meno uscite del periodo.', href: '#/reports' },
  savingsRate: { label: 'Tasso di risparmio', tip: 'Quota delle entrate del periodo che non è stata spesa.', href: '#/reports' },
  autonomy: { label: 'Autonomia finanziaria', tip: 'Per quanti mesi la liquidità copre la spesa media mensile degli ultimi 6 mesi.', href: '#/goals' },
} as const;

function forecastFocus(f: MonthEndForecast, p: Projection[], cur: string): string {
  const m = (c: number) => formatMoney(c, cur);
  return [
    `Previsione di fine ${formatMonth(f.month, true)} (oggi ${formatDate(f.today)}, mancano ${f.daysLeft} giorni)`,
    `CERTO: liquidità oggi ${m(f.certain.balance)}; entrate già incassate ${m(f.certain.incomeSoFar)}; uscite già sostenute ${m(f.certain.expenseSoFar)}`,
    `PROGRAMMATO: entrate ${m(f.scheduled.income)}, uscite ${m(f.scheduled.expense)}`,
    `STIMATO: entrate ${m(f.estimated.income)}, uscite ${m(f.estimated.expense)} (spesa variabile basata su: ${f.estimated.variableBasis})`,
    `Saldo previsto a fine mese: ${m(f.forecastBalance)}; margine del mese: ${m(f.margin)}`,
    `Voci: ${f.lines.map((l) => `${formatDate(l.date)} ${l.name} ${m(l.amount)} (${l.level === 'scheduled' ? 'programmato' : 'stimato'}, ${l.source})`).join('; ')}`,
    `Proiezioni: ${p.map((x) => `${x.months} mesi ${m(x.balance)} (programmati ${m(x.scheduledNet)}, stimati ${m(x.estimatedNet)})`).join('; ')}`,
  ].join('\n');
}

export function insightFocus(i: FinancialInsight): string {
  return `Insight (priorità ${i.priority}): ${i.title}\nMotivo: ${i.reason}\nDati: ${i.data.join('; ') || '—'}\nSuggerimento dell'app: ${i.suggestion}`;
}

export function Dashboard2({ chart }: { chart: React.ReactNode }) {
  const model = useFinanceModel();

  useAiPage(
    model
      ? {
          section: 'dashboard',
          label: `Dashboard · ${model.period.label}`,
          blocks: () => [
            { title: 'KPI DEL PERIODO', body: (Object.keys(KPI_DEFS) as Array<keyof typeof KPI_DEFS>).map((k) => `- ${KPI_DEFS[k].label}: ${fmt(model, k)}`).join('\n') },
            { title: 'PREVISIONE', body: forecastFocus(model.forecast, model.projections, model.ds.settings.baseCurrency) },
            { title: 'INSIGHT CALCOLATI', body: model.insights.map((i) => `- [${i.priority}] ${i.title}: ${i.reason}`).join('\n') || 'nessuno' },
          ],
        }
      : null,
    [model],
  );

  if (!model) return <Skeleton h={320} />;
  const cur = model.ds.settings.baseCurrency;
  const k = model.kpis.kpis;
  const m = (c: number | null, sign = false) => (c === null ? '—' : formatMoney(c, cur, { sign }));
  const delta = (d: number | null, goodUp = true) =>
    d === null || d === 0 ? null : <span className={`num xs ${(d > 0) === goodUp ? 'pos' : 'neg'}`}>{formatMoney(d, cur, { sign: true })} vs periodo prec.</span>;
  const f = model.forecast;
  const top = model.insights.filter((i) => i.priority !== 'bassa').slice(0, 3);
  const autonomy = k.autonomy.value;

  return (
    <>
      <section className="dash-hero" aria-label="Patrimonio">
        <div className="dash-hero-main">
          <span className="dash-label">Patrimonio netto</span>
          <span className="dash-big num" data-testid="kpi-networth">{m(k.netWorth.value)}</span>
          {k.netWorth.delta !== null && k.netWorth.delta !== 0 && (
            <span className={`num small ${k.netWorth.delta > 0 ? 'pos' : 'neg'}`}>{formatMoney(k.netWorth.delta, cur, { sign: true })} da inizio periodo</span>
          )}
          <div className="dash-split">
            <a href="#/accounts">
              <span>Liquidità</span>
              <strong className="num" data-testid="kpi-liquidity">{m(k.liquidity.value)}</strong>
            </a>
            <a href="#/investments">
              <span>Investito</span>
              <strong className="num" data-testid="kpi-investments">{m(k.investments.value)}</strong>
            </a>
            <a href="#/goals" title={`Obiettivo: ${model.emergencyMonths} mesi`}>
              <span>Autonomia</span>
              <strong className={`num ${autonomy !== null && autonomy < 3 ? 'neg' : ''}`} data-testid="kpi-autonomy">
                {autonomy === null ? '—' : `${autonomy.toLocaleString('it-IT', { maximumFractionDigits: 1 })} mesi`}
              </strong>
            </a>
          </div>
        </div>
        <div className="dash-hero-chart">{chart}</div>
      </section>

      <section className="dash-month" aria-label="Il mese">
        <div className="dash-month-head">
          <h2>{model.period.label}</h2>
          <AiButton prompt="Come sto andando in questo periodo?" focus={forecastFocus(f, model.projections, cur)} />
        </div>
        <div className="dash-flows">
          <div>
            <span className="dash-label">Entrate</span>
            <span className="dash-mid num pos" data-testid="kpi-income">{m(k.income.value)}</span>
            {delta(k.income.delta)}
          </div>
          <div>
            <span className="dash-label row" style={{ gap: 4 }}>
              Uscite <Tip text="Solo spese reali: i bonifici tra i tuoi conti e gli acquisti di titoli non contano." />
            </span>
            <span className="dash-mid num neg" data-testid="kpi-expense">{m(k.expense.value)}</span>
            {delta(k.expense.delta, false)}
          </div>
          <div>
            <span className="dash-label">Risparmio</span>
            <span className={`dash-mid num ${(k.net.value ?? 0) < 0 ? 'neg' : ''}`} data-testid="kpi-net">{m(k.net.value, true)}</span>
            <span className="xs muted" data-testid="kpi-saving-rate">{k.savingsRate.value === null ? 'nessuna entrata' : `${formatPercent(k.savingsRate.value)} delle entrate`}</span>
          </div>
        </div>
        <details className="dash-forecast" data-testid="forecast">
          <summary>
            A fine {formatMonth(f.month, true).split(' ')[0]} prevedi <strong className={`num ${f.forecastBalance < 0 ? 'neg' : ''}`} data-testid="forecast-balance">{m(f.forecastBalance)}</strong> di liquidità
            {f.scheduled.expense + f.estimated.expense > 0 && <span className="muted"> · ancora {m(f.scheduled.expense + f.estimated.expense)} di uscite attese</span>}
          </summary>
          <ForecastDetail f={f} p={model.projections} cur={cur} />
        </details>
      </section>

      {top.length > 0 && (
        <section className="dash-todo" data-testid="insights" aria-label="Da tenere d'occhio">
          <div className="dash-month-head">
            <h2>Da tenere d'occhio</h2>
            <a className="hint" href="#/insights">
              Tutti ({model.insights.length}) <ChevronRight size={12} />
            </a>
          </div>
          <ul className="insight-list">
            {top.map((i) => (
              <li key={i.id} className={`insight prio-${i.priority}`}>
                <a href={i.href ?? '#/insights'} className="insight-title">
                  {i.title}
                </a>
                <p className="xs muted">{i.reason}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function fmt(model: FinanceModel, key: keyof typeof KPI_DEFS): string {
  const kp = model.kpis.kpis[key];
  const cur = model.ds.settings.baseCurrency;
  if (kp.value === null) return 'non disponibile';
  if (kp.unit === 'money') return formatMoney(kp.value, cur);
  if (kp.unit === 'ratio') return formatPercent(kp.value);
  return `${kp.value.toLocaleString('it-IT', { maximumFractionDigits: 1 })} mesi`;
}

function ForecastDetail({ f, p, cur }: { f: MonthEndForecast; p: Projection[]; cur: string }) {
  const m = (c: number) => formatMoney(c, cur);
  return (
    <div className="dash-forecast-body">
      <table className="table compact">
        <thead>
          <tr>
            <th />
            <th className="right">Entrate</th>
            <th className="right">Uscite</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><span className="lvl lvl-certain">Certo</span> già avvenuto</td>
            <td className="amount pos">{m(f.certain.incomeSoFar)}</td>
            <td className="amount neg">{m(f.certain.expenseSoFar)}</td>
          </tr>
          <tr>
            <td><span className="lvl lvl-scheduled">Programmato</span> <a href="#/budgets#pianificati">pianificati</a></td>
            <td className="amount pos">{m(f.scheduled.income)}</td>
            <td className="amount neg">{m(f.scheduled.expense)}</td>
          </tr>
          <tr>
            <td><span className="lvl lvl-estimated">Stimato</span> ricorrenti e spesa media</td>
            <td className="amount pos">{m(f.estimated.income)}</td>
            <td className="amount neg">{m(f.estimated.expense)}</td>
          </tr>
        </tbody>
      </table>
      <p className="xs muted" style={{ margin: '8px 0 4px' }}>Liquidità stimata più avanti (senza entrate occasionali):</p>
      <div className="proj-row">
        {p.map((x) => (
          <div key={x.months} className="proj">
            <span className="xs muted">tra {x.months} mesi</span>
            <span className={`num ${x.balance < 0 ? 'neg' : ''}`}>{m(x.balance)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
