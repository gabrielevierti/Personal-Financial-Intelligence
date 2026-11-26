import { useMemo } from 'react';
import { COST_BASIS_KEY, useSetting } from '../../hooks/useSetting';
import { useDataSet } from '../../hooks/useData';
import { ACCOUNT_TYPE_LABELS, ASSET_TYPE_LABELS, assetValue, balancesByAccount, dataCoverageStart, FINANCIAL_ASSET_TYPES, LIQUID_TYPES, makeConverter, netWorthSeries, netWorthSnapshot, PHYSICAL_ASSET_TYPES } from '../../services/finance';
import { addMonths, currentMonth, monthEnd, monthsBetween } from '../../utils/date';
import { formatMoney, formatPercent } from '../../utils/money';
import { AreaSeriesChart } from '../../components/charts/Charts';
import { useAiPage } from '../../components/ai/AiProvider';
import { AiButton } from '../../components/ai/AiPanel';
import { Callout, EmptyState, PageSkeleton } from '../../components/ui/States';
import { Wallet } from 'lucide-react';

type Row = { name: string; detail: string; value: number; href: string };

export function NetWorthPage() {
  const ds = useDataSet();
  const [costBasis] = useSetting<boolean>(COST_BASIS_KEY, true);
  const view = useMemo(() => {
    if (!ds) return null;
    const conv = makeConverter(ds.settings);
    const snap = netWorthSnapshot(ds.accounts, ds.transactions, ds.assets, conv, { costBasis });
    const bal = balancesByAccount(ds.accounts, ds.transactions);
    const groups: Record<'liquidity' | 'investments' | 'physical' | 'other' | 'debts', Row[]> = { liquidity: [], investments: [], physical: [], other: [], debts: [] };
    for (const a of ds.accounts) {
      const v = conv(bal.get(a.id) ?? 0, a.currency);
      if (v === 0) continue;
      const row = { name: a.name, detail: ACCOUNT_TYPE_LABELS[a.type], value: v, href: `#/transactions?account=${a.id}` };
      if (v < 0) groups.debts.push(row);
      else if (LIQUID_TYPES.includes(a.type)) groups.liquidity.push(row);
      else if (a.type === 'investment') groups.investments.push(row);
      else groups.other.push(row);
    }
    for (const as of ds.assets) {
      const row = { name: as.name, detail: ASSET_TYPE_LABELS[as.type], value: conv(assetValue(as), as.currency), href: '#/investments' };
      if (FINANCIAL_ASSET_TYPES.includes(as.type)) groups.investments.push(row);
      else if (PHYSICAL_ASSET_TYPES.includes(as.type)) groups.physical.push(row);
      else groups.other.push(row);
    }
    if (snap.investedAtCost) groups.investments.push({ name: 'Titoli acquistati dai conti', detail: 'al costo, dai movimenti "Acquisto investimenti"', value: snap.investedAtCost, href: '#/transactions?category=inv-buy' });
    const coverage = dataCoverageStart(ds.accounts, ds.transactions);
    const months = monthsBetween(`${addMonths(currentMonth(), -23)}-01`, monthEnd(currentMonth())).filter((m) => !coverage || monthEnd(m) >= coverage);
    const series = netWorthSeries(ds.accounts, ds.transactions, ds.assets, ds.valuations, months, conv, { costBasis });
    return { snap, groups, series, missing: [...conv.missing] };
  }, [ds, costBasis]);

  useAiPage(
    view && ds
      ? {
          section: 'investments',
          label: 'Patrimonio',
          blocks: () => [
            {
              title: 'COMPOSIZIONE DEL PATRIMONIO',
              body: Object.entries(view.groups)
                .map(([g, rows]) => `${g}: ${rows.map((r) => `${r.name} (${r.detail}) ${formatMoney(r.value, ds.settings.baseCurrency)}`).join('; ') || 'nessuna voce'}`)
                .join('\n'),
            },
          ],
        }
      : null,
    [view],
  );

  if (!ds || !view) return <PageSkeleton />;
  const cur = ds.settings.baseCurrency;
  const { snap, groups } = view;
  if (!ds.accounts.length && !ds.assets.length)
    return (
      <div className="panel">
        <EmptyState icon={<Wallet size={22} />} title="Nessun dato sul patrimonio" text="Aggiungi conti, investimenti o beni come la tua auto per vedere la composizione del patrimonio." />
      </div>
    );
  const otherTotal = groups.other.reduce((s, r) => s + r.value, 0);
  const parts = [
    { key: 'liquidity', label: 'Liquidità', value: snap.liquidity, tip: 'Disponibile subito' },
    { key: 'investments', label: 'Capitale investito', value: snap.investments, tip: 'Esposto ai mercati' },
    { key: 'physical', label: 'Beni fisici', value: snap.physical, tip: 'Immobili, veicoli, altri beni: valori stimati' },
    { key: 'other', label: 'Altro', value: otherTotal, tip: 'Altri conti e asset' },
    { key: 'debts', label: 'Debiti', value: -snap.debts, tip: 'Saldi negativi' },
  ];
  const gross = snap.liquidity + snap.investments + snap.physical + Math.max(0, otherTotal);
  const titles: Record<string, string> = { liquidity: 'Liquidità', investments: 'Capitale investito', physical: 'Beni fisici', other: 'Altri conti e asset', debts: 'Debiti' };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Patrimonio</h1>
          <p>Patrimonio netto, liquidità e capitale investito sono grandezze diverse: qui le vedi separate.</p>
        </div>
      </div>
      {view.missing.length > 0 && <Callout kind="warning">Mancano i tassi di cambio per {view.missing.join(', ')}: quegli importi sono esclusi.</Callout>}
      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head">
          <h2>Patrimonio netto</h2>
          <AiButton prompt="Commenta la composizione del mio patrimonio" focus={parts.map((p) => `${p.label}: ${formatMoney(p.value, cur)}`).join('\n')} />
        </div>
        <div className="num fc-big" data-testid="networth-total">{formatMoney(snap.netWorth, cur)}</div>
        <div className="stackbar" role="img" aria-label="Composizione del patrimonio">
          {parts.filter((p) => p.value > 0).map((p) => (
            <span key={p.key} className={`seg seg-${p.key}`} style={{ width: `${(p.value / Math.max(1, gross)) * 100}%` }} title={`${p.label}: ${formatMoney(p.value, cur)}`} />
          ))}
        </div>
        <div className="nw-parts">
          {parts.map((p) => (
            <div key={p.key}>
              <span className={`dot seg-${p.key}`} /> <span className="small">{p.label}</span>
              <div className={`num ${p.value < 0 ? 'neg' : ''}`}>{formatMoney(p.value, cur)}</div>
              <span className="xs muted">{gross > 0 && p.value > 0 ? `${formatPercent(p.value / gross, 0)} · ` : ''}{p.tip}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head">
          <h2>Evoluzione</h2>
          <span className="hint">ultimi 24 mesi con dati completi</span>
        </div>
        {view.series.length > 1 ? <AreaSeriesChart data={view.series as unknown as Array<Record<string, number | string>>} dataKey="netWorth" name="Patrimonio netto" currency={cur} testId="chart-networth-page" /> : <p className="small muted">Servono almeno due mesi di dati.</p>}
      </section>
      <div className="grid grid-2">
        {(Object.keys(groups) as Array<keyof typeof groups>).filter((g) => groups[g].length).map((g) => (
          <section key={g} className="panel">
            <div className="panel-head">
              <h2>{titles[g]}</h2>
              <span className="hint num">{formatMoney(groups[g].reduce((s, r) => s + r.value, 0), cur)}</span>
            </div>
            <ul className="plain-list">
              {groups[g].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).map((r, i) => (
                <li key={i} className="row-between small">
                  <a href={r.href}>
                    {r.name} <span className="xs muted">· {r.detail}</span>
                  </a>
                  <span className={`num ${r.value < 0 ? 'neg' : ''}`}>{formatMoney(r.value, cur)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
