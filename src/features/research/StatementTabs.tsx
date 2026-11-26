import { ExternalLink } from 'lucide-react';
import { findAnomalies, yearMetrics, type YearMetrics } from '../../services/research/metrics';
import type { Filing, FinancialYear } from '../../services/research/types';
import { SourceTag } from '../../components/finance/Provenance';
import { AiButton } from '../../components/ai/AiPanel';
import { Callout } from '../../components/ui/States';
import { fmtBig, fmtNum, fmtPct, fmtX, pctClass } from './format';

type Row = { label: string; get: (y: FinancialYear, m: YearMetrics) => number | null; fmt?: 'big' | 'pct' | 'x' | 'num'; key?: string; growth?: boolean; derived?: boolean };

const INCOME: Row[] = [
  { label: 'Ricavi', get: (y) => y.revenue, key: 'revenue' },
  { label: 'Crescita ricavi', get: (_, m) => m.revenueGrowth, fmt: 'pct', growth: true, derived: true },
  { label: 'Costo del venduto', get: (y) => y.costOfRevenue },
  { label: 'Utile lordo', get: (y) => y.grossProfit, key: 'grossProfit' },
  { label: 'Margine lordo', get: (_, m) => m.grossMargin, fmt: 'pct', derived: true },
  { label: 'Utile operativo (EBIT)', get: (y) => y.operatingIncome, key: 'operatingIncome' },
  { label: 'Margine operativo', get: (_, m) => m.operatingMargin, fmt: 'pct', derived: true, key: 'operatingMargin' },
  { label: 'Ammortamenti', get: (y) => y.depreciation },
  { label: 'EBITDA', get: (_, m) => m.ebitda, key: 'ebitda' },
  { label: 'Interessi passivi', get: (y) => y.interestExpense },
  { label: 'Utile ante imposte', get: (y) => y.pretaxIncome },
  { label: 'Imposte', get: (y) => y.incomeTax },
  { label: 'Utile netto', get: (y) => y.netIncome, key: 'netIncome' },
  { label: 'Crescita utile netto', get: (_, m) => m.netIncomeGrowth, fmt: 'pct', growth: true, derived: true },
  { label: 'Margine netto', get: (_, m) => m.netMargin, fmt: 'pct', derived: true },
  { label: 'EPS diluito', get: (y) => y.epsDiluted, fmt: 'num' },
  { label: 'Azioni diluite', get: (y) => y.sharesDiluted },
  { label: 'Flusso di cassa operativo', get: (y) => y.operatingCashFlow },
  { label: 'Capex', get: (y) => y.capex },
  { label: 'Free cash flow', get: (_, m) => m.fcf, key: 'fcf', derived: true },
  { label: 'Crescita FCF', get: (_, m) => m.fcfGrowth, fmt: 'pct', growth: true, derived: true },
  { label: 'Margine FCF', get: (_, m) => m.fcfMargin, fmt: 'pct', derived: true },
  { label: 'Dividendi pagati', get: (y) => y.dividendsPaid },
  { label: 'Riacquisto azioni', get: (y) => y.buybacks },
];

const BALANCE: Row[] = [
  { label: 'Totale attivo', get: (y) => y.totalAssets },
  { label: 'Attivo corrente', get: (y) => y.currentAssets },
  { label: 'Cassa e equivalenti', get: (y) => y.cash },
  { label: 'Investimenti a breve', get: (y) => y.shortTermInvestments },
  { label: 'Crediti commerciali', get: (y) => y.receivables },
  { label: 'Rimanenze', get: (y) => y.inventory },
  { label: 'Totale passivo', get: (y) => y.totalLiabilities, key: 'totalLiabilities' },
  { label: 'Passivo corrente', get: (y) => y.currentLiabilities },
  { label: 'Debito a breve', get: (y) => y.shortTermDebt },
  { label: 'Debito a lungo', get: (y) => y.longTermDebt },
  { label: 'Patrimonio netto', get: (y) => y.equity },
  { label: 'ROE', get: (_, m) => m.roe, fmt: 'pct', derived: true },
  { label: 'ROA', get: (_, m) => m.roa, fmt: 'pct', derived: true },
  { label: 'ROIC', get: (_, m) => m.roic, fmt: 'pct', derived: true },
];

const fmtCell = (v: number | null, f: Row['fmt']) => (f === 'pct' ? fmtPct(v) : f === 'x' ? fmtX(v) : f === 'num' ? fmtNum(v) : fmtBig(v));

