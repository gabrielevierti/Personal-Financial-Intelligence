/**
 * Controlli di qualità dei dati: conti che sono in realtà lo stesso conto bancario
 * (es. importato da PDF e poi collegato alla banca come conto nuovo) e unione dei conti.
 */
import { db } from '../database/db';
import type { Account, Transaction } from '../types';
import { daysBetween } from '../utils/date';
import { fingerprint } from './importParser';
import { merchantSimilarity } from './merchant';
import { ValidationError } from './validation';

export interface DuplicateAccountPair {
  a: string;
  b: string;
  /** coppie di movimenti uguali sui due conti */
  matches: Array<{ aTx: string; bTx: string }>;
  overlapFrom: string;
  overlapTo: string;
}

/** Abbina i movimenti uguali di due conti: stesso importo, date entro 2 giorni, descrizione simile. */
export function matchTransactions(aTxs: Transaction[], bTxs: Transaction[]): Array<{ aTx: string; bTx: string }> {
  const byAmount = new Map<number, Transaction[]>();
  for (const t of bTxs) {
    if (t.type === 'transfer' || t.pending) continue;
    const l = byAmount.get(t.amount) ?? [];
    l.push(t);
    byAmount.set(t.amount, l);
  }
  const used = new Set<string>();
  const matches: Array<{ aTx: string; bTx: string }> = [];
  for (const t of [...aTxs].sort((x, y) => x.date.localeCompare(y.date))) {
    if (t.type === 'transfer' || t.pending) continue;
    let best: Transaction | null = null;
    let bestScore = -1;
    for (const c of byAmount.get(t.amount) ?? []) {
      if (used.has(c.id)) continue;
      const gap = Math.abs(daysBetween(t.date, c.date));
      if (gap > 2) continue;
      const sim = merchantSimilarity(t.description, c.description);
      if (sim < 0.5 && gap > 0) continue;
      const score = sim * 2 - gap * 0.3;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best) {
      used.add(best.id);
      matches.push({ aTx: t.id, bTx: best.id });
    }
  }
  return matches;
}

/** Trova coppie di conti con molti movimenti uguali nello stesso periodo: probabilmente lo stesso conto. */
export function findDuplicateAccounts(accounts: Account[], txs: Transaction[]): DuplicateAccountPair[] {
  const byAcc = new Map<string, Transaction[]>();
  for (const t of txs) {
    const l = byAcc.get(t.accountId) ?? [];
    l.push(t);
    byAcc.set(t.accountId, l);
  }
  const out: DuplicateAccountPair[] = [];
  for (let i = 0; i < accounts.length; i++) {
    for (let j = i + 1; j < accounts.length; j++) {
      const A = accounts[i];
      const B = accounts[j];
      if (A.currency !== B.currency) continue;
      const aTxs = byAcc.get(A.id) ?? [];
      const bTxs = byAcc.get(B.id) ?? [];
      if (aTxs.length < 3 || bTxs.length < 3) continue;
      // periodo in comune
      const range = (l: Transaction[]) => [l.reduce((m, t) => (t.date < m ? t.date : m), '9999'), l.reduce((m, t) => (t.date > m ? t.date : m), '0000')];
      const [aFrom, aTo] = range(aTxs);
      const [bFrom, bTo] = range(bTxs);
      const from = aFrom > bFrom ? aFrom : bFrom;
      const to = aTo < bTo ? aTo : bTo;
      if (from > to) continue;
      const inA = aTxs.filter((t) => t.date >= from && t.date <= to);
      const inB = bTxs.filter((t) => t.date >= from && t.date <= to);
      const matches = matchTransactions(inA, inB);
      const smaller = Math.min(inA.length, inB.length);
      if (matches.length >= 3 && matches.length / Math.max(1, smaller) >= 0.4) out.push({ a: A.id, b: B.id, matches, overlapFrom: from, overlapTo: to });
    }
  }
  return out.sort((x, y) => y.matches.length - x.matches.length);
}

/**
 * Unisce il conto `sourceId` in `targetId`: i movimenti uguali già presenti nel conto di destinazione
 * vengono scartati, gli altri spostati; i collegamenti bancari passano al conto di destinazione;
 * il conto di origine viene eliminato. Il saldo iniziale del conto di destinazione non cambia.
 */
export async function mergeAccounts(sourceId: string, targetId: string): Promise<{ moved: number; duplicates: number }> {
  if (sourceId === targetId) throw new ValidationError(['Scegli due conti diversi.']);
  return db.transaction('rw', [db.accounts, db.transactions, db.bank_links, db.import_batches, db.budgets], async () => {
    const [src, dst] = await db.accounts.bulkGet([sourceId, targetId]);
    if (!src || !dst) throw new ValidationError(['Conto non trovato.']);
    if (src.currency !== dst.currency) throw new ValidationError(['I conti hanno valute diverse.']);
    const srcTxs = await db.transactions.where('accountId').equals(sourceId).toArray();
    const dstTxs = await db.transactions.where('accountId').equals(targetId).toArray();
    const matches = matchTransactions(srcTxs, dstTxs);
    // saldo attuale da preservare: quello del conto collegato alla banca, altrimenti quello di destinazione
    const sum = (l: Transaction[]) => l.reduce((s, t) => s + t.amount, 0);
    const srcLinked = (await db.bank_links.where('accountId').equals(sourceId).count()) > 0;
    const keepBalance = srcLinked ? src.initialBalance + sum(srcTxs) : dst.initialBalance + sum(dstTxs);
    const dupIds = new Set(matches.map((m) => m.aTx));

    // trasferimenti tra i due conti: diventano interni allo stesso conto, quindi si eliminano entrambe le gambe
    const internalTransfers = srcTxs.filter((t) => t.transferId && t.counterAccountId === targetId).map((t) => t.transferId!);
    if (internalTransfers.length) await db.transactions.where('transferId').anyOf(internalTransfers).delete();

    let moved = 0;
    const stamp = new Date().toISOString();
    for (const t of srcTxs) {
      if (dupIds.has(t.id) || (t.transferId && internalTransfers.includes(t.transferId))) continue;
      await db.transactions.update(t.id, { accountId: targetId, fingerprint: fingerprint(targetId, t.date, t.amount, t.description), updatedAt: stamp });
      moved++;
    }
    if (dupIds.size) await db.transactions.bulkDelete([...dupIds]);
    // le gambe di trasferimento di altri conti che puntavano al conto eliminato
    await db.transactions.filter((t) => t.counterAccountId === sourceId).modify({ counterAccountId: targetId });
    await db.bank_links.where('accountId').equals(sourceId).modify({ accountId: targetId });
    await db.import_batches.where('accountId').equals(sourceId).modify({ accountId: targetId });
    await db.accounts.delete(sourceId);
    const after = await db.transactions.where('accountId').equals(targetId).toArray();
    const createdAt = src.createdAt < dst.createdAt ? src.createdAt : dst.createdAt;
    await db.accounts.update(targetId, { initialBalance: keepBalance - sum(after), createdAt });
    return { moved, duplicates: dupIds.size };
  });
}
