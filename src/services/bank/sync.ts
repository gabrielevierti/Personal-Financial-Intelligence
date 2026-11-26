/**
 * Sincronizzazione in sola lettura: scarica saldi e movimenti contabilizzati dal bridge
 * e li salva nel database locale, senza duplicati.
 */
import { db } from '../../database/db';
import { FALLBACK_CATEGORY } from '../../database/seed';
import type { BankConnection, BankLink, Cents, ISODate, StoredBalance, Transaction } from '../../types';
import { addDays, todayISO } from '../../utils/date';
import { uid } from '../../utils/id';
import { fingerprint } from '../importParser';
import { createAccount } from '../repository';
import { loadCategorizer, recategorizeUncategorized } from '../categorize';
import { autoLinkTransfers } from '../transfers';
import { ValidationError } from '../validation';
import { BankApiError, type BridgeClient, type SessionResponse } from './client';
import { compareBalance, guessAccountType, mapTransactions, parseBalances, pickBalance } from './mapping';

/**
 * Versione della logica di lettura. Quando cambia, la sincronizzazione successiva rilegge tutto dal
 * syncFrom e corregge i movimenti già salvati (es. dopo il fix degli importi interi "850" → 8,50 €).
 */
export const SYNC_VERSION = 2;

/** Giorni riletti a ogni sincronizzazione, per includere movimenti contabilizzati in ritardo. */
export const OVERLAP_DAYS = 7;
/** Intervallo minimo tra sincronizzazioni automatiche (le banche limitano gli accessi giornalieri). */
export const AUTO_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_PAGES = 50;

export interface SyncResult {
  linkId: string;
  accountId: string;
  added: number;
  /** movimenti già presenti corretti con i dati della banca */
  corrected: number;
  /** movimenti non più restituiti dalla banca e rimossi (solo nella finestra riletta) */
  removed: number;
  alreadyPresent: number;
  pending: number;
  bankBalance: Cents | null;
  /** saldo della banca − saldo calcolato da PFI (confrontabile) dopo la sincronizzazione */
  difference: Cents | null;
  error?: string;
  /** trasferimenti tra conti propri riconosciuti automaticamente dopo la sincronizzazione */
  transfersLinked?: number;
}

/** Salva un consenso appena autorizzato e i conti a cui dà accesso. */
export async function saveSession(session: SessionResponse): Promise<BankLink[]> {
  const now = new Date().toISOString();
  const connection: BankConnection = {
    id: session.session_id,
    aspspName: session.aspsp.name,
    aspspCountry: session.aspsp.country,
    validUntil: session.access.valid_until,
    createdAt: now,
    status: 'active',
  };
  const links: BankLink[] = session.accounts.map((a) => ({
    id: a.uid,
    connectionId: session.session_id,
    iban: a.account_id?.iban ?? a.account_id?.other?.identification ?? '',
    name: a.name || a.product || a.details || session.aspsp.name,
    currency: a.currency || 'EUR',
    cashAccountType: a.cash_account_type,
    accountId: null,
    syncFrom: addDays(todayISO(), -90),
    lastSyncAt: null,
    lastBookingDate: null,
    bankBalance: null,
    bankBalanceType: null,
    bankBalanceDate: null,
  }));
  await db.transaction('rw', db.bank_connections, db.bank_links, async () => {
    await db.bank_connections.put(connection);
    // un nuovo consenso per lo stesso IBAN sostituisce il collegamento precedente, mantenendo l'associazione
    for (const l of links) {
      const previous = l.iban ? await db.bank_links.filter((x) => x.iban === l.iban && x.id !== l.id).toArray() : [];
      const keep = previous.find((p) => p.accountId);
      if (keep) Object.assign(l, { accountId: keep.accountId, syncFrom: keep.syncFrom, lastBookingDate: keep.lastBookingDate });
      await db.bank_links.bulkDelete(previous.map((p) => p.id));
      await db.bank_links.put(l);
    }
  });
  return links;
}

/** Data proposta per la prima sincronizzazione: il giorno dopo l'ultimo movimento già presente nel conto. */
export async function suggestedSyncFrom(accountId: string | null): Promise<ISODate> {
  if (accountId) {
    const last = await db.transactions.where('[accountId+date]').between([accountId, ''], [accountId, '￿']).last();
    if (last) return addDays(last.date, 1);
  }
  return addDays(todayISO(), -90);
}

export interface LinkChoice {
  linkId: string;
  /** conto esistente, 'new' per crearne uno, null per non sincronizzare */
  target: string | 'new' | null;
  syncFrom: ISODate;
}

