import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, ExternalLink, Landmark, Link2, Link2Off, PlugZap, RefreshCw, Scale, Search, ShieldCheck, Unplug } from 'lucide-react';
import { db } from '../../database/db';
import { useDataSet } from '../../hooks/useData';
import { errorMessage, useToast } from '../../hooks/useToast';
import { BridgeClient, parseCallback, type Aspsp, type BridgeHealth } from '../../services/bank/client';
import { balanceLabel, compareBalance, isBookedBalance, pickBalance } from '../../services/bank/mapping';
import {
  alignAccountBalance,
  applyLinkChoices,
  chooseReferenceBalance,
  getPendingAuth,
  revokeConnection,
  saveSession,
  setPendingAuth,
  suggestedSyncFrom,
  syncAll,
  syncLink,
  unlinkBankAccount,
  type LinkChoice,
  type SyncResult,
} from '../../services/bank/sync';
import type { BankConnection, BankLink } from '../../types';
import { autoLinkTransfers, getOwnerNames, setOwnerNames } from '../../services/transfers';
import { formatDate, todayISO } from '../../utils/date';
import { uid } from '../../utils/id';
import { formatMoney } from '../../utils/money';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Callout, EmptyState, PageSkeleton } from '../../components/ui/States';

export const BANK_CALLBACK_KEY = 'pfi.bankCallback';

const COUNTRIES: Array<[string, string]> = [
  ['IT', 'Italia'], ['DE', 'Germania'], ['FR', 'Francia'], ['ES', 'Spagna'], ['NL', 'Paesi Bassi'], ['BE', 'Belgio'], ['AT', 'Austria'],
  ['PT', 'Portogallo'], ['IE', 'Irlanda'], ['FI', 'Finlandia'], ['SE', 'Svezia'], ['DK', 'Danimarca'], ['NO', 'Norvegia'], ['PL', 'Polonia'],
  ['LT', 'Lituania'], ['LV', 'Lettonia'], ['EE', 'Estonia'], ['GB', 'Regno Unito'],
];

function resultMessage(results: SyncResult[]): { ok: boolean; text: string } {
  const errors = results.filter((r) => r.error);
  if (errors.length && errors.length === results.length) return { ok: false, text: errors[0].error! };
  const added = results.reduce((s, r) => s + r.added, 0);
  const corrected = results.reduce((s, r) => s + r.corrected + r.removed, 0);
  const transfers = results.reduce((s, r) => s + (r.transfersLinked ?? 0), 0);
  const parts = [added === 0 ? 'nessun nuovo movimento' : `${added} nuovi movimenti`];
  if (corrected) parts.push(`${corrected} movimenti corretti con i dati della banca`);
  if (transfers) parts.push(`${transfers} ${transfers === 1 ? 'trasferimento' : 'trasferimenti'} tra i tuoi conti riconosciuti`);
  const base = `Sincronizzazione completata: ${parts.join(', ')}.`;
  return { ok: errors.length === 0, text: errors.length ? `${base} ${errors.length} conti con errori: ${errors[0].error}` : base };
}

