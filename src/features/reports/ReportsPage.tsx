import { useMemo, useState } from 'react';
import { BarChart3, FileJson, FileSpreadsheet, FileText } from 'lucide-react';
import type { Period } from '../../types';
import { useDataSet } from '../../hooks/useData';
import { useToast } from '../../hooks/useToast';
import { buildReport, deltaPct, exportReportCsv, exportReportJson, exportReportPdf } from '../../services/reports';
import { addMonths, currentMonth, formatDate, formatMonth, monthEnd, monthStart, todayISO } from '../../utils/date';
import { formatMoney, formatPercent } from '../../utils/money';
import { AreaSeriesChart, BudgetEvolutionChart, DonutWithLegend, IncomeExpenseChart } from '../../components/charts/Charts';
import { Callout, EmptyState, PageSkeleton } from '../../components/ui/States';

type Kind = 'monthly' | 'quarterly' | 'annual' | 'custom';
const KIND_LABEL: Record<Kind, string> = { monthly: 'Mensile', quarterly: 'Trimestrale', annual: 'Annuale', custom: 'Personalizzato' };

export function ReportsPage() {
  const ds = useDataSet();
  const toast = useToast();
  const [kind, setKind] = useState<Kind>('monthly');
  const [month, setMonth] = useState(currentMonth());
  const thisYear = Number(todayISO().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [quarter, setQuarter] = useState(Math.floor((Number(currentMonth().slice(5)) - 1) / 3) + 1);
  const [start, setStart] = useState(monthStart(addMonths(currentMonth(), -2)));
  const [end, setEnd] = useState(todayISO());
  const [exporting, setExporting] = useState(false);

  const period: Period = useMemo(() => {
    if (kind === 'monthly') return { start: monthStart(month), end: monthEnd(month), label: formatMonth(month, true) };
    if (kind === 'quarterly') {
      const sm = `${year}-${String((quarter - 1) * 3 + 1).padStart(2, '0')}`;
      return { start: monthStart(sm), end: monthEnd(addMonths(sm, 2)), label: `${quarter}º trimestre ${year}` };
    }
    if (kind === 'annual') return { start: `${year}-01-01`, end: `${year}-12-31`, label: `Anno ${year}` };
    const [s, e] = start <= end ? [start, end] : [end, start];
    return { start: s, end: e, label: `${formatDate(s)} – ${formatDate(e)}` };
  }, [kind, month, year, quarter, start, end]);

  const report = useMemo(() => (ds ? buildReport(ds, period) : null), [ds, period]);

  if (!ds || !report) return <PageSkeleton />;
  const cur = ds.settings.baseCurrency;
  const s = report.summary;
  const p = report.previousSummary;
  const years = Array.from(new Set([thisYear, ...ds.transactions.map((t) => Number(t.date.slice(0, 4)))])).sort((a, b) => b - a);
  const hasData = report.transactions.length > 0;
  const title = `Report ${KIND_LABEL[kind].toLowerCase()} · ${period.label}`;

  const prevByCat = new Map(report.previousExpenseByCategory.map((c) => [c.categoryId, c.total]));
  const catCompare = report.expenseByCategory.map((c) => ({ ...c, prev: prevByCat.get(c.categoryId) ?? 0 }));
  for (const c of report.previousExpenseByCategory) if (!catCompare.some((x) => x.categoryId === c.categoryId)) catCompare.push({ ...c, total: 0, share: 0, count: 0, prev: c.total });

  const run = async (fn: () => void | Promise<void>, label: string) => {
    setExporting(true);
    try {
      await fn();
      toast.success(`${label} generato e scaricato.`);
    } catch (e) {
      toast.error(e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Report e analisi</h1>
          <p>Entrate, uscite, risparmio, categorie, patrimonio e budget, confrontati con il periodo precedente di pari durata.</p>
        </div>
        <div className="actions">
          <button className="btn" disabled={exporting} onClick={() => run(() => exportReportCsv(report, ds), 'CSV')}>
            <FileSpreadsheet size={15} /> CSV
          </button>
          <button className="btn" disabled={exporting} onClick={() => run(() => exportReportJson(report, ds), 'JSON')}>
            <FileJson size={15} /> JSON
          </button>
          <button className="btn btn-primary" disabled={exporting} onClick={() => run(() => exportReportPdf(report, ds, title), 'PDF')} data-testid="export-pdf">
            <FileText size={15} /> Esporta PDF
          </button>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Tipo di report">
        {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
          <button key={k} role="tab" aria-selected={kind === k} onClick={() => setKind(k)}>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>

      <div className="row" style={{ marginBottom: 20, flexWrap: 'wrap' }}>
        {kind === 'monthly' && (
          <div className="field" style={{ width: 200 }}>
            <label htmlFor="r-month">Mese</label>
            <input id="r-month" type="month" className="input" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </div>
        )}
        {(kind === 'quarterly' || kind === 'annual') && (
          <div className="field" style={{ width: 140 }}>
            <label htmlFor="r-year">Anno</label>
            <select id="r-year" className="select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
          </div>
        )}
        {kind === 'quarterly' && (
          <div className="field" style={{ width: 160 }}>
            <label htmlFor="r-q">Trimestre</label>
            <select id="r-q" className="select" value={quarter} onChange={(e) => setQuarter(Number(e.target.value))}>
              {[1, 2, 3, 4].map((q) => (
                <option key={q} value={q}>
                  {q}º trimestre
                </option>
              ))}
            </select>
          </div>
        )}
        {kind === 'custom' && (
          <>
            <div className="field" style={{ width: 180 }}>
              <label htmlFor="r-start">Dal</label>
              <input id="r-start" type="date" className="input" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} />
            </div>
            <div className="field" style={{ width: 180 }}>
              <label htmlFor="r-end">Al</label>
              <input id="r-end" type="date" className="input" value={end} onChange={(e) => e.target.value && setEnd(e.target.value)} />
            </div>
          </>
        )}
        <span className="muted small" style={{ alignSelf: 'flex-end', paddingBottom: 8 }}>
          Confronto con {formatDate(report.previous.start)} – {formatDate(report.previous.end)}
        </span>
      </div>

      {report.missingRates.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Callout kind="warning">Mancano i tassi di cambio per {report.missingRates.join(', ')}: questi importi sono esclusi dai totali.</Callout>
        </div>
      )}

      {!hasData ? (
        <div className="panel">
          <EmptyState icon={<BarChart3 size={22} />} title="Nessun movimento in questo periodo" text="Scegli un altro periodo o registra dei movimenti. Le esportazioni conterranno comunque il riepilogo vuoto." />
        </div>
      ) : (
        <>
          <section className="panel flush" style={{ marginBottom: 16 }}>
            <div className="panel-head">
              <h2>Riepilogo · {period.label}</h2>
            </div>
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="table" data-testid="report-summary">
                <thead>
                  <tr>
                    <th>Voce</th>
                    <th className="right">Periodo</th>
                    <th className="right">Precedente</th>
                    <th className="right">Variazione</th>
                  </tr>
                </thead>
                <tbody>
                  <CompareRow label="Entrate" a={s.income} b={p.income} cur={cur} goodUp />
                  <CompareRow label="Uscite" a={s.expense} b={p.expense} cur={cur} goodUp={false} />
                  <CompareRow label="Risparmio netto" a={s.net} b={p.net} cur={cur} goodUp />
                  <tr>
                    <td>Tasso di risparmio</td>
                    <td className="amount">{formatPercent(s.savingRate)}</td>
                    <td className="right num muted">{formatPercent(p.savingRate)}</td>
                    <td className="right num">{s.savingRate !== null && p.savingRate !== null ? `${((s.savingRate - p.savingRate) * 100).toLocaleString('it-IT', { maximumFractionDigits: 1, signDisplay: 'exceptZero' })} pt` : '—'}</td>
                  </tr>
                  <CompareRow label="Media spese mensili" a={s.avgMonthlyExpense} b={p.avgMonthlyExpense} cur={cur} goodUp={false} />
                  <tr>
                    <td>Movimenti</td>
                    <td className="amount">{s.transactionCount}</td>
                    <td className="right num muted">{p.transactionCount}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <div className="grid grid-2" style={{ marginBottom: 16 }}>
            <section className="panel">
              <div className="panel-head">
                <h2>Entrate e uscite per mese</h2>
              </div>
              <IncomeExpenseChart data={report.months} currency={cur} />
            </section>
            <section className="panel">
              <div className="panel-head">
                <h2>Andamento del patrimonio</h2>
                <span className="hint">A fine mese</span>
              </div>
              <AreaSeriesChart data={report.netWorth as unknown as Array<Record<string, number | string>>} dataKey="netWorth" name="Patrimonio netto" currency={cur} testId="report-networth" />
            </section>
          </div>

          <div className="grid grid-2" style={{ marginBottom: 16 }}>
            <section className="panel">
              <div className="panel-head">
                <h2>Spese per categoria</h2>
              </div>
              {report.expenseByCategory.length ? (
                <DonutWithLegend currency={cur} slices={report.expenseByCategory.map((c) => ({ key: c.categoryId ?? 'x', label: c.name, value: c.total, share: c.share, color: c.color }))} />
              ) : (
                <p className="muted small">Nessuna spesa.</p>
              )}
            </section>
            <section className="panel">
              <div className="panel-head">
                <h2>Entrate per categoria</h2>
              </div>
              {report.incomeByCategory.length ? (
                <DonutWithLegend currency={cur} slices={report.incomeByCategory.map((c) => ({ key: c.categoryId ?? 'x', label: c.name, value: c.total, share: c.share, color: c.color }))} />
              ) : (
                <p className="muted small">Nessuna entrata.</p>
              )}
            </section>
          </div>

          <div className="grid grid-main-side">
            <section className="panel flush">
              <div className="panel-head">
                <h2>Confronto spese per categoria</h2>
              </div>
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Categoria</th>
                      <th className="right">Periodo</th>
                      <th className="right">Precedente</th>
                      <th className="right">Variazione</th>
                    </tr>
                  </thead>
                  <tbody>
                    {catCompare.map((c) => (
                      <CompareRow key={c.categoryId ?? 'x'} label={c.name} a={c.total} b={c.prev} cur={cur} goodUp={false} dot={c.color} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="panel">
              <div className="panel-head">
                <h2>Evoluzione dei budget</h2>
              </div>
              {report.budgets.length ? <BudgetEvolutionChart data={report.budgets} currency={cur} /> : <p className="muted small">Nessun budget definito nei mesi del periodo.</p>}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function CompareRow({ label, a, b, cur, goodUp, dot }: { label: string; a: number; b: number; cur: string; goodUp: boolean; dot?: string }) {
  const d = deltaPct(a, b);
  const better = d === null || d === 0 ? '' : (d > 0) === goodUp ? 'pos' : 'neg';
  return (
    <tr>
      <td>
        {dot && <i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: dot, marginRight: 8 }} />}
        {label}
      </td>
      <td className="amount">{formatMoney(a, cur)}</td>
      <td className="right num muted">{formatMoney(b, cur)}</td>
      <td className={`right num ${better}`}>{d === null ? (a === 0 ? '—' : 'nuovo') : formatPercent(d)}</td>
    </tr>
  );
}
