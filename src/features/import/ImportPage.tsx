import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, FileUp, History, RotateCcw, Upload } from 'lucide-react';
import { db } from '../../database/db';
import { useDataSet } from '../../hooks/useData';
import { useToast, errorMessage } from '../../hooks/useToast';
import { navigate } from '../../hooks/useRoute';
import { readStatementFile, type ParsedFile } from '../../services/fileReader';
import {
  buildPreview,
  detectHeaderRow,
  emptyMapping,
  FIELD_LABELS,
  guessMapping,
  previewStats,
  statementCheck,
  validateMapping,
  type ColumnMapping,
  type MappableField,
  type ParseOptions,
  type PreviewRow,
} from '../../services/importParser';
import { autoLinkTransfers } from '../../services/transfers';
import { alignBalanceAt, commitImport, existingFingerprintCounts, undoImport } from '../../services/repository';
import { loadCategorizer, recategorizeUncategorized } from '../../services/categorize';
import type { DateFormat } from '../../utils/date';
import { formatDate } from '../../utils/date';
import { formatMoney, type DecimalSeparator } from '../../utils/money';
import { Callout, EmptyState, PageSkeleton } from '../../components/ui/States';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';

type Step = 1 | 2 | 3 | 4;
type RowFilter = 'all' | 'selected' | 'invalid' | 'duplicates';

const STEP_LABELS = ['File e conto', 'Colonne', 'Anteprima e verifica', 'Completato'];