export function BanksPage() {
  const ds = useDataSet();
  const toast = useToast();
  const connections = useLiveQuery(() => db.bank_connections.toArray(), []);
  const links = useLiveQuery(() => db.bank_links.toArray(), []);
  const bridgeUrl = useLiveQuery(async () => ((await db.settings.get('bridgeUrl'))?.value as string | undefined) ?? 'http://127.0.0.1:8787', []);
  const autoSync = useLiveQuery(async () => ((await db.settings.get('bankAutoSync'))?.value as boolean | undefined) ?? true, []);
  const client = useMemo(() => (bridgeUrl ? new BridgeClient(bridgeUrl) : null), [bridgeUrl]);

  const [health, setHealth] = useState<BridgeHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [connectFor, setConnectFor] = useState<{ aspsp?: { name: string; country: string } } | null>(null);
  const [linking, setLinking] = useState<BankLink[] | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'align' | 'unlink' | 'revoke'; link?: BankLink; connection?: BankConnection } | null>(null);
  const [bridgeDraft, setBridgeDraft] = useState('');

  const check = useCallback(async () => {
    if (!client) return;
    setChecking(true);
    setHealthError(null);
    try {
      setHealth(await client.health(true));
    } catch (e) {
      setHealth(null);
      setHealthError(errorMessage(e));
    } finally {
      setChecking(false);
    }
  }, [client]);

  useEffect(() => {
    void check();
  }, [check]);

  useEffect(() => {
    if (bridgeUrl) setBridgeDraft(bridgeUrl);
  }, [bridgeUrl]);

  /** Completa l'autorizzazione a partire dal codice restituito dalla banca. */
  const completeAuth = useCallback(
    async (input: string) => {
      if (!client) return false;
      const parsed = parseCallback(input);
      if (!parsed) {
        toast.error('Indirizzo non riconosciuto: incolla l’indirizzo completo della pagina a cui ti ha portato la banca (contiene "code=").');
        return false;
      }
      if (parsed.error) {
        toast.error(`La banca ha annullato l'autorizzazione: ${parsed.error}`);
        return false;
      }
      const pending = await getPendingAuth();
      if (parsed.state && pending && parsed.state !== pending.state) {
        toast.error('Il codice non corrisponde all’ultima richiesta di collegamento. Ripeti il collegamento.');
        return false;
      }
      try {
        const session = await client.createSession(parsed.code);
        const saved = await saveSession(session);
        await setPendingAuth(null);
        toast.success(`${session.aspsp.name} collegata: ${saved.length} ${saved.length === 1 ? 'conto' : 'conti'} disponibili.`);
        setConnectFor(null);
        setLinking(saved);
        return true;
      } catch (e) {
        toast.error(e);
        return false;
      }
    },
    [client, toast],
  );

  // ritorno automatico dalla banca (redirect verso questa app)
  useEffect(() => {
    const pending = sessionStorage.getItem(BANK_CALLBACK_KEY);
    if (pending && client) {
      sessionStorage.removeItem(BANK_CALLBACK_KEY);
      void completeAuth(pending);
    }
  }, [client, completeAuth]);

  if (!ds || !connections || !links || bridgeUrl === undefined || autoSync === undefined) return <PageSkeleton />;

  const ready = !!health?.ok;
  const accounts = new Map(ds.accounts.map((a) => [a.id, a]));

  const runSyncAll = async () => {
    if (!client) return;
    setSyncing('all');
    try {
      const r = resultMessage(await syncAll(client));
      if (r.ok) toast.success(r.text);
      else toast.error(r.text);
    } catch (e) {
      toast.error(e);
    } finally {
      setSyncing(null);
    }
  };

  const runSyncOne = async (link: BankLink) => {
    if (!client) return;
    setSyncing(link.id);
    try {
      const r = await syncLink(client, link);
      r.transfersLinked = await autoLinkTransfers();
      toast.success(resultMessage([r]).text);
    } catch (e) {
      if (e instanceof Error && 'sessionExpired' in e && (e as { sessionExpired: boolean }).sessionExpired) await db.bank_connections.update(link.connectionId, { status: 'expired', lastError: e.message });
      toast.error(e);
    } finally {
      setSyncing(null);
    }
  };

  const linked = links.filter((l) => l.accountId);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Collegamenti bancari</h1>
          <p>Saldi e movimenti scaricati automaticamente in sola lettura tramite Enable Banking. Nessun pagamento è possibile, e i dati restano su questo dispositivo.</p>
        </div>
        <div className="actions">
          {linked.length > 0 && (
            <button className="btn" disabled={!ready || syncing !== null} onClick={runSyncAll} data-testid="sync-all">
              <RefreshCw size={15} className={syncing === 'all' ? 'spin' : undefined} /> {syncing === 'all' ? 'Sincronizzazione…' : 'Sincronizza ora'}
            </button>
          )}
          <button className="btn btn-primary" disabled={!ready} onClick={() => setConnectFor({})} data-testid="connect-bank">
            <PlugZap size={16} /> Collega una banca
          </button>
        </div>
      </div>

      <section className="panel" style={{ marginBottom: 16 }} data-testid="bridge-status">
        <div className="spread" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div className="item-icon" style={{ color: ready ? 'var(--income)' : 'var(--warning)' }}>
              {ready ? <ShieldCheck size={18} /> : <Unplug size={18} />}
            </div>
            <div>
              <div className="item-title">{checking ? 'Verifica del bridge…' : ready ? 'Bridge pronto' : healthError ? 'Bridge non raggiungibile' : 'Bridge da configurare'}</div>
              <div className="small muted">
                {ready
                  ? `Applicazione "${health?.application?.name ?? health?.applicationId}"${health?.application?.environment ? ` · ${health.application.environment === 'SANDBOX' ? 'sandbox (dati di prova)' : 'produzione'}` : ''} · ${bridgeUrl}`
                  : healthError ?? health?.problems.join(' ')}
              </div>
            </div>
          </div>
          <button className="btn btn-sm" onClick={check} disabled={checking}>
            <RefreshCw size={13} /> Ricontrolla
          </button>
        </div>
        {!ready && !checking && <SetupGuide />}
      </section>

      {connections.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<Landmark size={22} />}
            title="Nessuna banca collegata"
            text={ready ? 'Collega la tua banca per scaricare saldi e movimenti senza inserirli a mano.' : 'Completa prima la configurazione del bridge qui sopra.'}
          >
            {ready && (
              <button className="btn btn-primary" onClick={() => setConnectFor({})}>
                <PlugZap size={16} /> Collega una banca
              </button>
            )}
          </EmptyState>
        </div>
      ) : (
        <div className="stack">
          {connections.map((c) => {
            const expiresIn = Math.round((new Date(c.validUntil).getTime() - Date.now()) / 86400000);
            const expired = c.status !== 'active' || expiresIn < 0;
            const own = links.filter((l) => l.connectionId === c.id);
            return (
              <section className="panel flush" key={c.id} data-testid="bank-connection">
                <div className="spread" style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
                  <div className="row">
                    <div className="item-icon">
                      <Landmark size={18} />
                    </div>
                    <div>
                      <div className="item-title">{c.aspspName}</div>
                      <div className="xs muted">
                        {expired ? (
                          <span className="neg">Consenso scaduto o revocato{c.lastError ? ` · ${c.lastError}` : ''}</span>
                        ) : (
                          <span className={expiresIn <= 7 ? 'warn' : undefined}>
                            Consenso valido fino al {formatDate(c.validUntil.slice(0, 10))} ({expiresIn} giorni)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="actions">
                    {(expired || expiresIn <= 14) && (
                      <button className="btn btn-sm btn-primary" disabled={!ready} onClick={() => setConnectFor({ aspsp: { name: c.aspspName, country: c.aspspCountry } })}>
                        Rinnova consenso
                      </button>
                    )}
                    <button className="btn btn-sm btn-ghost" onClick={() => setLinking(own)}>
                      <Link2 size={13} /> Associazioni
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => setConfirm({ kind: 'revoke', connection: c })}>
                      Revoca
                    </button>
                  </div>
                </div>
                <div className="item-list">
                  {own.map((l) => {
                    const acc = l.accountId ? accounts.get(l.accountId) : undefined;
                    const cmp = acc ? compareBalance(l, acc.initialBalance, ds.transactions.filter((t) => t.accountId === acc.id)) : null;
                    const diff = cmp?.difference ?? null;
                    const pendingN = l.pendingCount ?? 0;
                    return (
                      <div className="item" key={l.id} style={{ gridTemplateColumns: '1fr auto', alignItems: 'start' }} data-testid="bank-link">
                        <div style={{ minWidth: 0 }}>
                          <div className="item-title">
                            {l.name} <span className="muted xs num">{l.iban ? `· ${l.iban.replace(/(.{4})/g, '$1 ').trim()}` : ''}</span>
                          </div>
                          <div className="item-meta">
                            {acc ? (
                              <>
                                Sincronizzato con <strong style={{ color: 'var(--text-2)' }}>{acc.name}</strong>
                                {l.lastSyncAt ? ` · ultima sincronizzazione ${new Date(l.lastSyncAt).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}` : ` · in attesa della prima sincronizzazione (dal ${formatDate(l.syncFrom)})`}
                              </>
                            ) : (
                              'Non associato: i movimenti di questo conto non vengono scaricati.'
                            )}
                          </div>
                          {acc && cmp && (
                            <div className="small" style={{ marginTop: 6 }} data-testid="balance-compare">
                              Banca <strong className="num">{formatMoney(cmp.bank, l.currency)}</strong>
                              <span className="muted"> ({balanceLabel({ type: l.bankBalanceType ?? '', name: l.bankBalances?.find((b) => b.key === (l.balanceKey ?? pickBalance(l.bankBalances ?? [])?.key))?.name ?? '' })})</span> · PFI{' '}
                              <strong className="num">{formatMoney(cmp.ours, acc.currency)}</strong>
                              {pendingN > 0 && <span className="muted">{cmp.includesPending ? ' con' : ' senza'} i movimenti in attesa</span>}{' '}
                              {diff === 0 ? (
                                <span className="pos">
                                  <CheckCircle2 size={12} style={{ verticalAlign: -2 }} /> allineati
                                </span>
                              ) : (
                                <span className="warn" data-testid="balance-diff">
                                  differenza {formatMoney(diff!, acc.currency, { sign: true })}
                                </span>
                              )}
                            </div>
                          )}
                          {acc && pendingN > 0 && (
                            <div className="small muted" style={{ marginTop: 4 }} data-testid="pending-info">
                              {pendingN} {pendingN === 1 ? 'movimento in attesa' : 'movimenti in attesa'} ({formatMoney(l.pendingAmount ?? 0, acc.currency, { sign: true })}), inclusi nel saldo di PFI:{' '}
                              <strong className="num" style={{ color: 'var(--text-2)' }}>
                                {formatMoney(cmp?.oursWithPending ?? 0, acc.currency)}
                              </strong>{' '}
                              disponibili.
                            </div>
                          )}
                          {acc && (l.bankBalances?.length ?? 0) > 0 && <BalancesDetail link={l} currency={acc.currency} />}
                        </div>
                        <div className="actions">
                          {acc && diff !== null && diff !== 0 && (
                            <button className="btn btn-sm" onClick={() => setConfirm({ kind: 'align', link: l })} data-testid="align-balance">
                              <Scale size={13} /> Allinea saldo
                            </button>
                          )}
                          {acc && (
                            <button className="btn btn-sm" disabled={!ready || expired || syncing !== null} onClick={() => runSyncOne(l)}>
                              <RefreshCw size={13} /> Sincronizza
                            </button>
                          )}
                          {acc && (
                            <button className="btn btn-sm btn-ghost" aria-label={`Scollega ${l.name}`} onClick={() => setConfirm({ kind: 'unlink', link: l })}>
                              <Link2Off size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head">
          <h2>Opzioni</h2>
        </div>
        <div className="form" style={{ maxWidth: 560 }}>
          <label className="check">
            <input type="checkbox" checked={autoSync} onChange={(e) => db.settings.put({ key: 'bankAutoSync', value: e.target.checked })} />
            Sincronizza automaticamente all'apertura dell'app (al massimo ogni 6 ore, per rispettare i limiti di accesso delle banche)
          </label>
          <OwnerNamesField />
          <div className="field">
            <label htmlFor="bridge-url">Indirizzo del bridge</label>
            <div className="row">
              <input id="bridge-url" className="input" value={bridgeDraft} onChange={(e) => setBridgeDraft(e.target.value)} />
              <button
                className="btn"
                disabled={!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(bridgeDraft.trim()) || bridgeDraft.trim() === bridgeUrl}
                onClick={async () => {
                  await db.settings.put({ key: 'bridgeUrl', value: bridgeDraft.trim().replace(/\/$/, '') });
                  toast.success('Indirizzo del bridge salvato.');
                }}
              >
                Salva
              </button>
            </div>
            <span className="help">Solo indirizzi locali (127.0.0.1 o localhost). Predefinito: http://127.0.0.1:8787</span>
          </div>
        </div>
      </section>

      {connectFor && client && health && (
        <ConnectModal client={client} redirectUrl={health.redirectUrl ?? ''} initial={connectFor.aspsp} onClose={() => setConnectFor(null)} onCode={completeAuth} />
      )}
      {linking && (
        <LinkModal
          links={linking}
          onClose={() => setLinking(null)}
          onSaved={async () => {
            setLinking(null);
            if (client && ready) await runSyncAll();
          }}
        />
      )}
      {confirm?.kind === 'align' && confirm.link && (() => {
        const acc = accounts.get(confirm.link.accountId!)!;
        const cmp = compareBalance(confirm.link, acc.initialBalance, ds.transactions.filter((t) => t.accountId === acc.id));
        return (
          <ConfirmDialog
            danger={false}
            title="Allineare il saldo a quello della banca?"
            message={`Il saldo iniziale di "${acc.name}" verrà corretto di ${formatMoney(cmp?.difference ?? 0, acc.currency, { sign: true })}, così che il saldo in PFI coincida con il ${balanceLabel({ type: confirm.link.bankBalanceType ?? '', name: '' })} della banca (${formatMoney(cmp?.bank ?? 0, acc.currency)}). I movimenti non vengono modificati. Fallo solo dopo aver verificato che il saldo di riferimento scelto sia quello giusto.`}
            confirmLabel="Allinea saldo"
            onClose={() => setConfirm(null)}
            onConfirm={async () => {
              const d = await alignAccountBalance(acc.id);
              toast.success(`Saldo allineato (correzione di ${formatMoney(d, acc.currency, { sign: true })}).`);
            }}
          />
        );
      })()}
      {confirm?.kind === 'unlink' && confirm.link && (
        <ConfirmDialog
          title="Scollegare questo conto?"
          message="PFI smetterà di scaricare i movimenti di questo conto. I movimenti già importati restano."
          confirmLabel="Scollega"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await unlinkBankAccount(confirm.link!.id);
            toast.success('Conto scollegato.');
          }}
        />
      )}
      {confirm?.kind === 'revoke' && confirm.connection && client && (
        <ConfirmDialog
          title={`Revocare l'accesso a ${confirm.connection.aspspName}?`}
          message="Il consenso viene chiuso presso Enable Banking e la banca. I movimenti già importati restano in PFI."
          confirmLabel="Revoca accesso"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            try {
              await revokeConnection(client, confirm.connection!.id);
              toast.success('Accesso revocato.');
            } catch (e) {
              toast.error(e);
            }
          }}
        />
      )}
    </div>
  );
}

function OwnerNamesField() {
  const toast = useToast();
  const stored = useLiveQuery(() => getOwnerNames(), []);
  const [draft, setDraft] = useState<string | null>(null);
  if (stored === undefined) return null;
  const value = draft ?? stored.join(', ');
  return (
    <div className="field">
      <label htmlFor="owner-names">Intestatario dei conti</label>
      <div className="row">
        <input id="owner-names" className="input" placeholder="Es. Mario Rossi" value={value} onChange={(e) => setDraft(e.target.value)} />
        <button
          className="btn"
          disabled={draft === null}
          onClick={async () => {
            await setOwnerNames(value.split(','));
            setDraft(null);
            const n = await autoLinkTransfers();
            toast.success(n ? `Salvato. ${n} trasferimenti tra i tuoi conti riconosciuti.` : 'Intestatario salvato.');
          }}
        >
          Salva
        </button>
      </div>
      <span className="help">Serve a riconoscere i bonifici che fai a te stesso tra i tuoi conti, che diventano trasferimenti e non contano come entrate o uscite. Più nomi separati da virgola.</span>
    </div>
  );
}

function BalancesDetail({ link, currency }: { link: BankLink; currency: string }) {
  const toast = useToast();
  const auto = pickBalance(link.bankBalances ?? []);
  const stored = link.balanceKey ?? auto?.key ?? null;
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const current = optimistic ?? stored;
  useEffect(() => {
    setOptimistic(null);
  }, [stored]);
  return (
    <details style={{ marginTop: 8 }}>
      <summary className="xs" style={{ cursor: 'pointer', color: 'var(--sage-strong)' }}>
        Saldi forniti dalla banca ({link.bankBalances!.length}) · scegli quello di riferimento
      </summary>
      <div className="stack" style={{ gap: 6, marginTop: 8 }} role="radiogroup" aria-label={`Saldo di riferimento per ${link.name}`}>
        {link.bankBalances!.map((b) => (
          <label key={b.key} className="check" style={{ justifyContent: 'space-between', width: '100%', maxWidth: 520 }}>
            <span className="row" style={{ gap: 8 }}>
              <input
                type="radio"
                name={`ref-${link.id}`}
                checked={current === b.key}
                onChange={async () => {
                  setOptimistic(b.key);
                  await chooseReferenceBalance(link.id, b.key === auto?.key ? null : b.key);
                  toast.success(`Saldo di riferimento: ${balanceLabel(b)}.`);
                }}
              />
              <span>
                {balanceLabel(b).replace(/^./, (c) => c.toUpperCase())}
                {b.key === auto?.key && <span className="muted"> · predefinito</span>}
                <span className="muted xs"> · {isBookedBalance(b.type) ? 'solo movimenti contabilizzati' : 'include i movimenti in attesa'}</span>
              </span>
            </span>
            <strong className="num">{formatMoney(b.amount, currency)}</strong>
          </label>
        ))}
      </div>
    </details>
  );
}

function SetupGuide() {
  return (
    <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
      <h3 style={{ fontSize: 'var(--fs-md)', marginBottom: 10 }}>Configurazione (una volta sola, circa 10 minuti)</h3>
      <ol className="small" style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 8, color: 'var(--text-2)', maxWidth: '78ch' }}>
        <li>
          Crea un account gratuito su{' '}
          <a href="https://enablebanking.com/cp" target="_blank" rel="noreferrer noopener">
            enablebanking.com/cp <ExternalLink size={11} style={{ verticalAlign: -1 }} />
          </a>
          .
        </li>
        <li>
          In <em>API applications</em> crea un'applicazione <strong>Production</strong>, lascia generare la chiave al browser e salva il file <code>.pem</code> scaricato. Come <em>Allowed redirect URL</em> inserisci <code>https://localhost/pfi-callback</code>.
        </li>
        <li>
          Premi <em>Activate by linking accounts</em> e collega i tuoi conti: l'applicazione diventa attiva in modalità limitata, gratuita per uso personale e solo sui conti collegati.
        </li>
        <li>
          Copia <code>bridge/config.example.json</code> in <code>bridge/config.json</code>, inserisci l'ID dell'applicazione e il percorso del file <code>.pem</code> (puoi metterlo nella cartella <code>bridge</code>).
        </li>
        <li>
          In un terminale, nella cartella del progetto, esegui <code>npm run bridge</code> e lascialo aperto. Poi premi <em>Ricontrolla</em>.
        </li>
      </ol>
    </div>
  );
}

function ConnectModal({
  client,
  redirectUrl,
  initial,
  onClose,
  onCode,
}: {
  client: BridgeClient;
  redirectUrl: string;
  initial?: { name: string; country: string };
  onClose: () => void;
  onCode: (input: string) => Promise<boolean>;
}) {
  const toast = useToast();
  const [country, setCountry] = useState(initial?.country ?? 'IT');
  const [banks, setBanks] = useState<Aspsp[] | null>(null);
  const [q, setQ] = useState(initial?.name ?? '');
  const [chosen, setChosen] = useState<Aspsp | null>(null);
  const [days, setDays] = useState(180);
  const [started, setStarted] = useState(false);
  const [authUrl, setAuthUrl] = useState('');
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setBanks(null);
    client
      .aspsps(country)
      .then((list) => {
        if (!alive) return;
        setBanks(list.sort((a, b) => a.name.localeCompare(b.name)));
        if (initial) setChosen(list.find((b) => b.name === initial.name) ?? null);
      })
      .catch((e) => {
        if (alive) {
          setBanks([]);
          toast.error(e);
        }
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, country]);

  const maxDays = chosen?.maximum_consent_validity ? Math.max(1, Math.floor(chosen.maximum_consent_validity / 86400)) : 180;
  const effectiveDays = Math.min(days, maxDays);
  const filtered = (banks ?? []).filter((b) => b.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 50);
  const autoReturn = (() => {
    try {
      return new URL(redirectUrl).origin === window.location.origin;
    } catch {
      return false;
    }
  })();

  const start = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      const state = uid();
      const validUntil = new Date(Date.now() + effectiveDays * 86400000).toISOString();
      const r = await client.startAuth({ aspsp: { name: chosen.name, country: chosen.country }, validUntil, state });
      await setPendingAuth({ state, aspsp: { name: chosen.name, country: chosen.country }, startedAt: new Date().toISOString() });
      setAuthUrl(r.url);
      setStarted(true);
      if (autoReturn) window.location.href = r.url;
      else window.open(r.url, '_blank', 'noopener');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={started ? `Autorizza ${chosen?.name}` : 'Collega una banca'}
      onClose={onClose}
      wide
      footer={
        started ? (
          <>
            <button className="btn btn-ghost" onClick={onClose}>
              Annulla
            </button>
            <button
              className="btn btn-primary"
              disabled={!pasted.trim() || busy}
              data-testid="complete-auth"
              onClick={async () => {
                setBusy(true);
                await onCode(pasted);
                setBusy(false);
              }}
            >
              Completa collegamento
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-ghost" onClick={onClose}>
              Annulla
            </button>
            <button className="btn btn-primary" disabled={!chosen || busy} onClick={start} data-testid="start-auth">
              <ExternalLink size={15} /> Apri la pagina della banca
            </button>
          </>
        )
      }
    >
      {!started ? (
        <div className="form">
          <div className="form-row">
            <div className="field">
              <label htmlFor="bk-country">Paese</label>
              <select id="bk-country" className="select" value={country} onChange={(e) => setCountry(e.target.value)}>
                {COUNTRIES.map(([c, n]) => (
                  <option key={c} value={c}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="bk-days">Durata del consenso</label>
              <select id="bk-days" className="select" value={effectiveDays} onChange={(e) => setDays(Number(e.target.value))}>
                {[30, 90, 180].filter((d) => d <= maxDays).concat(maxDays < 30 ? [maxDays] : []).map((d) => (
                  <option key={d} value={d}>
                    {d} giorni
                  </option>
                ))}
              </select>
              <span className="help">Alla scadenza basta rinnovare il consenso con la banca.</span>
            </div>
          </div>
          <div className="field">
            <label htmlFor="bk-q">Banca</label>
            <div className="search">
              <Search size={15} />
              <input id="bk-q" className="input" placeholder="Cerca, es. Fineco" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          <div className="panel flush" style={{ maxHeight: 280, overflowY: 'auto' }}>
            {banks === null ? (
              <p className="small muted" style={{ padding: 16 }}>
                Caricamento elenco banche…
              </p>
            ) : filtered.length === 0 ? (
              <p className="small muted" style={{ padding: 16 }}>
                Nessuna banca trovata.
              </p>
            ) : (
              <div className="item-list" role="listbox" aria-label="Banche disponibili">
                {filtered.map((b) => (
                  <button
                    key={`${b.name}-${b.country}`}
                    type="button"
                    role="option"
                    aria-selected={chosen?.name === b.name}
                    className="item"
                    onClick={() => setChosen(b)}
                    style={{ width: '100%', background: chosen?.name === b.name ? 'var(--sage-wash)' : 'transparent', border: 0, borderTop: '1px solid var(--line)', color: 'inherit', cursor: 'pointer', textAlign: 'left', gridTemplateColumns: 'auto 1fr auto' }}
                  >
                    <span className="item-icon">
                      <Landmark size={16} />
                    </span>
                    <span className="item-title">
                      {b.name}
                      {b.beta ? <span className="badge" style={{ marginLeft: 8 }}>beta</span> : null}
                    </span>
                    {chosen?.name === b.name && <CheckCircle2 size={16} color="var(--sage)" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Callout>Verrai portato sul sito della banca per autorizzare l'accesso in sola lettura a saldi e movimenti. PFI non vede e non salva le tue credenziali bancarie.</Callout>
        </div>
      ) : (
        <div className="form">
          <ol className="small" style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 8, color: 'var(--text-2)' }}>
            <li>
              Nella scheda che si è aperta accedi a {chosen?.name} e autorizza l'accesso.{' '}
              <a href={authUrl} target="_blank" rel="noreferrer noopener">
                Riapri la pagina
              </a>
            </li>
            <li>
              Alla fine il browser va su <code>{redirectUrl}</code>: la pagina può risultare irraggiungibile, è normale.
            </li>
            <li>Copia l'indirizzo completo dalla barra del browser e incollalo qui sotto.</li>
          </ol>
          <div className="field">
            <label htmlFor="bk-paste">Indirizzo di ritorno dalla banca</label>
            <input id="bk-paste" className="input" placeholder="https://localhost/pfi-callback?state=…&code=…" value={pasted} onChange={(e) => setPasted(e.target.value)} autoComplete="off" />
          </div>
        </div>
      )}
    </Modal>
  );
}

function LinkModal({ links, onClose, onSaved }: { links: BankLink[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const ds = useDataSet();
  const [choices, setChoices] = useState<LinkChoice[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const list: LinkChoice[] = [];
      for (const l of links) {
        const current = l.accountId ? (await db.accounts.get(l.accountId)) ?? null : null;
        list.push({ linkId: l.id, target: current ? current.id : 'new', syncFrom: current ? l.syncFrom : l.syncFrom });
      }
      setChoices(list);
    })();
  }, [links]);

  if (!ds || !choices) return null;

  const update = async (i: number, target: string | 'new' | null) => {
    const syncFrom = target && target !== 'new' ? await suggestedSyncFrom(target) : choices[i].syncFrom;
    setChoices((c) => c!.map((x, j) => (j === i ? { ...x, target, syncFrom } : x)));
  };

  return (
    <Modal
      title="Associa i conti bancari"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Annulla
          </button>
          <button
            className="btn btn-primary"
            disabled={busy}
            data-testid="save-links"
            onClick={async () => {
              setBusy(true);
              try {
                await applyLinkChoices(choices);
                toast.success('Associazioni salvate.');
                onSaved();
              } catch (e) {
                toast.error(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Salva e sincronizza
          </button>
        </>
      }
    >
      <p className="small muted" style={{ marginBottom: 14 }}>
        Scegli dove salvare i movimenti di ogni conto. Se colleghi un conto già presente (ad esempio importato da PDF), la sincronizzazione parte dal giorno dopo l'ultimo movimento che hai già, così non ci sono doppioni.
      </p>
      <div className="stack" style={{ gap: 12 }}>
        {links.map((l, i) => {
          const c = choices[i];
          const sameCurrency = ds.accounts.filter((a) => a.currency === l.currency);
          return (
            <div className="panel" key={l.id} style={{ padding: 16 }}>
              <div className="item-title" style={{ marginBottom: 10 }}>
                {l.name} <span className="muted xs num">{l.iban} · {l.currency}</span>
              </div>
              <div className="form-row">
                <div className="field">
                  <label htmlFor={`lk-t-${i}`}>Salva i movimenti in</label>
                  <select id={`lk-t-${i}`} className="select" value={c.target ?? ''} onChange={(e) => update(i, e.target.value === '' ? null : e.target.value)}>
                    <option value="new">Nuovo conto "{l.name}"</option>
                    {sameCurrency.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                    <option value="">Non sincronizzare</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`lk-d-${i}`}>Importa movimenti dal</label>
                  <input id={`lk-d-${i}`} type="date" className="input" value={c.syncFrom} max={todayISO()} disabled={!c.target} onChange={(e) => setChoices((x) => x!.map((y, j) => (j === i ? { ...y, syncFrom: e.target.value } : y)))} />
                  <span className="help">{c.target === 'new' ? 'Il saldo del nuovo conto verrà allineato a quello della banca.' : 'Molte banche forniscono al massimo 90 giorni di storico.'}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