export async function applyLinkChoices(choices: LinkChoice[]): Promise<void> {
  for (const c of choices) {
    const link = await db.bank_links.get(c.linkId);
    if (!link) continue;
    let accountId: string | null = null;
    if (c.target === 'new') {
      const conn = await db.bank_connections.get(link.connectionId);
      accountId = await createAccount({
        name: link.name.slice(0, 80),
        institution: conn?.aspspName ?? '',
        type: guessAccountType(link.cashAccountType, link.name),
        currency: /^[A-Z]{3}$/.test(link.currency) ? link.currency : 'EUR',
        initialBalance: 0,
        createdAt: addDays(c.syncFrom, -1),
      });
    } else if (c.target) {
      const acc = await db.accounts.get(c.target);
      if (!acc) throw new ValidationError(['Conto non trovato.']);
      if (acc.currency !== link.currency) throw new ValidationError([`Il conto "${acc.name}" è in ${acc.currency}, quello bancario in ${link.currency}.`]);
      accountId = acc.id;
    }
    const clash = accountId ? await db.bank_links.where('accountId').equals(accountId).filter((l) => l.id !== link.id).count() : 0;
    if (clash) throw new ValidationError(['Questo conto PFI è già collegato a un altro conto bancario.']);
    await db.bank_links.update(link.id, {
      accountId,
      syncFrom: c.syncFrom,
      autoAlign: c.target === 'new',
      lastBookingDate: link.accountId === accountId ? link.lastBookingDate : null,
      lastSyncAt: link.accountId === accountId ? link.lastSyncAt : null,
    });
  }
}

async function accountTxs(accountId: string): Promise<Transaction[]> {
  return db.transactions.where('accountId').equals(accountId).toArray();
}

