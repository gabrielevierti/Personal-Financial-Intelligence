import { useEffect, useRef, useState } from 'react';
import { DatabaseBackup, Download, HardDrive, Lock, Plus, ShieldAlert, Trash2, Upload, X } from 'lucide-react';
import { useDataSet } from '../../hooks/useData';
import { errorMessage, useToast } from '../../hooks/useToast';
import { backupFileName, createBackup, parseBackupText, restoreBackup, type BackupValidation } from '../../services/backup';
import { downloadText, transactionsToCsv } from '../../services/exporters';
import { saveSettings, wipeAllData } from '../../services/repository';
import { CURRENCIES } from '../../utils/money';
import { Callout, PageSkeleton } from '../../components/ui/States';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Modal } from '../../components/ui/Modal';
import { PlanningSettings, ResearchSettings } from './ExtraSettings';

const TABLE_LABELS: Record<string, string> = {
  accounts: 'Conti',
  transactions: 'Movimenti',
  categories: 'Categorie',
  budgets: 'Budget',
  savings_goals: 'Obiettivi',
  assets: 'Asset',
  asset_valuations: 'Valutazioni asset',
  settings: 'Impostazioni',
  import_batches: 'Importazioni',
};

export function SettingsPage({ mode = 'settings' }: { mode?: 'settings' | 'backup' }) {
  const ds = useDataSet();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [restore, setRestore] = useState<{ name: string; v: BackupValidation } | null>(null);
  const [wipeStep, setWipeStep] = useState<0 | 1 | 2>(0);
  const [base, setBase] = useState('EUR');
  const [rates, setRates] = useState<Array<{ code: string; rate: string }>>([]);
  const [storage, setStorage] = useState<{ usage?: number; quota?: number; persisted?: boolean } | null>(null);

  useEffect(() => {
    if (!ds) return;
    setBase(ds.settings.baseCurrency);
    setRates(Object.entries(ds.settings.exchangeRates).map(([code, rate]) => ({ code, rate: String(rate).replace('.', ',') })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ds?.settings]);

  useEffect(() => {
    (async () => {
      try {
        const est = await navigator.storage?.estimate?.();
        const persisted = await navigator.storage?.persisted?.();
        setStorage({ usage: est?.usage, quota: est?.quota, persisted });
      } catch {
        setStorage({});
      }
    })();
  }, []);

  if (!ds) return <PageSkeleton />;

  const usedCurrencies = Array.from(new Set([...ds.accounts.map((a) => a.currency), ...ds.assets.map((a) => a.currency)])).filter((c) => c !== base);
  const missing = usedCurrencies.filter((c) => !rates.some((r) => r.code === c));

  const saveCurrency = async () => {
    try {
      const map: Record<string, number> = {};
      for (const r of rates) {
        const n = Number(r.rate.replace(',', '.'));
        if (!r.code) continue;
        if (!Number.isFinite(n) || n <= 0) throw new Error(`Tasso non valido per ${r.code}.`);
        map[r.code] = n;
      }
      await saveSettings({ baseCurrency: base, exchangeRates: map });
      toast.success('Impostazioni valuta salvate.');
    } catch (e) {
      toast.error(e);
    }
  };

  const doExport = async () => {
    try {
      const b = await createBackup();
      downloadText(JSON.stringify(b, null, 2), backupFileName(), 'application/json');
      toast.success(`Backup esportato: ${b.counts.transactions} movimenti, ${b.counts.accounts} conti.`);
    } catch (e) {
      toast.error(e);
    }
  };

  const onPickBackup = async (f: File) => {
    try {
      if (f.size > 100 * 1024 * 1024) throw new Error('File troppo grande per essere un backup PFI.');
      const text = await f.text();
      setRestore({ name: f.name, v: parseBackupText(text) });
    } catch (e) {
      toast.error(e);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const fmtBytes = (n?: number) => (n === undefined ? '—' : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{mode === 'backup' ? 'Backup e ripristino' : 'Impostazioni'}</h1>
          <p>{mode === 'backup' ? "Copia di sicurezza dei dati, archivio locale e cancellazione." : 'Valuta, pianificazione, profilo di rischio, fonti di dati di mercato e privacy.'}</p>
        </div>
        {mode === 'settings' && (
          <div className="actions">
            <a className="btn" href="#/backup">
              <DatabaseBackup size={15} /> Backup e ripristino
            </a>
          </div>
        )}
      </div>

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="stack">
          {mode === 'backup' && (
<section className="panel">
            <div className="panel-head">
              <h2>
                <DatabaseBackup size={16} style={{ verticalAlign: -3, marginRight: 8 }} />
                Backup e ripristino
              </h2>
            </div>
            <div className="stack" style={{ gap: 12 }}>
              <p className="small muted">
                Il backup è un file JSON con tutti i dati, la versione del formato e un'impronta SHA-256 per verificarne l'integrità. Il file <strong>non è cifrato</strong>: conservalo in un posto sicuro.
              </p>
              <div className="actions">
                <button className="btn btn-primary" onClick={doExport} data-testid="backup-export">
                  <Download size={15} /> Esporta backup JSON
                </button>
                <button className="btn" onClick={() => fileRef.current?.click()}>
                  <Upload size={15} /> Ripristina da backup
                </button>
                <input ref={fileRef} type="file" accept=".json,application/json" hidden data-testid="backup-file" onChange={(e) => e.target.files?.[0] && void onPickBackup(e.target.files[0])} />
              </div>
              <div className="actions">
                <button
                  className="btn btn-ghost"
                  disabled={ds.transactions.length === 0}
                  onClick={() => {
                    downloadText(transactionsToCsv(ds.transactions, ds.accounts, ds.categories), 'pfi-tutti-i-movimenti.csv', 'text/csv;charset=utf-8');
                    toast.success(`Esportati ${ds.transactions.length} movimenti in CSV.`);
                  }}
                >
                  <Download size={15} /> Esporta tutti i movimenti in CSV
                </button>
              </div>
            </div>
          </section>
)}

          {mode === 'settings' && <PlanningSettings />}
          {mode === 'settings' && (
<section className="panel">
            <div className="panel-head">
              <h2>
                <Lock size={16} style={{ verticalAlign: -3, marginRight: 8 }} />
                Privacy
              </h2>
            </div>
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
              <li>I dati sono salvati nel database IndexedDB di questo browser, su questo dispositivo.</li>
              <li>PFI non usa server, account né analytics: la pagina blocca ogni connessione verso altri domini.</li>
              <li>Unica eccezione, facoltativa: i collegamenti bancari passano dal bridge che gira sul tuo computer, che contatta Enable Banking in sola lettura. La chiave dell'applicazione resta nel bridge e non entra mai nel browser.</li>
              <li>I dati non sono cifrati dall'app. Sono protetti come gli altri dati del browser: usa la cifratura del disco e un blocco schermo sul dispositivo.</li>
              <li>Cancellare i dati di navigazione del sito elimina anche i dati di PFI: esporta backup regolari.</li>
            </ul>
          </section>
)}

          {mode === 'backup' && (
<section className="panel">
            <div className="panel-head">
              <h2>
                <HardDrive size={16} style={{ verticalAlign: -3, marginRight: 8 }} />
                Archivio locale
              </h2>
            </div>
            <dl className="kv">
              <dt>Conti</dt>
              <dd>{ds.accounts.length}</dd>
              <dt>Movimenti</dt>
              <dd>{ds.transactions.length}</dd>
              <dt>Asset</dt>
              <dd>{ds.assets.length}</dd>
              <dt>Spazio usato dal sito</dt>
              <dd>{fmtBytes(storage?.usage)}</dd>
              <dt>Archiviazione persistente</dt>
              <dd>{storage?.persisted === undefined ? 'Non disponibile' : storage.persisted ? 'Attiva' : 'Non attiva'}</dd>
            </dl>
            {storage?.persisted === false && navigator.storage?.persist && (
              <button
                className="btn btn-sm"
                style={{ marginTop: 12 }}
                onClick={async () => {
                  const ok = await navigator.storage.persist();
                  setStorage((s) => ({ ...s, persisted: ok }));
                  if (ok) toast.success('Archiviazione persistente attivata.');
                  else toast.info('Il browser non ha concesso l’archiviazione persistente. Installa l’app o esporta backup regolari.');
                }}
              >
                Richiedi archiviazione persistente
              </button>
            )}
          </section>
)}
        </div>

        <div className="stack">
          {mode === 'settings' && (
<section className="panel">
            <div className="panel-head">
              <h2>Valuta e tassi di cambio</h2>
            </div>
            <div className="form">
              <div className="field">
                <label htmlFor="s-base">Valuta di riferimento</label>
                <select id="s-base" className="select" value={base} onChange={(e) => setBase(e.target.value)}>
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <span className="help">Dashboard e report sono espressi in questa valuta.</span>
              </div>
              <div className="field">
                <span className="field-label">Tassi manuali (1 unità di valuta = X {base})</span>
                {rates.length === 0 && <span className="help">Nessun tasso impostato.</span>}
                {rates.map((r, i) => (
                  <div className="row" key={i} style={{ gap: 8 }}>
                    <select className="select" style={{ width: 110 }} aria-label="Valuta" value={r.code} onChange={(e) => setRates(rates.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))}>
                      {CURRENCIES.filter((c) => c !== base).map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                    <input className="input input-money" inputMode="decimal" aria-label={`Tasso ${r.code}`} value={r.rate} onChange={(e) => setRates(rates.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} />
                    <button className="btn btn-ghost icon-btn" aria-label={`Rimuovi ${r.code}`} onClick={() => setRates(rates.filter((_, j) => j !== i))}>
                      <X size={15} />
                    </button>
                  </div>
                ))}
                <div>
                  <button className="btn btn-sm" onClick={() => setRates([...rates, { code: missing[0] ?? CURRENCIES.find((c) => c !== base && !rates.some((r) => r.code === c)) ?? 'USD', rate: '1' }])}>
                    <Plus size={13} /> Aggiungi tasso
                  </button>
                </div>
              </div>
              {missing.length > 0 && <Callout kind="warning">Valute in uso senza tasso: {missing.join(', ')}. I relativi importi non entrano nei totali.</Callout>}
              <div>
                <button className="btn btn-primary" onClick={saveCurrency}>
                  Salva impostazioni valuta
                </button>
              </div>
            </div>
          </section>
)}

          {mode === 'settings' && <ResearchSettings />}
          {mode === 'backup' && (
<section className="panel" style={{ borderColor: 'rgba(227,109,97,.35)' }}>
            <div className="panel-head">
              <h2>
                <ShieldAlert size={16} style={{ verticalAlign: -3, marginRight: 8, color: 'var(--danger)' }} />
                Cancella tutti i dati
              </h2>
            </div>
            <p className="small muted" style={{ marginBottom: 12 }}>
              Elimina definitivamente da questo dispositivo conti, movimenti, budget, obiettivi, asset e impostazioni. Le categorie predefinite vengono ricreate. Esporta prima un backup se vuoi conservare i dati.
            </p>
            <button className="btn btn-danger" onClick={() => setWipeStep(1)} data-testid="wipe-start">
              <Trash2 size={15} /> Cancella tutti i dati
            </button>
          </section>
)}
        </div>
      </div>

      {restore && (
        <Modal
          title="Ripristina backup"
          onClose={() => setRestore(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setRestore(null)}>
                Annulla
              </button>
              <button
                className="btn btn-danger solid"
                disabled={!restore.v.ok}
                data-testid="restore-confirm"
                onClick={async () => {
                  try {
                    await restoreBackup(restore.v.backup!);
                    toast.success('Backup ripristinato.');
                    setRestore(null);
                  } catch (e) {
                    toast.error(errorMessage(e));
                  }
                }}
              >
                Sostituisci i dati attuali
              </button>
            </>
          }
        >
          <div className="stack">
            <p className="small">
              File: <strong>{restore.name}</strong>
            </p>
            {restore.v.ok && restore.v.backup ? (
              <>
                <Callout kind="warning">Il ripristino sostituisce <strong>tutti</strong> i dati presenti ({ds.accounts.length} conti, {ds.transactions.length} movimenti). L'operazione non si può annullare.</Callout>
                <dl className="kv">
                  <dt>Creato il</dt>
                  <dd>{new Date(restore.v.backup.exportedAt).toLocaleString('it-IT')}</dd>
                  <dt>Formato</dt>
                  <dd>
                    v{restore.v.backup.version} · schema {restore.v.backup.schemaVersion}
                  </dd>
                  <dt>Integrità</dt>
                  <dd className="pos">Verificata (SHA-256)</dd>
                  {Object.entries(restore.v.backup.counts ?? {}).map(([k, n]) => (
                    <FragmentKV key={k} k={TABLE_LABELS[k] ?? k} v={String(n)} />
                  ))}
                </dl>
                {restore.v.warnings.map((w) => (
                  <Callout key={w}>{w}</Callout>
                ))}
              </>
            ) : (
              <Callout kind="danger">
                Il file non può essere ripristinato:
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {restore.v.errors.slice(0, 8).map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </Callout>
            )}
          </div>
        </Modal>
      )}

      {wipeStep === 1 && (
        <ConfirmDialog
          title="Cancellare tutti i dati?"
          message={`Stai per eliminare ${ds.accounts.length} conti, ${ds.transactions.length} movimenti, ${ds.assets.length} asset e tutte le impostazioni. Hai esportato un backup?`}
          confirmLabel="Continua"
          onClose={() => setWipeStep((s) => (s === 1 ? 0 : s))}
          onConfirm={() => setWipeStep(2)}
        />
      )}
      {wipeStep === 2 && (
        <ConfirmDialog
          title="Conferma definitiva"
          message="Questa è la seconda e ultima conferma. I dati non potranno essere recuperati senza un backup."
          confirmLabel="Elimina definitivamente"
          requireText="ELIMINA"
          onClose={() => setWipeStep(0)}
          onConfirm={async () => {
            try {
              await wipeAllData();
              toast.success('Tutti i dati sono stati eliminati.');
            } catch (e) {
              toast.error(e);
            }
          }}
        />
      )}
    </div>
  );
}

function FragmentKV({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}
