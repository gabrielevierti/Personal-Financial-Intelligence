import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useRoute, navigate } from '../../hooks/useRoute';
import { multiples, yearMetrics } from '../../services/research/metrics';
import { loadCompany, type CompanyData } from '../../services/research/registry';
import { useAiPage } from '../../components/ai/AiProvider';
import { AiButton } from '../../components/ai/AiPanel';
import { Callout } from '../../components/ui/States';
import { CompanySearch } from './ResearchPage';
import { fmtBig, fmtPct, fmtPrice, fmtX } from './format';

type Metric = [string, (d: CompanyData) => string];

const METRICS: Metric[] = [
  ['Prezzo', (d) => fmtPrice(d.quote?.price, d.profile?.currency)],
  ['Capitalizzazione', (d) => fmtBig(d.profile?.marketCap?.value, d.profile?.currency)],
  ['Esercizio di riferimento', (d) => d.statements[0]?.periodEnd ?? '—'],
  ['Valuta dei bilanci', (d) => d.statements[0]?.currency ?? '—'],
  ['Ricavi', (d) => fmtBig(d.statements[0]?.revenue)],
  ['Crescita ricavi', (d) => fmtPct(yearMetrics(d.statements)[0]?.revenueGrowth)],
  ['Margine lordo', (d) => fmtPct(yearMetrics(d.statements)[0]?.grossMargin)],
  ['Margine operativo', (d) => fmtPct(yearMetrics(d.statements)[0]?.operatingMargin)],
  ['Margine netto', (d) => fmtPct(yearMetrics(d.statements)[0]?.netMargin)],
  ['ROE', (d) => fmtPct(yearMetrics(d.statements)[0]?.roe)],
  ['ROIC', (d) => fmtPct(yearMetrics(d.statements)[0]?.roic)],
  ['Free cash flow', (d) => fmtBig(yearMetrics(d.statements)[0]?.fcf)],
  ['Debito netto', (d) => fmtBig(yearMetrics(d.statements)[0]?.netDebt)],
  ['Debito netto / EBITDA', (d) => fmtX(yearMetrics(d.statements)[0]?.netDebtToEbitda)],
  ['Copertura interessi', (d) => fmtX(yearMetrics(d.statements)[0]?.interestCoverage)],
  ['P/E', (d) => fmtX(mx(d).pe)],
  ['EV/EBITDA', (d) => fmtX(mx(d).evEbitda)],
  ['P/B', (d) => fmtX(mx(d).pb)],
  ['FCF yield', (d) => fmtPct(mx(d).fcfYield)],
  ['Fonte bilanci', (d) => d.statements[0]?.prov.source ?? '—'],
];

function mx(d: CompanyData) {
  const y = d.statements[0];
  return multiples({ price: d.quote?.price ?? null, shares: d.profile?.sharesOutstanding?.value ?? y?.sharesDiluted ?? null, marketCap: d.profile?.marketCap?.value ?? null }, y);
}

export function ComparePage() {
  const route = useRoute();
  const symbols = (route.params.get('s') ?? '').split(',').filter(Boolean).slice(0, 4);
  const [data, setData] = useState<Record<string, CompanyData | 'loading'>>({});
  useEffect(() => {
    for (const s of symbols) {
      if (data[s]) continue;
      setData((d) => ({ ...d, [s]: 'loading' }));
      void loadCompany(s).then((r) => setData((d) => ({ ...d, [s]: r })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols.join(',')]);
  const loaded = symbols.map((s) => data[s]).filter((d): d is CompanyData => !!d && d !== 'loading');
  const periods = new Set(loaded.map((d) => d.statements[0]?.periodEnd?.slice(0, 7)).filter(Boolean));
  const currencies = new Set(loaded.map((d) => d.statements[0]?.currency).filter(Boolean));
  const table = loaded.map((d) => `${d.symbol}: ${METRICS.map(([l, f]) => `${l} ${f(d)}`).join('; ')}`).join('\n');
  useAiPage(loaded.length ? { section: 'compare', label: `Confronto ${symbols.join(', ')}`, skipPersonal: true, blocks: () => [{ title: 'CONFRONTO (calcoli di PFI)', body: table }] } : null, [table]);
  const setSymbols = (list: string[]) => navigate('compare', list.length ? { s: list.join(',') } : undefined);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Confronto aziende</h1>
          <p>Fino a 4 aziende sugli stessi indicatori, calcolati con le stesse formule. PFI segnala quando periodi o valute non coincidono.</p>
        </div>
      </div>
      {symbols.length < 4 && <CompanySearch compact onPick={(r) => !symbols.includes(r.symbol) && setSymbols([...symbols, r.symbol])} />}
      {symbols.length > 0 && (
        <section className="panel" data-testid="compare">
          <div className="panel-head">
            <h2>{symbols.join(' · ')}</h2>
            {loaded.length > 1 && <AiButton prompt="Confronta queste aziende" focus={table} />}
          </div>
          {periods.size > 1 && <Callout kind="warning">Gli ultimi esercizi chiudono in mesi diversi ({[...periods].join(', ')}): i confronti non sono sullo stesso periodo.</Callout>}
          {currencies.size > 1 && <Callout kind="warning">Bilanci in valute diverse ({[...currencies].join(', ')}): gli importi assoluti non sono confrontabili; i rapporti sì.</Callout>}
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th>Indicatore</th>
                  {symbols.map((s) => (
                    <th key={s} className="right">
                      <a href={`#/research?symbol=${s}`}>{s}</a>
                      <button className="btn btn-ghost icon-btn" aria-label={`Rimuovi ${s}`} onClick={() => setSymbols(symbols.filter((x) => x !== s))}>
                        <X size={12} />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRICS.map(([l, f]) => (
                  <tr key={l}>
                    <th scope="row">{l}</th>
                    {symbols.map((s) => {
                      const d = data[s];
                      return (
                        <td key={s} className="right num">
                          {!d || d === 'loading' ? '…' : f(d)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
