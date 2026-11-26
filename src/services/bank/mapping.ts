/** Conversione pura dei dati Enable Banking nel modello di PFI. */
import type { AccountType, BankLink, Cents, ISODate, StoredBalance, Transaction } from '../../types';
import { todayISO } from '../../utils/date';
import { parseAmount } from '../../utils/money';
import { sha256 } from '../../utils/sha256';
import { normalizeText } from '../../utils/text';
import type { RemoteBalance, RemoteTransaction } from './client';

export interface MappedTransaction {
  externalId: string;
  date: ISODate;
  amount: Cents;
  description: string;
  currency: string;
  counterpartIban?: string;
}

const isoDay = (s?: string | null) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

export function describe(t: RemoteTransaction): string {
  const remittance = (t.remittance_information ?? []).map((x) => x.trim()).filter(Boolean).join(' ');
  const counterpart = (t.credit_debit_indicator === 'CRDT' ? t.debtor?.name : t.creditor?.name)?.trim();
  const parts = [counterpart, remittance].filter(Boolean) as string[];
  if (counterpart && remittance && normalizeText(remittance).includes(normalizeText(counterpart))) parts.shift();
  const text = parts.join(' · ') || t.bank_transaction_code?.description || t.note || 'Movimento bancario';
  return text.replace(/\s+/g, ' ').slice(0, 300);
}

/**
 * Mappa i movimenti. Quelli contabilizzati (BOOK) hanno un ID stabile e non vengono mai duplicati.
 * Quelli in attesa (PDNG e simili) vengono restituiti a parte: PFI li sostituisce in blocco a ogni
 * sincronizzazione, così spariscono da soli quando la banca li contabilizza.
 * In mancanza di transaction_id / entry_reference, l'ID è un'impronta del contenuto con il numero di
 * occorrenza nello stesso giorno (stabile perché ogni sincronizzazione rilegge i giorni interi).
 */
export function mapTransactions(linkId: string, raw: RemoteTransaction[]): { mapped: MappedTransaction[]; pending: MappedTransaction[]; invalid: number } {
  const mapped: MappedTransaction[] = [];
  const pending: MappedTransaction[] = [];
  let invalid = 0;
  const occurrences = new Map<string, number>();
  const sorted = [...raw].sort((a, b) => (isoDay(a.booking_date ?? a.value_date) ?? '').localeCompare(isoDay(b.booking_date ?? b.value_date) ?? ''));
  for (const t of sorted) {
    const isPending = !!t.status && t.status !== 'BOOK';
    const date = isPending
      ? (isoDay(t.transaction_date) ?? isoDay(t.value_date) ?? isoDay(t.booking_date) ?? todayISO())
      : (isoDay(t.booking_date) ?? isoDay(t.value_date) ?? isoDay(t.transaction_date));
    const abs = parseAmount(t.transaction_amount?.amount, '.');
    if (!date || abs === null || abs === 0) {
      invalid++;
      continue;
    }
    // l'importo può arrivare già con segno; l'indicatore CRDT/DBIT ha la precedenza
    const amount = t.credit_debit_indicator === 'DBIT' ? -Math.abs(abs) : t.credit_debit_indicator === 'CRDT' ? Math.abs(abs) : abs;
    const description = describe(t);
    const ref = t.transaction_id || t.entry_reference;
    const prefix = isPending ? `eb:${linkId}:p:` : `eb:${linkId}:`;
    let externalId: string;
    if (ref) externalId = `${prefix}${ref}`;
    else {
      const key = `${isPending ? 'p' : 'b'}|${date}|${amount}|${normalizeText(description)}`;
      const n = (occurrences.get(key) ?? 0) + 1;
      occurrences.set(key, n);
      externalId = `${prefix}h${sha256(`${key}|${n}`).slice(0, 24)}`;
    }
    const cpIban = (amount > 0 ? t.debtor_account?.iban : t.creditor_account?.iban)?.replace(/\s/g, '').toUpperCase() || undefined;
    (isPending ? pending : mapped).push({ externalId, date, amount, description, currency: t.transaction_amount.currency, counterpartIban: cpIban });
  }
  return { mapped, pending, invalid };
}

