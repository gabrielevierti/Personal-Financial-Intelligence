import { useMemo } from 'react';
import { useDataSet } from '../../hooks/useData';
import { ASSET_TYPE_LABELS, assetMetrics, investedOf, makeConverter, monthlySeries, portfolioMetrics } from '../../services/finance';
import { addMonths, currentMonth, formatMonth, monthOf, monthsBetween } from '../../utils/date';
import { formatMoney, formatPercent } from '../../utils/money';
import { NetLineChart } from '../../components/charts/Charts';
import { useAiPage } from '../../components/ai/AiProvider';
import { PageSkeleton } from '../../components/ui/States';

export function PerformancePage() {
  const ds = useDataSet();
  const view = useMemo(() => {
    if (!ds) return null;
    const conv = makeConverter(ds.settings);
    const rows = ds.assets.map((a) => ({ a, m: assetMetrics(a), conv: (c: number) => conv(c, a.currency) })).sort((x, y) => y.m.value - x.m.value);
    const total = portfolioMetrics(ds.assets, conv);
    const months = monthsBetween(`${addMonths(currentMonth(), -11)}-01`, `${currentMonth()}-28`);
    const series = monthlySeries(ds.transactions, months, conv);
    const invested = months.map((m) => ({ month: m, value: ds.transactions.filter((t) => monthOf(t.date) === m).reduce((s, t) => s + conv(investedOf(t), t.currency), 0) }));
    return { rows, total, series, invested };
  }, [ds]);
  useAiPage(view && ds ? { section: 'performance', label: 'Performance', blocks: () => [{ title: 'POSIZIONI', body: view.rows.map((r) => `${r.a.name}: valore ${formatMoney(r.m.value, r.a.currency)}, costo ${formatMoney(r.m.cost, r.a.currency)}, risultato ${formatMoney(r.m.pnl, r.a.currency)} (${formatPercent(r.m.performance)})`).join('\n') || 'nessuna' }] } : null, [view]);
  if (!ds || !view) return <PageSkeleton />;
  const cur = ds.settings.baseCurrency;
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Performance</h1>
          <p>Risultato delle posizioni rispetto al costo e andamento del risparmio. I valori di mercato sono quelli che hai inserito.</p>
        </div>
      </div>
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="panel"><span className="xs muted">Valore posizioni</span><div className="num fc-big">{formatMoney(view.total.value, cur)}</div></div>
        <div className="panel"><span className="xs muted">Costo</span><div className="num fc-big">{formatMoney(view.total.cost, cur)}</div></div>
        <div className="panel"><span className="xs muted">Plus/minusvalenza non realizzata</span><div className={`num fc-big ${view.total.pnl < 0 ? 'neg' : 'pos'}`}>{formatMoney(view.total.pnl, cur, { sign: true })}</div></div>
        <div className="panel"><span className="xs muted">Rendimento sul costo</span><div className="num fc-big">{formatPercent(view.total.performance)}</div><span className="xs muted">semplice, non annualizzato</span></div>
      </div>
      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head"><h2>Posizioni</h2></div>
        {view.rows.length === 0 ? (
          <p className="small muted">Nessun asset. <a href="#/investments">Aggiungine uno</a>.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Asset</th><th>Tipo</th><th className="right">Valore</th><th className="right">Costo</th><th className="right">Risultato</th><th className="right">%</th><th>Aggiornato</th></tr></thead>
              <tbody>
                {view.rows.map(({ a, m }) => (
                  <tr key={a.id}>
                    <td>{a.name}</td>
                    <td className="muted">{ASSET_TYPE_LABELS[a.type]}</td>
                    <td className="amount">{formatMoney(m.value, a.currency)}</td>
                    <td className="amount muted">{formatMoney(m.cost, a.currency)}</td>
                    <td className={`amount ${m.pnl < 0 ? 'neg' : 'pos'}`}>{formatMoney(m.pnl, a.currency, { sign: true })}</td>
                    <td className="right num">{formatPercent(m.performance)}</td>
                    <td className="num muted">{a.updatedAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="grid grid-2">
        <section className="panel">
          <div className="panel-head"><h2>Risparmio mensile</h2><span className="hint">ultimi 12 mesi</span></div>
          <NetLineChart data={view.series} currency={cur} />
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Investito dai conti</h2><span className="hint">acquisti − vendite di titoli</span></div>
          <ul className="plain-list">
            {view.invested.filter((x) => x.value !== 0).map((x) => (
              <li key={x.month} className="row-between small"><span>{formatMonth(x.month, true)}</span><span className="num">{formatMoney(x.value, cur, { sign: true })}</span></li>
            ))}
            {view.invested.every((x) => x.value === 0) && <li className="small muted">Nessun movimento nella categoria "Acquisto investimenti".</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
