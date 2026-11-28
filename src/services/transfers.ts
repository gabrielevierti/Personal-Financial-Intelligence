/**
 * Riconoscimento dei trasferimenti tra conti propri (es. bonifico da Fineco a Trade Republic).
 *
 * Una coppia candidata è un'uscita su un conto e un'entrata di pari importo su un altro conto,
 * nella stessa valuta, con date vicine (i bonifici possono impiegare qualche giorno).
 * Le prove che rendono la coppia "certa":
 *  - l'IBAN della controparte è quello dell'altro conto collegato;
 *  - nella descrizione compare il nome dell'intestatario (bonifico a sé stessi).
 * Le coppie certe vengono collegate automaticamente; le altre vengono proposte da confermare.
 */
import { db } from '../database/db';
import type { Account, BankLink, Transaction } from '../types';
import { daysBetween } from '../utils/date';
import { normalizeText } from '../utils/text';
import { linkAsTransfer } from './repository';

export const MAX_TRANSFER_DAYS = 5;

export interface TransferCandidate {
  outId: string;
  inId: string;
  score: number;
  certain: boolean;
  reasons: string[];
}

const KEYWORDS = /\b(giroconto|giro conto|trasferimento|trasf|ricarica|top up|topup|deposit|deposito|prelievo da conto|bonifico a se stess[oi]|own account|internal transfer)\b/;

/** Nomi dell'intestatario: quelli inseriti dall'utente più i nomi di conto che sembrano nomi di persona. */
export function ownerNames(configured: string[], links: Pick<BankLink, 'name'>[]): string[][] {
  const names = new Set<string>();
  for (const n of configured) if (normalizeText(n)) names.add(normalizeText(n));
  for (const l of links) {
    const n = normalizeText(l.name);
    const words = n.split(' ');
    if (words.length >= 2 && words.length <= 4 && !/\d/.test(n) && !/\b(conto|carta|card|account|deposito|risparmio|corrente|savings|current|eur)\b/.test(n)) names.add(n);
  }
  // un nome corrisponde se tutte le sue parole compaiono nella descrizione, in qualunque ordine
  return [...names].map((n) => n.split(' ').filter((w) => w.length > 1));
}

const GENERIC_BANK_WORDS = new Set(['bank', 'banca', 'banco', 'banque', 'gmbh', 'spa', 's', 'p', 'a', 'ag', 'se', 'sa', 'nv', 'bv', 'ltd', 'plc', 'eur', 'italia', 'italy', 'popolare', 'di', 'del', 'della', 'the', 'group', 'gruppo', 'credito', 'cassa', 'europe', 'branch']);

/** Parole distintive del nome di una banca ("Trade Republic Bank GmbH" → ["trade", "republic"]). */
export function institutionTokens(name: string): string[] {
  return normalizeText(name)
    .split(' ')
    .filter((w) => w.length >= 3 && !GENERIC_BANK_WORDS.has(w));
}

function mentionsInstitution(text: string, tokens: string[] | undefined): boolean {
  if (!tokens?.length) return false;
  const words = new Set(normalizeText(text).split(' '));
  return tokens.every((t) => words.has(t));
}

function mentionsOwner(text: string, names: string[][]): boolean {
  const words = new Set(normalizeText(text).split(' '));
  return names.some((parts) => parts.length >= 2 && parts.every((p) => words.has(p)));
}