function YearTable({ years, rows, title }: { years: FinancialYear[]; rows: Row[]; title: string }) {
  const m = yearMetrics(years);
  const shown = years.slice(0, 10);
  const anomalies = findAnomalies(m);
  const flagged = new Set(anomalies.map((a) => `${a.fiscalYear}|${a.field}`));
  const currencies = new Set(shown.map((y) => y.currency));
  const focus = `${title} (${shown[0]?.currency}, fonte ${shown[0]?.prov.source})\n${rows.map((r) => `${r.label}: ${shown.map((y, i) => `${y.fiscalYear} ${fmtCell(r.get(y, m[i]), r.fmt)}`).join(', ')}`).join('\n')}\nAnomalie: ${anomalies.map((a) => `${a.fiscalYear} ${a.message}`).join('; ') || 'nessuna'}`;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        <div className="row" style={{ gap: 8 }}>
          <span className="hint">{shown.length} esercizi · {shown[0]?.currency} · valori come riportati</span>
          <AiButton prompt={`Commenta ${title.toLowerCase()} degli ultimi anni`} focus={focus} />
        </div>
      </div>
      {currencies.size > 1 && <Callout kind="warning">Gli esercizi sono in valute diverse ({[...currencies].join(', ')}): i confronti tra anni non sono omogenei.</Callout>}
      <div className="table-wrap">
        <table className="table compact fin-table">
          <thead>
            <tr>
              <th>Voce</th>
              {shown.map((y) => (
                <th key={y.periodEnd} className="right" title={`Esercizio chiuso il ${y.periodEnd}`}>
                  {y.fiscalYear}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className={r.derived ? 'derived' : ''}>
                <th scope="row">{r.label}</th>
                {shown.map((y, i) => {
                  const v = r.get(y, m[i]);
                  const flag = r.key && flagged.has(`${y.fiscalYear}|${r.key}`);
                  const derived = r.key && y.derived.includes(r.key);
                  return (
                    <td key={y.periodEnd} className={`right num${r.growth ? ` ${pctClass(v)}` : ''}${flag ? ' flag' : ''}`} title={flag ? anomalies.find((a) => a.fiscalYear === y.fiscalYear && a.field === r.key)?.message : derived ? 'Calcolato da PFI con altre voci del bilancio' : undefined}>
                      {fmtCell(v, r.fmt)}
                      {derived && <sup>*</sup>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        {shown[0] && <SourceTag prov={shown[0].prov} />}
        <span className="xs muted">Righe in grigio e valori con * = calcolati da PFI. "—" = dato non riportato dalla fonte (mai stimato). Celle evidenziate = variazioni insolite.</span>
      </div>
    </section>
  );
}

export function StatementsTab({ years, kind }: { years: FinancialYear[]; kind: 'income' | 'balance' }) {
  if (!years.length) return <Callout>Bilanci non disponibili: per le società USA serve la SEC (secUserAgent nel bridge), per le altre Alpha Vantage.</Callout>;
  return kind === 'income' ? <YearTable years={years} rows={INCOME} title="Conto economico e flussi di cassa" /> : <YearTable years={years} rows={BALANCE} title="Stato patrimoniale" />;
}

export function DebtTab({ years, filings }: { years: FinancialYear[]; filings: Filing[] }) {
  const m = yearMetrics(years);
  const shown = m.slice(0, 8);
  if (!years.length) return <Callout>Bilanci non disponibili.</Callout>;
  const rows: Array<[string, (x: YearMetrics) => string, string]> = [
    ['Debito lordo', (x) => fmtBig(x.grossDebt), 'Debito finanziario a breve + a lungo'],
    ['Debito netto', (x) => fmtBig(x.netDebt), 'Debito lordo − cassa − investimenti a breve'],
    ['Debito netto / EBITDA', (x) => fmtX(x.netDebtToEbitda), 'Anni di EBITDA per ripagare il debito netto'],
    ['Debito / patrimonio netto', (x) => fmtX(x.debtToEquity), 'Debito lordo diviso patrimonio netto'],
    ['Copertura interessi', (x) => fmtX(x.interestCoverage), 'EBIT diviso interessi passivi'],
    ['Current ratio', (x) => fmtX(x.currentRatio), 'Attivo corrente / passivo corrente'],
    ['Quick ratio', (x) => fmtX(x.quickRatio), '(Attivo corrente − rimanenze) / passivo corrente'],
  ];
  const annual = filings.filter((f) => /^(10-K|20-F|40-F)/.test(f.form)).slice(0, 4);
  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <h2>Analisi del debito</h2>
          <AiButton prompt="Il debito di questa azienda è sostenibile?" focus={rows.map(([l, f]) => `${l}: ${shown.map((x) => `${x.fiscalYear} ${f(x)}`).join(', ')}`).join('\n')} />
        </div>
        <div className="table-wrap">
          <table className="table compact fin-table">
            <thead>
              <tr>
                <th>Indicatore</th>
                {shown.map((x) => (
                  <th key={x.periodEnd} className="right">
                    {x.fiscalYear}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([l, f, tip]) => (
                <tr key={l}>
                  <th scope="row" title={tip}>
                    {l}
                  </th>
                  {shown.map((x) => (
                    <td key={x.periodEnd} className="right num">
                      {f(x)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="xs muted" style={{ marginTop: 8 }}>
          Debito lordo e netto sono distinti: il netto sottrae cassa e investimenti a breve. Il debito include solo i debiti finanziari riportati (non leasing operativi, se la fonte non li include). Valuta: {years[0].currency}.
        </p>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Scadenze e covenant</h2>
        </div>
        <p className="small muted">Le fonti strutturate gratuite non forniscono il calendario delle scadenze né i covenant: PFI non li stima. Si trovano nelle note ai bilanci depositati.</p>
        {annual.length > 0 && (
          <ul className="plain-list" style={{ marginTop: 8 }}>
            {annual.map((f) => (
              <li key={f.url} className="small">
                <a href={f.url} target="_blank" rel="noreferrer noopener">
                  {f.form} depositato il {f.filingDate} {f.reportDate && `(periodo ${f.reportDate})`} <ExternalLink size={11} />
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