/** Sincronizza un conto collegato. Per i conti creati dal collegamento, la prima volta allinea il saldo a quello della banca. */
export async function syncLink(client: BridgeClient, link: BankLink): Promise<SyncResult> {
  if (!link.accountId) throw new ValidationError(['Conto bancario non associato a un conto PFI.']);
  const account = await db.accounts.get(link.accountId);
  if (!account) throw new ValidationError(['Il conto PFI collegato non esiste più.']);
  const conn = await db.bank_connections.get(link.connectionId);
  if (!conn || conn.status !== 'active') throw new BankApiError(401, 'EXPIRED_SESSION', 'Il consenso con la banca non è attivo: ricollega la banca.');

  const fullResync = (link.syncVersion ?? 1) < SYNC_VERSION;
  const dateFrom = link.lastBookingDate && !fullResync ? addDays(link.lastBookingDate, -OVERLAP_DAYS) : link.syncFrom;
  const raw = [];
  let key: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await client.transactionsPage(link.id, dateFrom, key);
    raw.push(...(r.transactions ?? []));
    key = r.continuation_key ?? undefined;
    if (!key) break;
  }
  const { mapped, pending } = mapTransactions(link.id, raw);
  const inRange = mapped.filter((m) => m.date >= dateFrom && m.currency === account.currency);
  const pendingOk = pending.filter((m) => m.currency === account.currency);

  const existing = await accountTxs(account.id);
  const byExternal = new Map(existing.filter((t) => !t.pending && t.externalId).map((t) => [t.externalId!, t]));
  const categorizer = await loadCategorizer();
  const stamp = new Date().toISOString();
  const build = (m: (typeof mapped)[number], isPending: boolean): Transaction => {
    const type = m.amount > 0 ? 'income' : 'expense';
    return {
      id: uid(),
      accountId: account.id,
      date: m.date,
      description: m.description,
      amount: m.amount,
      type,
      categoryId: categorizer.categorize(m.description, type).categoryId,
      currency: account.currency,
      externalId: m.externalId,
      counterpartIban: m.counterpartIban,
      pending: isPending || undefined,
      fingerprint: fingerprint(account.id, m.date, m.amount, m.description),
      createdAt: stamp,
      updatedAt: stamp,
    };
  };
  const fresh: Transaction[] = [];
  const corrections: Array<{ id: string; changes: Partial<Transaction> }> = [];
  let alreadyPresent = 0;
  const seen = new Set<string>();
  for (const m of inRange) {
    seen.add(m.externalId);
    const old = byExternal.get(m.externalId);
    if (old) {
      alreadyPresent++;
      // la banca è la fonte di verità per i movimenti sincronizzati: si correggono importo e data se diversi
      if (old.type !== 'transfer' && (old.amount !== m.amount || old.date !== m.date)) {
        const type = m.amount > 0 ? 'income' : 'expense';
        const keepCat = old.type === type;
        corrections.push({
          id: old.id,
          changes: {
            amount: m.amount,
            date: m.date,
            type,
            categoryId: keepCat ? old.categoryId : FALLBACK_CATEGORY[type],
            fingerprint: fingerprint(account.id, m.date, m.amount, old.description),
            counterpartIban: m.counterpartIban ?? old.counterpartIban,
            updatedAt: stamp,
          },
        });
      } else if (m.counterpartIban && !old.counterpartIban) {
        corrections.push({ id: old.id, changes: { counterpartIban: m.counterpartIban } });
      }
      continue;
    }
    byExternal.set(m.externalId, build(m, false));
    fresh.push(byExternal.get(m.externalId)!);
  }
  // movimenti con ID calcolato dal contenuto che la banca non restituisce più nella finestra riletta:
  // erano stati salvati con dati errati (es. importo) e sono stati sostituiti da quelli corretti
  // per sicurezza si considerano solo i giorni effettivamente coperti dalla risposta della banca
  const coveredFrom = inRange.reduce<string | null>((min, m) => (min === null || m.date < min ? m.date : min), null);
  const stale = existing
    .filter((t) => !t.pending && t.type !== 'transfer' && coveredFrom !== null && t.date >= coveredFrom && t.date >= dateFrom && t.externalId?.startsWith(`eb:${link.id}:h`) && !seen.has(t.externalId))
    .map((t) => t.id);
  // i movimenti in attesa vengono sostituiti in blocco: quelli contabilizzati nel frattempo spariscono
  const oldPending = existing.filter((t) => t.pending && t.externalId?.startsWith(`eb:${link.id}:`)).map((t) => t.id);
  const newPending = pendingOk.map((m) => build(m, true));

  let balances: StoredBalance[] | null = null;
  try {
    balances = parseBalances(await client.balances(link.id)).filter((b) => b.currency === account.currency);
  } catch (e) {
    if (e instanceof BankApiError && e.sessionExpired) throw e;
    balances = null; // alcune banche non espongono i saldi: i movimenti restano validi
  }
  const balance = balances ? pickBalance(balances, link.balanceKey) : null;

  const lastBooking = [link.lastBookingDate, ...inRange.map((m) => m.date)].filter(Boolean).sort().pop() ?? null;
  const updated: Partial<BankLink> = {
    lastSyncAt: stamp,
    lastBookingDate: lastBooking,
    pendingCount: newPending.length,
    syncVersion: SYNC_VERSION,
    pendingAmount: newPending.reduce((sum, t) => sum + t.amount, 0),
    ...(balances ? { bankBalances: balances, bankBalance: balance?.amount ?? null, bankBalanceType: balance?.type ?? null, bankBalanceDate: balance?.date ?? null } : {}),
  };
  await db.transaction('rw', db.transactions, db.bank_links, async () => {
    if (oldPending.length || stale.length) await db.transactions.bulkDelete([...oldPending, ...stale]);
    for (const c of corrections) await db.transactions.update(c.id, c.changes);
    if (fresh.length || newPending.length) await db.transactions.bulkAdd([...fresh, ...newPending]);
    await db.bank_links.update(link.id, updated);
  });

  let difference: Cents | null = null;
  if (balance) {
    const firstSync = !link.lastSyncAt || fullResync;
    const acc = (await db.accounts.get(account.id))!;
    const cmp = compareBalance({ bankBalance: balance.amount, bankBalanceType: balance.type }, acc.initialBalance, await accountTxs(account.id));
    difference = cmp?.difference ?? null;
    if (link.autoAlign && firstSync && difference) {
      await alignAccountBalance(account.id);
      difference = 0;
    }
  }
  return { linkId: link.id, accountId: account.id, added: fresh.length, corrected: corrections.filter((c) => 'amount' in c.changes).length, removed: stale.length, alreadyPresent, pending: newPending.length, bankBalance: balance?.amount ?? null, difference };
}

/**
 * Corregge il saldo iniziale del conto in modo che il saldo calcolato coincida con il saldo di riferimento
 * della banca (contabile: senza movimenti in attesa; disponibile/altro: con i movimenti in attesa).
 */