export function detectTransfers(
  txs: Transaction[],
  accounts: Array<Pick<Account, 'id' | 'currency'> & { institution?: string }>,
  links: Pick<BankLink, 'accountId' | 'iban' | 'name'>[],
  configuredNames: string[] = [],
  ignored: Set<string> = new Set(),
): TransferCandidate[] {
  const ibanOf = new Map<string, string>();
  for (const l of links) if (l.accountId && l.iban) ibanOf.set(l.accountId, l.iban.replace(/\s/g, '').toUpperCase());
  const currencyOf = new Map(accounts.map((a) => [a.id, a.currency]));
  const names = ownerNames(configuredNames, links);
  // banca di ciascun conto: un bonifico verso "Trade Republic" da un conto Fineco, quando
  // l'altro conto è Trade Republic, è un giroconto anche se il beneficiario non è il tuo nome
  const instOf = new Map<string, string[]>();
  for (const a of accounts) {
    const tok = institutionTokens(a.institution ?? '');
    if (tok.length) instOf.set(a.id, tok);
  }
  const eligible = txs.filter((t) => t.type !== 'transfer' && !t.pending && !t.transferId && currencyOf.has(t.accountId));
  const outs = eligible.filter((t) => t.amount < 0);
  const ins = eligible.filter((t) => t.amount > 0);
  // Indice per importo esatto e fuzzy (entro il 5%): per trovare anche giroconti con piccole differenze
  // (es. sposti 576 €, investi, rivendi con +1%, riporti 580 €)
  const insByAmount = new Map<number, Transaction[]>();
  for (const t of ins) {
    const list = insByAmount.get(t.amount) ?? [];
    list.push(t);
    insByAmount.set(t.amount, list);
  }
  /** Trova entrate che corrispondono a un'uscita: prima esatte, poi fuzzy (±5%, max 100 €). */
  function findMatchingIns(outAmount: number): Array<{ tx: Transaction; exact: boolean }> {
    const target = -outAmount; // positivo
    const results: Array<{ tx: Transaction; exact: boolean }> = [];
    // Corrispondenze esatte
    for (const t of insByAmount.get(target) ?? []) results.push({ tx: t, exact: true });
    // Corrispondenze fuzzy: scansiona importi simili
    const tolerance = Math.min(Math.abs(outAmount) * 0.05, 10000); // 5% o max 100 €
    for (const [amt, txs] of insByAmount) {
      if (amt === target) continue; // già incluse
      if (Math.abs(amt - target) <= tolerance) {
        for (const t of txs) results.push({ tx: t, exact: false });
      }
    }
    return results;
  }

  const all: TransferCandidate[] = [];
  for (const o of outs) {
    for (const { tx: i, exact } of findMatchingIns(o.amount)) {
      if (i.accountId === o.accountId || i.currency !== o.currency) continue;
      const gap = daysBetween(o.date, i.date);
      if (gap < -1 || gap > MAX_TRANSFER_DAYS) continue;
      if (ignored.has(`${o.id}|${i.id}`)) continue;
      const reasons: string[] = [];
      let score = exact ? 0 : -0.5; // penalità per fuzzy
      let certain = false;
      const inIban = ibanOf.get(i.accountId);
      const outIban = ibanOf.get(o.accountId);
      if ((o.counterpartIban && inIban && o.counterpartIban === inIban) || (i.counterpartIban && outIban && i.counterpartIban === outIban)) {
        score += 4;
        certain = true;
        reasons.push('IBAN del tuo altro conto');
      }
      if (mentionsOwner(o.description, names) || mentionsOwner(i.description, names)) {
        score += 3;
        certain = true;
        reasons.push('bonifico a tuo nome');
      }
      if (mentionsInstitution(o.description, instOf.get(i.accountId)) || mentionsInstitution(i.description, instOf.get(o.accountId))) {
        score += 3;
        certain = true;
        reasons.push('nome della banca del tuo altro conto');
      }
      if (KEYWORDS.test(normalizeText(`${o.description} ${i.description}`))) {
        score += 1;
        reasons.push('descrizione da giroconto');
      }
      if (gap === 0) score += 1;
      else if (gap <= 2) score += 0.5;
      if (!exact) {
        reasons.push('importo simile (±5%)');
        // fuzzy match non è mai "certo" da solo, serve almeno un'altra prova
        if (!certain && score < 1) score = Math.max(score, 0.3);
      }
      if (!reasons.length) reasons.push('stesso importo, date vicine');
      all.push({ outId: o.id, inId: i.id, score: score - Math.abs(gap) * 0.1, certain, reasons });
    }
  }
  // assegnazione: ogni movimento al massimo in una coppia, a partire dalle coppie più probabili
  all.sort((a, b) => b.score - a.score);
  const used = new Set<string>();
  const result: TransferCandidate[] = [];
  for (const c of all) {
    if (used.has(c.outId) || used.has(c.inId)) continue;
    used.add(c.outId);
    used.add(c.inId);
    result.push(c);
  }
  return result;
}

const IGNORED_KEY = 'ignoredTransferPairs';
const NAMES_KEY = 'ownerNames';

export async function getIgnoredPairs(): Promise<Set<string>> {
  return new Set(((await db.settings.get(IGNORED_KEY))?.value as string[] | undefined) ?? []);
}

export async function ignorePair(outId: string, inId: string): Promise<void> {
  const cur = await getIgnoredPairs();
  cur.add(`${outId}|${inId}`);
  await db.settings.put({ key: IGNORED_KEY, value: [...cur].slice(-2000) });
}

export async function getOwnerNames(): Promise<string[]> {
  return ((await db.settings.get(NAMES_KEY))?.value as string[] | undefined) ?? [];
}

export async function setOwnerNames(names: string[]): Promise<void> {
  await db.settings.put({ key: NAMES_KEY, value: names.map((n) => n.trim()).filter(Boolean).slice(0, 10) });
}

export async function findTransferCandidates(): Promise<TransferCandidate[]> {
  const [txs, accounts, links, names, ignored] = await Promise.all([db.transactions.toArray(), db.accounts.toArray(), db.bank_links.toArray(), getOwnerNames(), getIgnoredPairs()]);
  return detectTransfers(txs, accounts, links, names, ignored);
}

/** Collega automaticamente solo le coppie certe. Restituisce quante ne ha collegate. */
export async function autoLinkTransfers(): Promise<number> {
  const certain = (await findTransferCandidates()).filter((c) => c.certain);
  let n = 0;
  for (const c of certain) {
    try {
      await linkAsTransfer(c.outId, c.inId);
      n++;
    } catch {
      /* movimento cambiato nel frattempo: si salta */
    }
  }
  return n;
}
