import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../database/db';
import { DatabaseBackup, FileUp, Landmark, PieChart as PieIcon, Plus } from 'lucide-react';
import { useDataSet } from '../../hooks/useData';
import { usePrefs } from '../../hooks/usePrefs';
import { COST_BASIS_KEY, useSetting } from '../../hooks/useSetting';
import { navigate } from '../../hooks/useRoute';
import {
  allocation,
  averageMonthlyExpense,
  dataCoverageStart,
  emergencyCoverage,
  flowOf,
  investedOf,
  makeConverter,
  monthlySeries,
  netWorthSeries,
  netWorthSnapshot,
  summarize,
  totalsByCategory,
} from '../../services/finance';
import { addMonths, formatMonth, monthEnd, monthOf, monthsBetween } from '../../utils/date';
import { formatMoney } from '../../utils/money';
import { Callout, EmptyState, PageSkeleton } from '../../components/ui/States';
import { SpendingCalendar } from '../../components/charts/SpendingCalendar';
import { Dashboard2 } from './Dashboard2';
import { ALLOCATION_COLORS, AreaSeriesChart, DonutWithLegend, IncomeExpenseChart } from '../../components/charts/Charts';

export function DashboardPage() {
  const ds = useDataSet();
  const { period } = usePrefs();
  const consents = useLiveQuery(() => db.bank_connections.toArray(), []);
  const [costBasis] = useSetting<boolean>(COST_BASIS_KEY, true);

  const view = useMemo(() => {
    if (!ds) return null;
    const conv = makeConverter(ds.settings);
    const summary = summarize(ds.transactions, period, conv);
    const snap = netWorthSnapshot(ds.accounts, ds.transactions, ds.assets, conv, { costBasis });
    let months = monthsBetween(period.start, period.end);
    // Per periodi brevi i grafici mostrano il contesto degli ultimi 6 mesi
    if (months.length < 3) {
      const end = monthOf(period.end);
      months = monthsBetween(`${addMonths(end, -5)}-01`, period.end);
    }
    if (months.length > 36) months = months.slice(-36);
    const series = monthlySeries(ds.transactions, months, conv);
    // il patrimonio si mostra solo dai mesi in cui tutti i conti hanno dati: prima i saldi non sono noti
    const coverageFrom = dataCoverageStart(ds.accounts, ds.transactions);
    const nwMonths = coverageFrom ? months.filter((m) => monthEnd(m) >= coverageFrom) : months;
    const nw = netWorthSeries(ds.accounts, ds.transactions, ds.assets, ds.valuations, nwMonths, conv, { costBasis });
    const expenseCats = totalsByCategory(ds.transactions, period, 'expense', ds.categories, conv);
    const alloc = allocation(ds.accounts, ds.transactions, ds.assets, conv, { costBasis });
    const avgExp = averageMonthlyExpense(ds.transactions, conv);
    const coverage = emergencyCoverage(snap.liquidity, avgExp);
    const nwStart = nw.length > 1 ? nw[0].netWorth : null;
    // dettaglio per conto dei totali del periodo
    const breakdown = ds.accounts
      .map((a) => {
        const own = ds.transactions.filter((t) => t.accountId === a.id && t.date >= period.start && t.date <= period.end);
        const income = own.reduce((s, t) => s + conv(flowOf(t).income, t.currency), 0);
        const expense = own.reduce((s, t) => s + conv(flowOf(t).expense, t.currency), 0);
        const invested = own.reduce((s, t) => s + conv(investedOf(t), t.currency), 0);
        const transfers = own.filter((t) => t.type === 'transfer' && t.amount < 0).reduce((s, t) => s - conv(t.amount, t.currency), 0);
        const pending = own.filter((t) => t.pending).reduce((s, t) => s + conv(t.amount, t.currency), 0);
        return { id: a.id, name: a.name, income, expense, invested, transfers, pending, count: own.length };
      })
      .filter((r) => r.count > 0);
    return { breakdown, conv, summary, snap, series, nw, expenseCats, alloc, avgExp, coverage, nwStart, months, coverageFrom };
  }, [ds, period, costBasis]);

  if (!ds || !view) return <PageSkeleton />;
  const cur = ds.settings.baseCurrency;

  if (ds.accounts.length === 0 && ds.assets.length === 0) {
    return (
      <div className="panel">
        <EmptyState
          icon={<Landmark size={22} />}
          title="Inizia aggiungendo il tuo primo conto"
          text="La dashboard si popola con i dati che inserisci: crea un conto, poi aggiungi i movimenti a mano o importa un estratto conto CSV o Excel. Tutto resta su questo dispositivo."
        >
          <button className="btn btn-primary" onClick={() => navigate('accounts', { new: '1' })}>
            <Plus size={16} /> Crea un conto
          </button>
          <button className="btn" onClick={() => navigate('import')}>
            <FileUp size={16} /> Importa estratto conto
          </button>
          <button className="btn btn-ghost" onClick={() => navigate('settings')}>
            <DatabaseBackup size={16} /> Ripristina un backup
          </button>
        </EmptyState>
      </div>
    );
  }

  const { series, nw, expenseCats, alloc } = view;
  const hasFlows = series.some((p) => p.income || p.expense);
  const rangeLabel = `${formatMonth(view.months[0])} – ${formatMonth(view.months[view.months.length - 1])}`;
  const missing = [...view.conv.missing];

  const consentIssues = (consents ?? []).filter((c) => c.status !== 'active' || new Date(c.validUntil).getTime() - Date.now() < 7 * 86400000);

  return (
    <div>
      {consentIssues.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Callout kind="warning">
            {consentIssues.map((c) => c.aspspName).join(', ')}: il consenso per la sincronizzazione {consentIssues.some((c) => c.status !== 'active' || new Date(c.validUntil).getTime() < Date.now()) ? 'è scaduto' : 'scade a breve'}. <a href="#/banks">Rinnova il consenso</a>
          </Callout>
        </div>
      )}
      {missing.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Callout kind="warning">
            Mancano i tassi di cambio per {missing.join(', ')}: gli importi in queste valute sono esclusi dai totali.{' '}
            <a href="#/settings">Imposta i tassi</a>
          </Callout>
        </div>
      )}

      <Dashboard2
        chart={
          nw.length > 1 ? (
            <AreaSeriesChart data={nw as unknown as Array<Record<string, number | string>>} dataKey="netWorth" name="Patrimonio netto" currency={cur} height={220} testId="chart-networth" />
          ) : (
            <p className="small muted">Il grafico compare quando ci sono almeno due mesi di dati.</p>
          )
        }
      />

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head">
          <h2>Entrate e uscite</h2>
          <span className="hint">{rangeLabel}</span>
        </div>
        {hasFlows ? <IncomeExpenseChart data={series} currency={cur} /> : <NoData />}
      </section>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <section className="panel">
          <div className="panel-head">
            <h2>Spese per categoria</h2>
            <span className="hint">{period.label}</span>
          </div>
          {expenseCats.length ? (
            <DonutWithLegend testId="chart-categories" currency={cur} slices={expenseCats.map((c) => ({ key: c.categoryId ?? 'none', label: c.name, value: c.total, color: c.color, share: c.share }))} />
          ) : (
            <NoData text="Nessuna spesa nel periodo selezionato." />
          )}
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Distribuzione degli asset</h2>
            <a className="hint" href="#/investments">
              Gestisci patrimonio
            </a>
          </div>
          {alloc.length ? (
            <DonutWithLegend testId="chart-allocation" currency={cur} slices={alloc.map((a, i) => ({ key: a.key, label: a.label, value: a.value, share: a.share, color: ALLOCATION_COLORS[i % ALLOCATION_COLORS.length] }))} />
          ) : (
            <NoData icon={<PieIcon size={20} />} text="Nessun saldo positivo o asset da ripartire." />
          )}
        </section>
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head">
          <h2>Spese giornaliere</h2>
          <span className="hint">Ultimi 6 mesi</span>
        </div>
        <SpendingCalendar transactions={ds.transactions} currency={cur} />
      </section>

      {view.breakdown.length > 0 && (
        <details className="panel breakdown" style={{ marginTop: 16 }} data-testid="totals-breakdown">
          <summary>Da dove vengono entrate e uscite · {period.label}</summary>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Conto</th>
                  <th className="right">Entrate</th>
                  <th className="right">Uscite</th>
                  <th className="right">Investito (escluso)</th>
                  <th className="right">Trasferimenti esclusi</th>
                  <th className="right">Di cui in attesa</th>
                </tr>
              </thead>
              <tbody>
                {view.breakdown.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <a href={`#/transactions?account=${r.id}`}>{r.name}</a>
                    </td>
                    <td className="amount pos">{formatMoney(r.income, cur)}</td>
                    <td className="amount neg">{formatMoney(r.expense, cur)}</td>
                    <td className="right num muted">{r.invested ? formatMoney(r.invested, cur, { sign: true }) : '—'}</td>
                    <td className="right num muted">{r.transfers ? formatMoney(r.transfers, cur) : '—'}</td>
                    <td className="right num muted">{r.pending ? formatMoney(r.pending, cur, { sign: true }) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="xs muted" style={{ marginTop: 10 }}>
            I trasferimenti tra i tuoi conti non contano come entrate o uscite. Se un conto compare due volte (ad esempio importato da PDF e collegato alla banca), in <a href="#/accounts">Conti</a> trovi l'avviso per unirli.
          </p>
        </details>
      )}


    </div>
  );
}

function NoData({ text = 'Nessun movimento in questo intervallo.', icon }: { text?: string; icon?: React.ReactNode }) {
  return <EmptyState compact icon={icon ?? <PieIcon size={20} />} title="Ancora niente da mostrare" text={text} />;
}
