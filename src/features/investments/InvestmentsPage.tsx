import { useMemo, useState } from 'react';
import { History, Pencil, Plus, RefreshCw, Trash2, TrendingUp } from 'lucide-react';
import type { Asset, AssetType, Cents } from '../../types';
import { useDataSet } from '../../hooks/useData';
import { errorMessage, useToast } from '../../hooks/useToast';
import { ASSET_TYPE_LABELS, assetMetrics, estimateDepreciatedValue, makeConverter, PHYSICAL_ASSET_TYPES, portfolioMetrics } from '../../services/finance';
import { createAsset, deleteAsset, updateAsset, updateAssetPrice, type AssetInput } from '../../services/repository';
import { ASSET_TYPES } from '../../services/validation';
import { formatDate, todayISO } from '../../utils/date';
import { CURRENCIES, formatMoney, formatPercent } from '../../utils/money';
import { Modal } from '../../components/ui/Modal';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Callout, EmptyState, PageSkeleton, Tip } from '../../components/ui/States';
import { ALLOCATION_COLORS, DonutWithLegend } from '../../components/charts/Charts';

export function InvestmentsPage() {
  const ds = useDataSet();
  const toast = useToast();
  const [editing, setEditing] = useState<Asset | 'new' | null>(null);
  const [pricing, setPricing] = useState<Asset | null>(null);
  const [history, setHistory] = useState<Asset | null>(null);
  const [deleting, setDeleting] = useState<Asset | null>(null);

  const view = useMemo(() => {
    if (!ds) return null;
    const conv = makeConverter(ds.settings);
    const total = portfolioMetrics(ds.assets, conv);
    const byType = new Map<AssetType, Cents>();
    for (const a of ds.assets) byType.set(a.type, (byType.get(a.type) ?? 0) + conv(assetMetrics(a).value, a.currency));
    const sum = [...byType.values()].reduce((s, v) => s + v, 0);
    const slices = [...byType.entries()]
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([t, v], i) => ({ key: t, label: ASSET_TYPE_LABELS[t], value: v, share: sum ? v / sum : 0, color: ALLOCATION_COLORS[i % ALLOCATION_COLORS.length] }));
    return { total, slices, missing: [...conv.missing] };
  }, [ds]);

  if (!ds || !view) return <PageSkeleton />;
  const cur = ds.settings.baseCurrency;
  const { total } = view;
  const assets = [...ds.assets].sort((a, b) => assetMetrics(b).value - assetMetrics(a).value);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Investimenti e beni</h1>
          <p>Azioni, ETF, obbligazioni, fondi, cripto, immobili, veicoli e altri beni fisici. I valori si aggiornano a mano: le quotazioni di Investment Research non modificano questi dati.</p>
        </div>
        <div className="actions">
          <a className="btn" href="#/performance">Performance</a>
          <a className="btn" href="#/simulations">Simula un investimento</a>
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Plus size={16} /> Nuovo asset
          </button>
        </div>
      </div>

      {view.missing.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Callout kind="warning">
            Mancano i tassi di cambio per {view.missing.join(', ')}: questi asset sono esclusi dai totali. <a href="#/settings">Imposta i tassi</a>
          </Callout>
        </div>
      )}

      {assets.length === 0 ? (
        <div className="panel">
          <EmptyState icon={<TrendingUp size={22} />} title="Nessun asset registrato" text="Aggiungi i tuoi investimenti con quantità, prezzo di acquisto e valore corrente per seguirne profitto, performance e allocazione.">
            <button className="btn btn-primary" onClick={() => setEditing('new')}>
              <Plus size={16} /> Aggiungi un asset
            </button>
          </EmptyState>
        </div>
      ) : (
        <>
          <section className="ledger">
            <div className="ledger-cell">
              <div className="ledger-label">Valore totale</div>
              <div className="ledger-value num" data-testid="assets-value">
                {formatMoney(total.value, cur)}
              </div>
            </div>
            <div className="ledger-cell">
              <div className="ledger-label">Costo di acquisto</div>
              <div className="ledger-value num">{formatMoney(total.cost, cur)}</div>
            </div>
            <div className="ledger-cell">
              <div className="ledger-label">Profitto / perdita</div>
              <div className={`ledger-value num ${total.pnl >= 0 ? 'pos' : 'neg'}`} data-testid="assets-pnl">
                {formatMoney(total.pnl, cur, { sign: true })}
              </div>
            </div>
            <div className="ledger-cell">
              <div className="ledger-label">
                Performance <Tip text="(Valore corrente − costo di acquisto) / costo di acquisto. Non considera dividendi, cedole o commissioni non inserite." />
              </div>
              <div className={`ledger-value num ${(total.performance ?? 0) >= 0 ? 'pos' : 'neg'}`}>{formatPercent(total.performance)}</div>
            </div>
          </section>
          <div className="grid grid-main-side">
            <section className="panel flush">
              <div className="panel-head">
                <h2>Asset</h2>
                <span className="hint">{assets.length} posizioni</span>
              </div>
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table className="table" data-testid="assets-table">
                  <thead>
                    <tr>
                      <th>Nome</th>
                      <th className="right hide-mobile">Quantità</th>
                      <th className="right hide-mobile">Prezzo medio</th>
                      <th className="right">Valore</th>
                      <th className="right">P/L</th>
                      <th className="hide-mobile">Aggiornato</th>
                      <th>
                        <span className="sr-only">Azioni</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {assets.map((a) => {
                      const m = assetMetrics(a);
                      return (
                        <tr key={a.id}>
                          <td>
                            <div className="item-title">{a.name}</div>
                            <div className="xs muted">{ASSET_TYPE_LABELS[a.type]}</div>
                          </td>
                          <td className="right num hide-mobile">{a.quantity.toLocaleString('it-IT', { maximumFractionDigits: 8 })}</td>
                          <td className="right num hide-mobile">{formatMoney(a.purchasePrice, a.currency)}</td>
                          <td className="amount">{formatMoney(m.value, a.currency)}</td>
                          <td className={`right num ${m.pnl >= 0 ? 'pos' : 'neg'}`}>
                            {formatMoney(m.pnl, a.currency, { sign: true })}
                            <div className="xs">{formatPercent(m.performance)}</div>
                          </td>
                          <td className="hide-mobile muted num">{formatDate(a.updatedAt)}</td>
                          <td>
                            <div className="row" style={{ gap: 0, justifyContent: 'flex-end' }}>
                              <button className="btn btn-ghost icon-btn" aria-label={`Aggiorna valore ${a.name}`} title="Aggiorna valore" onClick={() => setPricing(a)}>
                                <RefreshCw size={14} />
                              </button>
                              <button className="btn btn-ghost icon-btn" aria-label={`Storico ${a.name}`} title="Storico valutazioni" onClick={() => setHistory(a)}>
                                <History size={14} />
                              </button>
                              <button className="btn btn-ghost icon-btn" aria-label={`Modifica ${a.name}`} onClick={() => setEditing(a)}>
                                <Pencil size={14} />
                              </button>
                              <button className="btn btn-ghost icon-btn" aria-label={`Elimina ${a.name}`} onClick={() => setDeleting(a)}>
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="panel">
              <div className="panel-head">
                <h2>Allocazione patrimoniale</h2>
              </div>
              {view.slices.length ? <DonutWithLegend slices={view.slices} currency={cur} testId="chart-asset-allocation" /> : <p className="muted small">Nessun valore positivo.</p>}
            </section>
          </div>
        </>
      )}

      {editing && <AssetForm asset={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {pricing && <PriceForm asset={pricing} onClose={() => setPricing(null)} />}
      {history && (
        <Modal title={`Storico valutazioni · ${history.name}`} onClose={() => setHistory(null)}>
          <table className="table">
            <thead>
              <tr>
                <th>Data</th>
                <th className="right">Prezzo unitario</th>
                <th className="right">Quantità</th>
                <th className="right">Valore</th>
              </tr>
            </thead>
            <tbody>
              {ds.valuations
                .filter((v) => v.assetId === history.id)
                .sort((a, b) => (a.date < b.date ? 1 : -1))
                .map((v) => (
                  <tr key={v.id}>
                    <td className="num">{formatDate(v.date)}</td>
                    <td className="right num">{formatMoney(v.unitPrice, history.currency)}</td>
                    <td className="right num">{v.quantity.toLocaleString('it-IT', { maximumFractionDigits: 8 })}</td>
                    <td className="amount">{formatMoney(Math.round(v.quantity * v.unitPrice), history.currency)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Modal>
      )}
      {deleting && (
        <ConfirmDialog
          title={`Eliminare "${deleting.name}"?`}
          message="Verranno eliminati l'asset e tutto il suo storico di valutazioni. Il grafico del patrimonio non lo conteggerà più."
          confirmLabel="Elimina asset"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await deleteAsset(deleting.id);
            toast.success('Asset eliminato.');
          }}
        />
      )}
    </div>
  );
}

/** Quantità in formato italiano ("1.234,5") o internazionale ("1234.5"). */
export function parseQty(input: string): number {
  let s = input.replace(/\s/g, '');
  if (s === '') return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function AssetForm({ asset, onClose }: { asset: Asset | null; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<Omit<AssetInput, 'quantity' | 'purchasePrice' | 'currentPrice'>>(asset ? { name: asset.name, type: asset.type, currency: asset.currency, updatedAt: asset.updatedAt, notes: asset.notes, purchaseDate: asset.purchaseDate, depreciationRate: asset.depreciationRate } : { name: '', type: 'etf', currency: 'EUR', updatedAt: todayISO() });
  const physical = PHYSICAL_ASSET_TYPES.includes(f.type);
  const [rate, setRate] = useState(asset?.depreciationRate !== undefined ? String(asset.depreciationRate).replace('.', ',') : '');
  const [qty, setQty] = useState(asset ? String(asset.quantity).replace('.', ',') : '');
  const [buy, setBuy] = useState<Cents | null>(asset?.purchasePrice ?? null);
  const [price, setPrice] = useState<Cents | null>(asset?.currentPrice ?? null);
  const [error, setError] = useState<string | null>(null);
  const q = parseQty(qty);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = rate.trim() === '' ? undefined : Number(rate.replace(',', '.'));
      const input: AssetInput = { ...f, quantity: q, purchasePrice: buy ?? 0, currentPrice: price ?? buy ?? 0, purchaseDate: physical ? f.purchaseDate || undefined : undefined, depreciationRate: physical ? r : undefined };
      if (asset) await updateAsset(asset.id, input);
      else await createAsset(input);
      toast.success(asset ? 'Asset aggiornato.' : 'Asset aggiunto.');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Modal
      title={asset ? 'Modifica asset' : 'Nuovo asset'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Annulla
          </button>
          <button className="btn btn-primary" type="submit" form="asset-form">
            {asset ? 'Salva modifiche' : 'Aggiungi asset'}
          </button>
        </>
      }
    >
      <form id="asset-form" className="form" onSubmit={submit}>
        <div className="form-row">
          <div className="field">
            <label htmlFor="as-name">Nome</label>
            <input id="as-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={physical ? 'Es. Fiat Panda 2021' : 'Es. Vanguard FTSE All-World'} maxLength={80} />
          </div>
          <div className="field">
            <label htmlFor="as-type">Categoria</label>
            <select id="as-type" className="select" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as AssetType })}>
              {ASSET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ASSET_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="as-qty">Quantità</label>
            <input id="as-qty" className="input input-money" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Es. 12,5" aria-invalid={qty !== '' && !(q > 0) ? true : undefined} />
            <span className="help">Per immobili o beni unici usa 1.</span>
          </div>
          <div className="field">
            <label htmlFor="as-cur">Valuta</label>
            <select id="as-cur" className="select" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="as-buy">Prezzo medio di acquisto (unitario)</label>
            <MoneyInput id="as-buy" value={buy} onChange={setBuy} currency={f.currency} />
          </div>
          <div className="field">
            <label htmlFor="as-price">Valore corrente (unitario)</label>
            <MoneyInput id="as-price" value={price} onChange={setPrice} currency={f.currency} />
          </div>
        </div>
        {physical && (
          <div className="form-row">
            <div className="field">
              <label htmlFor="as-pdate">Data di acquisto (facoltativa)</label>
              <input id="as-pdate" type="date" className="input" value={f.purchaseDate ?? ''} onChange={(e) => setF({ ...f, purchaseDate: e.target.value || undefined })} />
            </div>
            <div className="field">
              <label htmlFor="as-rate">Deprezzamento annuo stimato % (facoltativo)</label>
              <input id="as-rate" className="input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder={f.type === 'vehicle' ? 'Es. 15' : 'Es. 0'} />
              {buy !== null && f.purchaseDate && Number(rate.replace(',', '.')) > 0 && (
                <span className="help">
                  Stima: <strong className="num">{formatMoney(estimateDepreciatedValue(buy, f.purchaseDate, Number(rate.replace(',', '.'))), f.currency)}</strong> per unità.{' '}
                  <button type="button" className="link-btn" onClick={() => setPrice(estimateDepreciatedValue(buy, f.purchaseDate!, Number(rate.replace(',', '.'))))}>
                    Usa come valore corrente
                  </button>
                  <span style={{ display: 'block' }}>È solo una stima: per un'auto il valore reale dipende da chilometri, condizioni e mercato.</span>
                </span>
              )}
            </div>
          </div>
        )}
        <div className="field">
          <label htmlFor="as-date">Data di aggiornamento del valore</label>
          <input id="as-date" type="date" className="input" value={f.updatedAt} onChange={(e) => setF({ ...f, updatedAt: e.target.value })} />
        </div>
        {q > 0 && price !== null && (
          <p className="small muted">
            Valore della posizione: <strong className="num">{formatMoney(Math.round(q * price), f.currency)}</strong>
            {buy !== null && (
              <>
                {' '}· costo <span className="num">{formatMoney(Math.round(q * buy), f.currency)}</span>
              </>
            )}
          </p>
        )}
        {error && (
          <p className="small" role="alert" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

function PriceForm({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const toast = useToast();
  const [price, setPrice] = useState<Cents | null>(asset.currentPrice);
  const [date, setDate] = useState(todayISO());
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (price === null) return setError('Inserisci un valore.');
    try {
      await updateAssetPrice(asset.id, price, date);
      toast.success(`Valore di ${asset.name} aggiornato.`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Modal
      title={`Aggiorna valore · ${asset.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Annulla
          </button>
          <button className="btn btn-primary" type="submit" form="price-form">
            Aggiorna valore
          </button>
        </>
      }
    >
      <form id="price-form" className="form" onSubmit={submit}>
        <div className="form-row">
          <div className="field">
            <label htmlFor="pr-price">Valore unitario</label>
            <MoneyInput id="pr-price" value={price} onChange={setPrice} currency={asset.currency} />
          </div>
          <div className="field">
            <label htmlFor="pr-date">Data</label>
            <input id="pr-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <p className="help small muted">Ogni aggiornamento viene salvato nello storico e usato per il grafico dell'evoluzione del patrimonio.</p>
        {error && (
          <p className="small" role="alert" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