export function ImportPage() {
  const ds = useDataSet();
  const toast = useToast();
  const batches = useLiveQuery(() => db.import_batches.orderBy('importedAt').reverse().limit(10).toArray(), []);
  const inputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>(1);
  const [accountId, setAccountId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping>(emptyMapping());
  const [opts, setOpts] = useState<Pick<ParseOptions, 'dateFormat' | 'decimal' | 'invertSign'>>({ dateFormat: 'auto', decimal: 'auto', invertSign: false });
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [filter, setFilter] = useState<RowFilter>('all');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ batchId: string; count: number } | null>(null);
  const [undoing, setUndoing] = useState<{ id: string; fileName: string; count: number } | null>(null);

  const account = ds?.accounts.find((a) => a.id === (accountId || ds.accounts[0]?.id));
  const stats = useMemo(() => previewStats(preview), [preview]);
  const check = useMemo(() => statementCheck(preview), [preview]);
  const [useClosing, setUseClosing] = useState(true);
  const linkedToBank = useLiveQuery(async () => (account ? (await db.bank_links.where('accountId').equals(account.id).count()) > 0 : false), [account?.id]);

  if (!ds) return <PageSkeleton />;

  if (ds.accounts.length === 0) {
    return (
      <div className="panel">
        <EmptyState icon={<FileUp size={22} />} title="Serve un conto di destinazione" text="I movimenti importati vengono associati a un conto. Creane uno prima di importare.">
          <button className="btn btn-primary" onClick={() => navigate('accounts', { new: '1' })}>
            Crea un conto
          </button>
        </EmptyState>
      </div>
    );
  }

  const loadFile = async (f: File, sheet?: string) => {
    setError(null);
    setBusy(true);
    try {
      const p = await readStatementFile(f, sheet);
      if (p.rows.filter((r) => r.some((c) => String(c ?? '').trim() !== '')).length < 2) throw new Error('Il file non contiene abbastanza righe da importare.');
      const h = detectHeaderRow(p.rows);
      setFile(f);
      setParsed(p);
      setHeaderRow(h);
      setMapping(guessMapping(p.rows[h] ?? [], p.rows.slice(h + 1, h + 30)));
    } catch (e) {
      setParsed(null);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const headers = parsed ? (parsed.rows[headerRow] ?? []).map((h, i) => String(h ?? '').trim() || `Colonna ${i + 1}`) : [];
  const colCount = parsed ? Math.max(headers.length, ...parsed.rows.slice(headerRow, headerRow + 20).map((r) => r.length)) : 0;
  const mappingErrors = validateMapping(mapping);

  const goPreview = async () => {
    if (!parsed || !account) return;
    setBusy(true);
    try {
      const [existing, categorizer] = await Promise.all([existingFingerprintCounts(account.id), loadCategorizer()]);
      const rows = buildPreview(parsed.rows, headerRow, mapping, { ...opts, accountId: account.id, accountCurrency: account.currency }, {
        categories: ds.categories,
        existingFingerprints: existing,
        categorize: (d, k) => categorizer.categorize(d, k).categoryId,
      });
      setPreview(rows);
      setFilter('all');
      setStep(3);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const confirmImport = async () => {
    if (!account || !parsed) return;
    setBusy(true);
    try {
      const r = await commitImport(preview, account.id, parsed.fileName);
      await recategorizeUncategorized();
      const transfers = await autoLinkTransfers();
      let aligned = false;
      if (useClosing && !linkedToBank && check.closing !== null && check.lastDate) {
        aligned = (await alignBalanceAt(account.id, check.closing, check.lastDate)) !== 0;
      }
      // il riepilogo si mostra solo a operazioni concluse
      setResult(r);
      setStep(4);
      toast.success(`Importati ${r.count} movimenti in ${account.name}.`);
      if (transfers) toast.info(`${transfers} ${transfers === 1 ? 'trasferimento' : 'trasferimenti'} tra i tuoi conti riconosciuti e collegati.`);
      if (aligned) toast.info(`Saldo di ${account.name} allineato al saldo finale dell'estratto (${formatMoney(check.closing!, account.currency)}).`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setStep(1);
    setFile(null);
    setParsed(null);
    setPreview([]);
    setResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const updateRow = (idx: number, patch: Partial<PreviewRow>) => setPreview((p) => p.map((r) => (r.rowIndex === idx ? { ...r, ...patch } : r)));
  const visible = preview.filter((r) =>
    filter === 'all' ? true : filter === 'selected' ? r.selected : filter === 'invalid' ? r.errors.length > 0 : r.duplicate !== 'none',
  );

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Importa estratto conto</h1>
          <p>CSV, XLS, XLSX o PDF. Il file viene letto solo nel browser: nessun dato lascia il dispositivo e nulla viene salvato senza la tua conferma.</p>
        </div>
      </div>

      <ol className="steps" aria-label="Avanzamento importazione" style={{ listStyle: 'none', padding: 0 }}>
        {STEP_LABELS.map((l, i) => (
          <li key={l} className={`step${step === i + 1 ? ' is-active' : step > i + 1 ? ' is-done' : ''}`} aria-current={step === i + 1 ? 'step' : undefined}>
            <b>{i + 1}</b>
            {l}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <section className="panel">
          <div className="form" style={{ maxWidth: 720 }}>
            <div className="field">
              <label htmlFor="imp-acc">Conto di destinazione</label>
              <select id="imp-acc" className="select" value={account?.id} onChange={(e) => setAccountId(e.target.value)}>
                {ds.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
              </select>
            </div>
            <div
              className={`dropzone${over ? ' is-over' : ''}`}
              role="button"
              tabIndex={0}
              aria-label="Seleziona un file da importare"
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                const f = e.dataTransfer.files[0];
                if (f) void loadFile(f);
              }}
            >
              <div className="empty-icon" style={{ margin: '0 auto 12px' }}>
                {busy ? <Upload size={22} /> : <FileSpreadsheet size={22} />}
              </div>
              <div style={{ fontWeight: 500 }}>{busy ? 'Lettura del file…' : file ? file.name : 'Trascina qui il file o fai clic per sceglierlo'}</div>
              <div className="small muted" style={{ marginTop: 4 }}>
                {parsed
                  ? parsed.pdf
                    ? `${parsed.rows.length} righe lette da ${parsed.pdf.pages} ${parsed.pdf.pages === 1 ? 'pagina' : 'pagine'} del PDF`
                    : `${parsed.rows.length} righe lette${parsed.sheet ? ` dal foglio "${parsed.sheet}"` : ''}`
                  : 'CSV (separatore ; , tab o |), XLS, XLSX, PDF con testo · max 20 MB'}
              </div>
              <input
                ref={inputRef}
                data-testid="import-file"
                type="file"
                accept=".csv,.txt,.xls,.xlsx,.pdf,text/csv,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void loadFile(f);
                }}
              />
            </div>
            {parsed && parsed.sheets.length > 1 && (
              <div className="field">
                <label htmlFor="imp-sheet">Foglio di lavoro</label>
                <select id="imp-sheet" className="select" value={parsed.sheet} onChange={(e) => file && void loadFile(file, e.target.value)}>
                  {parsed.sheets.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
            )}
            {error && <Callout kind="danger">{error}</Callout>}
            {parsed?.pdf && (
              <Callout kind={parsed.pdf.aligned ? 'info' : 'warning'}>
                {parsed.pdf.aligned
                  ? 'Tabella ricostruita dalle intestazioni del PDF. Le descrizioni su più righe sono state unite. Controlla colonne e anteprima prima di importare.'
                  : 'Nel PDF non è stata trovata una riga di intestazione riconoscibile: le colonne sono state separate in base agli spazi. Verifica con attenzione l’associazione delle colonne.'}
              </Callout>
            )}
            <div className="actions">
              <button className="btn btn-primary" disabled={!parsed || busy} onClick={() => setStep(2)}>
                Continua con le colonne
              </button>
            </div>
          </div>
        </section>
      )}

      {step === 2 && parsed && (
        <section className="stack">
          <div className="panel">
            <div className="panel-head">
              <h2>Associa le colonne</h2>
              <span className="hint">Riconoscimento automatico applicato: verifica e correggi se serve</span>
            </div>
            <div className="mapping-grid">
              <div className="field">
                <label htmlFor="map-header">Riga di intestazione</label>
                <select
                  id="map-header"
                  className="select"
                  value={headerRow}
                  onChange={(e) => {
                    const h = Number(e.target.value);
                    setHeaderRow(h);
                    setMapping(guessMapping(parsed.rows[h] ?? [], parsed.rows.slice(h + 1, h + 30)));
                  }}
                >
                  {parsed.rows.slice(0, 30).map((r, i) => (
                    <option key={i} value={i}>
                      Riga {i + 1}: {r.slice(0, 3).map((c) => String(c ?? '')).join(' | ').slice(0, 40) || '(vuota)'}
                    </option>
                  ))}
                </select>
              </div>
              {(Object.keys(FIELD_LABELS) as MappableField[]).map((f) => (
                <div className="field" key={f}>
                  <label htmlFor={`map-${f}`}>
                    {FIELD_LABELS[f]}
                    {(f === 'date' || f === 'description') && ' *'}
                  </label>
                  <select id={`map-${f}`} className="select" value={mapping[f]} onChange={(e) => setMapping((m) => ({ ...m, [f]: Number(e.target.value) }))}>
                    <option value={-1}>— Non presente —</option>
                    {Array.from({ length: colCount }, (_, i) => (
                      <option key={i} value={i}>
                        {headers[i] ?? `Colonna ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <div className="field">
                <label htmlFor="opt-date">Formato data</label>
                <select id="opt-date" className="select" value={opts.dateFormat} onChange={(e) => setOpts((o) => ({ ...o, dateFormat: e.target.value as DateFormat }))}>
                  <option value="auto">Automatico</option>
                  <option value="DMY">Giorno/Mese/Anno</option>
                  <option value="MDY">Mese/Giorno/Anno</option>
                  <option value="YMD">Anno-Mese-Giorno</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="opt-dec">Separatore decimale</label>
                <select id="opt-dec" className="select" value={opts.decimal} onChange={(e) => setOpts((o) => ({ ...o, decimal: e.target.value as DecimalSeparator }))}>
                  <option value="auto">Automatico</option>
                  <option value=",">Virgola (1.234,56)</option>
                  <option value=".">Punto (1,234.56)</option>
                </select>
              </div>
            </div>
            <label className="check" style={{ marginTop: 14 }}>
              <input type="checkbox" checked={opts.invertSign} onChange={(e) => setOpts((o) => ({ ...o, invertSign: e.target.checked }))} />
              Inverti il segno degli importi (per estratti in cui le spese sono positive, es. alcune carte di credito)
            </label>
            {mappingErrors.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <Callout kind="warning">{mappingErrors.join(' ')}</Callout>
              </div>
            )}
          </div>
          <div className="panel flush">
            <div className="panel-head">
              <h2>Contenuto del file</h2>
              <span className="hint">Prime 8 righe dopo l'intestazione</span>
            </div>
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="table">
                <thead>
                  <tr>
                    {Array.from({ length: colCount }, (_, i) => {
                      const f = (Object.keys(mapping) as MappableField[]).find((k) => mapping[k] === i);
                      return (
                        <th key={i}>
                          {headers[i] ?? `Colonna ${i + 1}`}
                          {f && <div className="xs" style={{ color: 'var(--sage)' }}>{FIELD_LABELS[f]}</div>}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(headerRow + 1, headerRow + 9).map((r, i) => (
                    <tr key={i}>
                      {Array.from({ length: colCount }, (_, j) => (
                        <td key={j} className="cell-desc">
                          {r[j] instanceof Date ? (r[j] as Date).toLocaleDateString('it-IT') : String(r[j] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="actions">
            <button className="btn btn-ghost" onClick={() => setStep(1)}>
              Indietro
            </button>
            <button className="btn btn-primary" disabled={mappingErrors.length > 0 || busy} onClick={goPreview}>
              Genera anteprima
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="stack">
          <div className="ledger" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))', marginBottom: 0 }}>
            <div className="ledger-cell">
              <div className="ledger-label">Da importare</div>
              <div className="ledger-value num" data-testid="import-selected">
                {stats.selected}
              </div>
              <div className="ledger-sub">su {stats.total} righe lette</div>
            </div>
            <div className="ledger-cell">
              <div className="ledger-label">Righe non valide</div>
              <div className={`ledger-value num ${stats.invalid ? 'neg' : ''}`} data-testid="import-invalid">
                {stats.invalid}
              </div>
              <div className="ledger-sub">Escluse automaticamente</div>
            </div>
            <div className="ledger-cell">
              <div className="ledger-label">Duplicati</div>
              <div className={`ledger-value num ${stats.duplicatesExisting ? 'warn' : ''}`} data-testid="import-duplicates">
                {stats.duplicatesExisting}
              </div>
              <div className="ledger-sub">Già presenti · {stats.duplicatesFile} ripetuti nel file</div>
            </div>
            <div className="ledger-cell">
              <div className="ledger-label">Variazione netta</div>
              <div className="ledger-value num">{formatMoney(stats.income - stats.expense, account?.currency, { sign: true })}</div>
              <div className="ledger-sub">
                Entrate {formatMoney(stats.income, account?.currency)} − uscite {formatMoney(stats.expense, account?.currency)}. Non è il saldo del conto.
              </div>
            </div>
          </div>

          {(check.opening !== null || check.closing !== null) && (
            <div className="stack" style={{ gap: 8 }} data-testid="statement-check">
              {check.difference === null ? (
                <Callout>
                  Nell'estratto è presente solo il saldo {check.opening !== null ? `iniziale (${formatMoney(check.opening, account?.currency)})` : `finale (${formatMoney(check.closing!, account?.currency)})`}: non è possibile verificare che tutti i movimenti siano stati letti.
                </Callout>
              ) : check.difference === 0 ? (
                <Callout>
                  <strong>L'estratto quadra.</strong> Saldo iniziale {formatMoney(check.opening!, account?.currency)} + movimenti {formatMoney(check.net, account?.currency, { sign: true })} = saldo finale {formatMoney(check.closing!, account?.currency)}.
                </Callout>
              ) : (
                <Callout kind="warning">
                  <strong>L'estratto non quadra</strong>: saldo iniziale {formatMoney(check.opening!, account?.currency)} + movimenti {formatMoney(check.net, account?.currency, { sign: true })} ={' '}
                  {formatMoney(check.opening! + check.net, account?.currency)}, ma il saldo finale è {formatMoney(check.closing!, account?.currency)} (differenza {formatMoney(check.difference, account?.currency, { sign: true })}). Controlla le righe non valide: qualche movimento potrebbe non essere stato letto.
                </Callout>
              )}
              {check.closing !== null && check.lastDate && !linkedToBank && (
                <label className="check">
                  <input type="checkbox" checked={useClosing} onChange={(e) => setUseClosing(e.target.checked)} data-testid="use-closing" />
                  Dopo l'importazione, imposta il saldo di {account?.name} al {formatDate(check.lastDate)} a {formatMoney(check.closing, account?.currency)}, come da estratto (corregge il saldo iniziale del conto)
                </label>
              )}
            </div>
          )}

          {stats.duplicatesExisting > 0 && (
            <Callout kind="warning">I movimenti già presenti nel conto (stessa data, importo e descrizione) sono deselezionati. Selezionali solo se sono davvero operazioni distinte.</Callout>
          )}

          <div className="panel flush">
            <div className="spread" style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
              <div className="segmented" role="group" aria-label="Filtra righe">
                {(
                  [
                    ['all', `Tutte (${stats.total})`],
                    ['selected', `Selezionate (${stats.selected})`],
                    ['invalid', `Non valide (${stats.invalid})`],
                    ['duplicates', `Duplicati (${stats.duplicatesExisting + stats.duplicatesFile})`],
                  ] as Array<[RowFilter, string]>
                ).map(([k, l]) => (
                  <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                    {l}
                  </button>
                ))}
              </div>
              <div className="actions">
                <button className="btn btn-sm btn-ghost" onClick={() => setPreview((p) => p.map((r) => ({ ...r, selected: r.errors.length === 0 })))}>
                  Seleziona tutte le valide
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => setPreview((p) => p.map((r) => ({ ...r, selected: false })))}>
                  Deseleziona tutto
                </button>
              </div>
            </div>
            <div className="table-wrap" style={{ maxHeight: 520 }}>
              <table className="table" data-testid="import-preview">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>
                      <span className="sr-only">Importa</span>
                    </th>
                    <th>Riga</th>
                    <th>Data</th>
                    <th>Descrizione</th>
                    <th>Categoria</th>
                    <th className="right">Importo</th>
                    <th>Stato</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.slice(0, 1000).map((r) => (
                    <tr key={r.rowIndex} className={r.errors.length ? 'is-invalid' : r.duplicate === 'existing' ? 'is-dup' : ''}>
                      <td>
                        <input type="checkbox" aria-label={`Importa riga ${r.rowIndex + 1}`} disabled={r.errors.length > 0} checked={r.selected && r.errors.length === 0} onChange={(e) => updateRow(r.rowIndex, { selected: e.target.checked })} />
                      </td>
                      <td className="muted num">{r.rowIndex + 1}</td>
                      <td className="num">{r.date ? formatDate(r.date) : '—'}</td>
                      <td className="cell-desc" title={r.description}>
                        {r.description || '—'}
                      </td>
                      <td>
                        {r.type ? (
                          <select className="select" style={{ height: 30, minWidth: 150, fontSize: 13 }} aria-label={`Categoria riga ${r.rowIndex + 1}`} value={r.categoryId ?? ''} onChange={(e) => updateRow(r.rowIndex, { categoryId: e.target.value })}>
                            {ds.categories
                              .filter((c) => c.kind === r.type)
                              .map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                          </select>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className={`amount ${r.amount && r.amount < 0 ? 'neg' : 'pos'}`}>{r.amount !== null ? formatMoney(r.amount, r.currency, { sign: true }) : '—'}</td>
                      <td>
                        {r.errors.length ? (
                          <span className="badge badge-expense" title={r.errors.join(', ')}>
                            <AlertTriangle size={11} /> {r.errors[0]}
                          </span>
                        ) : r.duplicate === 'existing' ? (
                          <span className="badge badge-warning">Già presente</span>
                        ) : r.duplicate === 'file' ? (
                          <span className="badge badge-warning">Ripetuto nel file</span>
                        ) : (
                          <span className="badge badge-income">Valido</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visible.length > 1000 && <p className="small muted" style={{ padding: 14 }}>Mostrate le prime 1000 righe su {visible.length}. Le selezioni valgono per tutte.</p>}
              {visible.length === 0 && <p className="small muted" style={{ padding: 20, textAlign: 'center' }}>Nessuna riga per questo filtro.</p>}
            </div>
          </div>
          <div className="actions">
            <button className="btn btn-ghost" onClick={() => setStep(2)}>
              Indietro
            </button>
            <button className="btn btn-primary" disabled={stats.selected === 0 || busy} onClick={confirmImport} data-testid="import-confirm">
              Importa {stats.selected} movimenti in {account?.name}
            </button>
          </div>
        </section>
      )}

      {step === 4 && result && (
        <section className="panel">
          <EmptyState icon={<CheckCircle2 size={22} />} title={`${result.count} movimenti importati`} text={`Sono stati aggiunti a "${account?.name}". Se qualcosa non torna puoi annullare l'intera importazione.`}>
            <button className="btn btn-primary" onClick={() => navigate('transactions', { account: account?.id ?? '' })}>
              Vedi i movimenti
            </button>
            <button className="btn" onClick={reset}>
              Importa un altro file
            </button>
            <button className="btn btn-ghost" onClick={() => setUndoing({ id: result.batchId, fileName: parsed?.fileName ?? '', count: result.count })}>
              <RotateCcw size={15} /> Annulla importazione
            </button>
          </EmptyState>
        </section>
      )}

      {batches && batches.length > 0 && step !== 3 && (
        <section className="panel flush" style={{ marginTop: 20 }}>
          <div className="panel-head">
            <h2>Importazioni recenti</h2>
          </div>
          <div className="item-list" style={{ marginTop: 8 }}>
            {batches.map((b) => (
              <div className="item" key={b.id}>
                <div className="item-icon">
                  <History size={16} />
                </div>
                <div>
                  <div className="item-title">{b.fileName}</div>
                  <div className="item-meta">
                    {b.count} movimenti · {ds.accounts.find((a) => a.id === b.accountId)?.name ?? 'conto eliminato'} · {new Date(b.importedAt).toLocaleString('it-IT')}
                  </div>
                </div>
                <button className="btn btn-sm btn-ghost" onClick={() => setUndoing({ id: b.id, fileName: b.fileName, count: b.count })}>
                  Annulla
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {undoing && (
        <ConfirmDialog
          title="Annullare l'importazione?"
          message={`Verranno eliminati i movimenti importati da "${undoing.fileName}" (${undoing.count}). Le modifiche fatte a mano su quei movimenti andranno perse.`}
          confirmLabel="Annulla importazione"
          onClose={() => setUndoing(null)}
          onConfirm={async () => {
            try {
              const n = await undoImport(undoing.id);
              toast.success(`Importazione annullata: ${n} movimenti rimossi.`);
              if (result?.batchId === undoing.id) reset();
            } catch (e) {
              toast.error(e);
            }
          }}
        />
      )}
    </div>
  );
}