export async function alignAccountBalance(accountId: string): Promise<Cents> {
  return db.transaction('rw', db.accounts, db.transactions, db.bank_links, async () => {
    const acc = await db.accounts.get(accountId);
    if (!acc) throw new ValidationError(['Conto non trovato.']);
    const link = await db.bank_links.where('accountId').equals(accountId).first();
    if (!link || link.bankBalance === null) throw new ValidationError(['Nessun saldo della banca disponibile per questo conto.']);
    const cmp = compareBalance(link, acc.initialBalance, await accountTxs(accountId));
    const diff = cmp?.difference ?? 0;
    if (diff !== 0) await db.accounts.update(accountId, { initialBalance: acc.initialBalance + diff });
    return diff;
  });
}

/** Sceglie quale dei saldi forniti dalla banca usare come riferimento. */
export async function chooseReferenceBalance(linkId: string, key: string | null): Promise<void> {
  const link = await db.bank_links.get(linkId);
  if (!link) return;
  const b = pickBalance(link.bankBalances ?? [], key);
  await db.bank_links.update(linkId, { balanceKey: key, bankBalance: b?.amount ?? null, bankBalanceType: b?.type ?? null, bankBalanceDate: b?.date ?? null });
}

export async function markConnectionExpired(connectionId: string, message: string): Promise<void> {
  await db.bank_connections.update(connectionId, { status: 'expired', lastError: message });
}

/** Sincronizza tutti i conti collegati. Gli errori di un conto non bloccano gli altri. */
export async function syncAll(client: BridgeClient): Promise<SyncResult[]> {
  const links = (await db.bank_links.toArray()).filter((l) => l.accountId);
  const results: SyncResult[] = [];
  for (const link of links) {
    try {
      results.push(await syncLink(client, link));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (e instanceof BankApiError && e.sessionExpired) await markConnectionExpired(link.connectionId, message);
      results.push({ linkId: link.id, accountId: link.accountId!, added: 0, corrected: 0, removed: 0, alreadyPresent: 0, pending: 0, bankBalance: null, difference: null, error: message });
      if (e instanceof Error && e.name === 'BridgeUnavailableError') break;
    }
  }
  if (results.some((r) => !r.error)) {
    await recategorizeUncategorized();
    const linkedTransfers = await autoLinkTransfers();
    if (results.length) results[0].transfersLinked = linkedTransfers;
  }
  return results;
}

export async function needsAutoSync(now = Date.now()): Promise<boolean> {
  const links = (await db.bank_links.toArray()).filter((l) => l.accountId);
  if (!links.length) return false;
  const active = new Set((await db.bank_connections.toArray()).filter((c) => c.status === 'active' && new Date(c.validUntil).getTime() > now).map((c) => c.id));
  return links.some((l) => active.has(l.connectionId) && (!l.lastSyncAt || now - new Date(l.lastSyncAt).getTime() > AUTO_SYNC_INTERVAL_MS));
}

/** Rimuove il collegamento (i movimenti già importati restano). */
export async function unlinkBankAccount(linkId: string): Promise<void> {
  await db.bank_links.update(linkId, { accountId: null, lastBookingDate: null });
}

/** Revoca il consenso presso Enable Banking e lo rimuove localmente. */
export async function revokeConnection(client: BridgeClient, connectionId: string): Promise<void> {
  try {
    await client.deleteSession(connectionId);
  } catch (e) {
    if (!(e instanceof BankApiError)) throw e; // sessione già scaduta o inesistente: si rimuove comunque
  }
  await db.transaction('rw', db.bank_connections, db.bank_links, async () => {
    await db.bank_links.where('connectionId').equals(connectionId).delete();
    await db.bank_connections.delete(connectionId);
  });
}

/** Stato di autorizzazione in corso (per verificare il parametro state al ritorno dalla banca). */
export interface PendingAuth {
  state: string;
  aspsp: { name: string; country: string };
  startedAt: string;
}

export async function setPendingAuth(p: PendingAuth | null): Promise<void> {
  if (p) await db.settings.put({ key: 'pendingBankAuth', value: p });
  else await db.settings.delete('pendingBankAuth');
}

export async function getPendingAuth(): Promise<PendingAuth | null> {
  return ((await db.settings.get('pendingBankAuth'))?.value as PendingAuth | undefined) ?? null;
}

export async function getBridgeUrl(): Promise<string> {
  return ((await db.settings.get('bridgeUrl'))?.value as string | undefined) ?? 'http://127.0.0.1:8787';
}

export async function getAutoSync(): Promise<boolean> {
  return ((await db.settings.get('bankAutoSync'))?.value as boolean | undefined) ?? true;
}