export const BALANCE_TYPE_LABELS: Record<string, string> = {
  CLBD: 'saldo contabile',
  ITBD: 'saldo contabile infragiornaliero',
  OPBD: 'saldo di apertura',
  PRCD: 'saldo del giorno precedente',
  XPCD: 'saldo previsto',
  ITAV: 'saldo disponibile',
  CLAV: 'saldo disponibile',
  FWAV: 'saldo disponibile futuro',
  INFO: 'saldo informativo',
  OTHR: 'altro saldo',
};

/** Saldi che contano solo i movimenti contabilizzati (da confrontare senza i movimenti in attesa). */
const BOOKED_TYPES = ['CLBD', 'ITBD', 'OPBD', 'PRCD'];
const PREFERENCE = ['CLBD', 'ITBD', 'XPCD', 'ITAV', 'CLAV', 'OPBD', 'PRCD', 'FWAV', 'INFO'];

export function isBookedBalance(type: string): boolean {
  return BOOKED_TYPES.includes(type);
}

export function balanceLabel(b: Pick<StoredBalance, 'type' | 'name'>): string {
  const std = BALANCE_TYPE_LABELS[b.type];
  if (b.name && (!std || normalizeText(b.name) !== normalizeText(std))) return std ? `${b.name} (${std})` : `${b.name} (${b.type})`;
  return std ?? b.type;
}

/** Normalizza tutti i saldi restituiti dalla banca, con una chiave stabile tra una sincronizzazione e l'altra. */
export function parseBalances(raw: RemoteBalance[]): StoredBalance[] {
  const seen = new Map<string, number>();
  const out: StoredBalance[] = [];
  for (const b of raw) {
    const amount = parseAmount(b.balance_amount?.amount, '.');
    if (amount === null) continue;
    const base = `${b.balance_type}|${(b.name ?? '').trim()}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.push({
      key: n === 1 ? base : `${base}#${n}`,
      type: b.balance_type,
      name: (b.name ?? '').trim(),
      amount,
      currency: b.balance_amount.currency,
      date: b.reference_date ?? b.last_change_date_time ?? null,
    });
  }
  return out;
}

/** Saldo di riferimento: quello scelto dall'utente, altrimenti il contabile, altrimenti il più affidabile disponibile. */
export function pickBalance(balances: StoredBalance[], preferredKey?: string | null): StoredBalance | null {
  if (!balances.length) return null;
  if (preferredKey) {
    const chosen = balances.find((b) => b.key === preferredKey);
    if (chosen) return chosen;
  }
  const rank = (t: string) => {
    const i = PREFERENCE.indexOf(t);
    return i < 0 ? 99 : i;
  };
  return [...balances].sort((a, b) => rank(a.type) - rank(b.type))[0];
}

export interface BalanceComparison {
  bank: Cents;
  /** saldo PFI confrontabile: senza movimenti in attesa se il saldo della banca è contabile */
  ours: Cents;
  difference: Cents;
  includesPending: boolean;
  /** saldo PFI comprensivo dei movimenti in attesa */
  oursWithPending: Cents;
}

export function compareBalance(link: Pick<BankLink, 'bankBalance' | 'bankBalanceType'>, initialBalance: Cents, accountTxs: Pick<Transaction, 'amount' | 'pending'>[]): BalanceComparison | null {
  if (link.bankBalance === null) return null;
  const booked = initialBalance + accountTxs.filter((t) => !t.pending).reduce((s, t) => s + t.amount, 0);
  const all = initialBalance + accountTxs.reduce((s, t) => s + t.amount, 0);
  const includesPending = !isBookedBalance(link.bankBalanceType ?? '');
  const ours = includesPending ? all : booked;
  return { bank: link.bankBalance, ours, difference: link.bankBalance - ours, includesPending, oursWithPending: all };
}

export function guessAccountType(cashAccountType?: string, name?: string): AccountType {
  const t = (cashAccountType ?? '').toUpperCase();
  if (t === 'CARD' || /carta|card/i.test(name ?? '')) return 'credit_card';
  if (t === 'SVGS') return 'deposit';
  if (t === 'LOAN') return 'loan';
  return 'checking';
}
