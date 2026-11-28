/**
 * Livello di persistenza: tutte le scritture passano da qui, con validazione e transazioni atomiche.
 */
import { db } from '../database/db';
import { defaultCategories, FALLBACK_CATEGORY } from '../database/seed';
import type {
  Account,
  AppSettings,
  Asset,
  Budget,
  Category,
  Cents,
  ISODate,
  ISOMonth,
  SavingsGoal,
  Transaction,
  TransactionType,
} from '../types';
import { todayISO } from '../utils/date';
import { normalizeText } from '../utils/text';
import { uid } from '../utils/id';
import { fingerprint, type PreviewRow } from './importParser';
import { ACCOUNT_TYPES, ASSET_TYPES, check, PRIORITIES, ValidationError } from './validation';

const nowStamp = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Impostazioni
// ---------------------------------------------------------------------------

export const DEFAULT_SETTINGS: AppSettings = { baseCurrency: 'EUR', exchangeRates: {} };

export async function getSettings(): Promise<AppSettings> {
  const rows = await db.settings.toArray();
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    baseCurrency: (map.get('baseCurrency') as string) ?? DEFAULT_SETTINGS.baseCurrency,
    exchangeRates: (map.get('exchangeRates') as Record<string, number>) ?? {},
  };
}

export async function saveSettings(s: AppSettings): Promise<void> {
  check().currency(s.baseCurrency).done();
  const rates: Record<string, number> = {};
  for (const [k, v] of Object.entries(s.exchangeRates)) {
    if (!/^[A-Z]{3}$/.test(k) || k === s.baseCurrency) continue;
    if (!Number.isFinite(v) || v <= 0) throw new ValidationError([`Tasso di cambio non valido per ${k}.`]);
    rates[k] = v;
  }
  await db.settings.bulkPut([
    { key: 'baseCurrency', value: s.baseCurrency },
    { key: 'exchangeRates', value: rates },
  ]);
}

// ---------------------------------------------------------------------------
// Conti
// ---------------------------------------------------------------------------

export type AccountInput = Omit<Account, 'id' | 'archived'> & { archived?: boolean };

function validateAccount(a: AccountInput) {
  check()
    .text(a.name, 'Nome', { max: 80 })
    .text(a.institution ?? '', 'Istituto', { min: 0, max: 80 })
    .oneOf(a.type, ACCOUNT_TYPES, 'Tipologia')
    .currency(a.currency)
    .cents(a.initialBalance, 'Saldo iniziale')
    .date(a.createdAt, 'Data di creazione')
    .done();
}

export async function createAccount(input: AccountInput): Promise<string> {
  validateAccount(input);
  const id = uid();
  await db.accounts.add({ ...input, name: input.name.trim(), institution: input.institution.trim(), archived: input.archived ?? false, id });
  return id;
}

export async function updateAccount(id: string, input: AccountInput): Promise<void> {
  validateAccount(input);
  await db.transaction('rw', db.accounts, db.transactions, async () => {
    const existing = await db.accounts.get(id);
    if (!existing) throw new ValidationError(['Conto non trovato.']);
    const count = await db.transactions.where('accountId').equals(id).count();
    if (count > 0 && existing.currency !== input.currency) {
      throw new ValidationError(['Non puoi cambiare la valuta di un conto che ha già movimenti.']);
    }
    await db.accounts.put({ ...existing, ...input, name: input.name.trim(), institution: input.institution.trim(), id });
  });
}

/**
 * Elimina un conto con tutti i suoi movimenti. Le gambe dei trasferimenti sugli altri conti
 * vengono convertite in entrate/uscite normali, così i saldi degli altri conti restano corretti.
 */
export async function deleteAccount(id: string): Promise<void> {
  await db.transaction('rw', [db.accounts, db.transactions, db.import_batches, db.bank_links], async () => {
    await db.bank_links.where('accountId').equals(id).modify({ accountId: null, lastBookingDate: null, lastSyncAt: null });
    const own = await db.transactions.where('accountId').equals(id).toArray();
    const transferIds = own.filter((t) => t.transferId).map((t) => t.transferId!);
    if (transferIds.length) {
      const legs = await db.transactions.where('transferId').anyOf(transferIds).toArray();
      for (const leg of legs) {
        if (leg.accountId === id) continue;
        const type: TransactionType = leg.amount >= 0 ? 'income' : 'expense';
        await db.transactions.update(leg.id, {
          type,
          categoryId: FALLBACK_CATEGORY[type],
          transferId: undefined,
          counterAccountId: undefined,
          notes: [leg.notes, 'Trasferimento da/verso un conto eliminato'].filter(Boolean).join(' · '),
          updatedAt: nowStamp(),
        });
      }
    }
    await db.transactions.where('accountId').equals(id).delete();
    await db.import_batches.where('accountId').equals(id).delete();
    await db.accounts.delete(id);
  });
}

// ---------------------------------------------------------------------------
// Movimenti
// ---------------------------------------------------------------------------

export interface TransactionInput {
  accountId: string;
  date: ISODate;
  description: string;
  /** Importo assoluto in centesimi (> 0). Il segno dipende dal tipo. */
  amount: Cents;
  type: 'income' | 'expense';
  categoryId: string | null;
  notes?: string;
}

async function validateTransactionInput(t: TransactionInput): Promise<{ account: Account; category: Category | undefined }> {
  check()
    .date(t.date, 'Data')
    .text(t.description, 'Descrizione', { max: 300 })
    .cents(t.amount, 'Importo', { allowNegative: false, allowZero: false })
    .oneOf(t.type, ['income', 'expense'] as const, 'Tipologia')
    .done();
  const account = await db.accounts.get(t.accountId);
  if (!account) throw new ValidationError(['Conto non valido.']);
  let category: Category | undefined;
  if (t.categoryId) {
    category = await db.categories.get(t.categoryId);
    if (!category) throw new ValidationError(['Categoria non valida.']);
    if (category.kind !== t.type) throw new ValidationError(['La categoria non corrisponde al tipo di movimento.']);
  }
  return { account, category };
}

export async function createTransaction(input: TransactionInput): Promise<string> {
  const { account } = await validateTransactionInput(input);
  const signed = input.type === 'income' ? input.amount : -input.amount;
  const id = uid();
  const stamp = nowStamp();
  await db.transactions.add({
    id,
    accountId: input.accountId,
    date: input.date,
    description: input.description.trim(),
    amount: signed,
    type: input.type,
    categoryId: input.categoryId ?? FALLBACK_CATEGORY[input.type],
    currency: account.currency,
    notes: input.notes?.trim() || undefined,
    fingerprint: fingerprint(input.accountId, input.date, signed, input.description),
    createdAt: stamp,
    updatedAt: stamp,
  });
  return id;
}

export async function updateTransaction(id: string, input: TransactionInput): Promise<void> {
  const existing = await db.transactions.get(id);
  if (!existing) throw new ValidationError(['Movimento non trovato.']);
  if (existing.type === 'transfer') throw new ValidationError(['Usa la modifica del trasferimento.']);
  const { account } = await validateTransactionInput(input);
  const signed = input.type === 'income' ? input.amount : -input.amount;
  await db.transactions.put({
    ...existing,
    accountId: input.accountId,
    date: input.date,
    description: input.description.trim(),
    amount: signed,
    type: input.type,
    categoryId: input.categoryId ?? FALLBACK_CATEGORY[input.type],
    currency: account.currency,
    notes: input.notes?.trim() || undefined,
    fingerprint: fingerprint(input.accountId, input.date, signed, input.description),
    updatedAt: nowStamp(),
  });
}

/** Elimina un movimento; per i trasferimenti elimina entrambe le gambe. */
export async function deleteTransaction(id: string): Promise<void> {
  await db.transaction('rw', db.transactions, async () => {
    const t = await db.transactions.get(id);
    if (!t) return;
    if (t.transferId) await db.transactions.where('transferId').equals(t.transferId).delete();
    else await db.transactions.delete(id);
  });
}

export async function deleteTransactions(ids: string[]): Promise<number> {
  let removed = 0;
  await db.transaction('rw', db.transactions, async () => {
    const rows = await db.transactions.bulkGet(ids);
    const transferIds = new Set<string>();
    const plain: string[] = [];
    for (const r of rows) {
      if (!r) continue;
      if (r.transferId) transferIds.add(r.transferId);
      else plain.push(r.id);
    }
    await db.transactions.bulkDelete(plain);
    removed += plain.length;
    if (transferIds.size) removed += await db.transactions.where('transferId').anyOf([...transferIds]).delete();
  });
  return removed;
}

export interface TransferInput {
  fromAccountId: string;
  toAccountId: string;
  date: ISODate;
  /** Importo addebitato sul conto di origine (> 0). */
  amount: Cents;
  /** Importo accreditato sul conto di destinazione, se in valuta diversa. Default = amount. */
  toAmount?: Cents;
  description: string;
  notes?: string;
}

async function buildTransferLegs(input: TransferInput, transferId: string, createdAt?: string): Promise<[Transaction, Transaction]> {
  check()
    .date(input.date, 'Data')
    .cents(input.amount, 'Importo', { allowNegative: false, allowZero: false })
    .text(input.description, 'Descrizione', { min: 0, max: 300 })
    .require(input.fromAccountId !== input.toAccountId, 'Il conto di origine e quello di destinazione devono essere diversi.')
    .done();
  const [from, to] = await db.accounts.bulkGet([input.fromAccountId, input.toAccountId]);
  if (!from || !to) throw new ValidationError(['Conto non valido.']);
  const toAmount = input.toAmount ?? input.amount;
  if (from.currency !== to.currency && input.toAmount === undefined) {
    throw new ValidationError(["Conti in valute diverse: indica l'importo accreditato sul conto di destinazione."]);
  }
  check().cents(toAmount, 'Importo accreditato', { allowNegative: false, allowZero: false }).done();
  const stamp = nowStamp();
  const desc = input.description.trim() || `Trasferimento ${from.name} → ${to.name}`;
  const base = { date: input.date, description: desc, type: 'transfer' as const, categoryId: null, transferId, notes: input.notes?.trim() || undefined, createdAt: createdAt ?? stamp, updatedAt: stamp };
  return [
    { ...base, id: uid(), accountId: from.id, counterAccountId: to.id, amount: -input.amount, currency: from.currency, fingerprint: fingerprint(from.id, input.date, -input.amount, desc) },
    { ...base, id: uid(), accountId: to.id, counterAccountId: from.id, amount: toAmount, currency: to.currency, fingerprint: fingerprint(to.id, input.date, toAmount, desc) },
  ];
}

export async function createTransfer(input: TransferInput): Promise<string> {
  const transferId = uid();
  const legs = await buildTransferLegs(input, transferId);
  await db.transactions.bulkAdd(legs);
  return transferId;
}

export async function updateTransfer(transferId: string, input: TransferInput): Promise<void> {
  await db.transaction('rw', db.transactions, db.accounts, async () => {
    const old = await db.transactions.where('transferId').equals(transferId).toArray();
    if (old.length === 0) throw new ValidationError(['Trasferimento non trovato.']);
    const legs = await buildTransferLegs(input, transferId, old[0].createdAt);
    await db.transactions.where('transferId').equals(transferId).delete();
    await db.transactions.bulkAdd(legs);
  });
}

/** Converte una coppia di movimenti esistenti (uscita su A, entrata su B) in un trasferimento. */
export async function linkAsTransfer(outId: string, inId: string): Promise<string> {
  const transferId = uid();
  await db.transaction('rw', db.transactions, async () => {
    const [out, inn] = await db.transactions.bulkGet([outId, inId]);
    if (!out || !inn) throw new ValidationError(['Movimenti non trovati.']);
    if (out.amount >= 0 || inn.amount <= 0) throw new ValidationError(["Serve un'uscita e un'entrata."]);
    if (out.accountId === inn.accountId) throw new ValidationError(['I movimenti devono essere su conti diversi.']);
    const stamp = nowStamp();
    await db.transactions.update(out.id, { type: 'transfer', categoryId: null, transferId, counterAccountId: inn.accountId, updatedAt: stamp });
    await db.transactions.update(inn.id, { type: 'transfer', categoryId: null, transferId, counterAccountId: out.accountId, updatedAt: stamp });
  });
  return transferId;
}

/** Marca un singolo movimento come giroconto (escluso da entrate/uscite) senza bisogno di una coppia. */
export async function markAsTransfer(txId: string): Promise<void> {
  await db.transaction('rw', db.transactions, async () => {
    const t = await db.transactions.get(txId);
    if (!t) throw new ValidationError(['Movimento non trovato.']);
    if (t.type === 'transfer') return; // già marcato
    await db.transactions.update(txId, { type: 'transfer', categoryId: null, updatedAt: nowStamp() });
  });
}

/** Ripristina un movimento marcato come giroconto al suo tipo originale (income/expense). */
export async function unmarkTransfer(txId: string): Promise<void> {
  await db.transaction('rw', db.transactions, async () => {
    const t = await db.transactions.get(txId);
    if (!t) throw new ValidationError(['Movimento non trovato.']);
    if (t.type !== 'transfer') return;
    // Se era linkato a un'altra transazione, scollega anche quella
    if (t.transferId) {
      const other = (await db.transactions.where('transferId').equals(t.transferId).toArray()).find((x) => x.id !== txId);
      if (other) {
        const otherType = other.amount > 0 ? 'income' : 'expense';
        await db.transactions.update(other.id, { type: otherType, transferId: undefined, counterAccountId: undefined, updatedAt: nowStamp() });
      }
    }
    const type = t.amount > 0 ? 'income' : 'expense';
    await db.transactions.update(txId, { type, transferId: undefined, counterAccountId: undefined, updatedAt: nowStamp() });
  });
}

// ---------------------------------------------------------------------------
// Importazione
// ---------------------------------------------------------------------------

export async function existingFingerprintCounts(accountId: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  await db.transactions
    .where('accountId')
    .equals(accountId)
    .each((t) => {
      if (t.fingerprint) map.set(t.fingerprint, (map.get(t.fingerprint) ?? 0) + 1);
    });
  return map;
}

export async function learnedCategoryMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const all = await db.transactions.orderBy('date').toArray();
  for (const t of all) if (t.categoryId && t.type !== 'transfer') map.set(normalizeText(t.description), t.categoryId);
  return map;
}

export async function commitImport(rows: PreviewRow[], accountId: string, fileName: string): Promise<{ batchId: string; count: number }> {
  const account = await db.accounts.get(accountId);
  if (!account) throw new ValidationError(['Conto non valido.']);
  const valid = rows.filter((r) => r.selected && r.errors.length === 0 && r.date && r.amount && r.type);
  if (valid.length === 0) throw new ValidationError(['Nessun movimento valido selezionato.']);
  const categories = new Set((await db.categories.toArray()).map((c) => c.id));
  const batchId = uid();
  const stamp = nowStamp();
  const txs: Transaction[] = valid.map((r) => ({
    id: uid(),
    accountId,
    date: r.date!,
    description: r.description,
    amount: r.amount!,
    type: r.type!,
    categoryId: r.categoryId && categories.has(r.categoryId) ? r.categoryId : FALLBACK_CATEGORY[r.type!],
    currency: account.currency,
    importBatchId: batchId,
    fingerprint: r.fingerprint || fingerprint(accountId, r.date!, r.amount!, r.description),
    createdAt: stamp,
    updatedAt: stamp,
  }));
  await db.transaction('rw', db.transactions, db.import_batches, async () => {
    await db.transactions.bulkAdd(txs);
    await db.import_batches.add({ id: batchId, fileName, accountId, importedAt: stamp, count: txs.length });
  });
  return { batchId, count: txs.length };
}

export async function undoImport(batchId: string): Promise<number> {
  let n = 0;
  await db.transaction('rw', db.transactions, db.import_batches, async () => {
    n = await db.transactions.where('importBatchId').equals(batchId).delete();
    await db.import_batches.delete(batchId);
  });
  return n;
}

/**
 * Corregge il saldo iniziale del conto perché alla data `asOf` il saldo calcolato sia `target`
 * (es. il saldo finale riportato sull'estratto conto). Restituisce la correzione applicata.
 */
export async function alignBalanceAt(accountId: string, target: Cents, asOf: ISODate): Promise<Cents> {
  return db.transaction('rw', db.accounts, db.transactions, async () => {
    const acc = await db.accounts.get(accountId);
    if (!acc) throw new ValidationError(['Conto non trovato.']);
    const txs = await db.transactions.where('accountId').equals(accountId).toArray();
    const current = acc.initialBalance + txs.filter((t) => t.date <= asOf).reduce((s, t) => s + t.amount, 0);
    const diff = target - current;
    if (diff !== 0) await db.accounts.update(accountId, { initialBalance: acc.initialBalance + diff });
    return diff;
  });
}

// ---------------------------------------------------------------------------
// Categorie
// ---------------------------------------------------------------------------

export type CategoryInput = Pick<Category, 'name' | 'kind' | 'color' | 'icon'>;

export async function createCategory(input: CategoryInput): Promise<string> {
  check().text(input.name, 'Nome', { max: 40 }).oneOf(input.kind, ['income', 'expense'] as const, 'Tipo').done();
  const dup = await db.categories.where('kind').equals(input.kind).filter((c) => c.name.toLowerCase() === input.name.trim().toLowerCase()).count();
  if (dup) throw new ValidationError(['Esiste già una categoria con questo nome.']);
  const id = uid();
  await db.categories.add({ ...input, name: input.name.trim(), id, isDefault: false });
  return id;
}

export async function updateCategory(id: string, input: Pick<Category, 'name' | 'color' | 'icon'>): Promise<void> {
  check().text(input.name, 'Nome', { max: 40 }).done();
  const c = await db.categories.get(id);
  if (!c) throw new ValidationError(['Categoria non trovata.']);
  await db.categories.update(id, { name: input.name.trim(), color: input.color, icon: input.icon });
}

/** Elimina una categoria personalizzata: i movimenti passano alla categoria "Altre…", i budget collegati vengono rimossi. */
export async function deleteCategory(id: string): Promise<void> {
  await db.transaction('rw', db.categories, db.transactions, db.budgets, async () => {
    const c = await db.categories.get(id);
    if (!c) return;
    if (c.isDefault) throw new ValidationError(['Le categorie predefinite non possono essere eliminate.']);
    await db.transactions.where('categoryId').equals(id).modify({ categoryId: FALLBACK_CATEGORY[c.kind] });
    await db.budgets.where('categoryId').equals(id).delete();
    await db.categories.delete(id);
  });
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

export async function upsertBudget(month: ISOMonth, categoryId: string | null, limit: Cents): Promise<string> {
  check()
    .require(/^\d{4}-\d{2}$/.test(month), 'Mese non valido.')
    .cents(limit, 'Limite', { allowNegative: false, allowZero: false })
    .done();
  if (categoryId) {
    const c = await db.categories.get(categoryId);
    if (!c || c.kind !== 'expense') throw new ValidationError(['Il budget può essere assegnato solo a categorie di uscita.']);
  }
  const existing = await db.budgets.where('month').equals(month).filter((b) => b.categoryId === categoryId).first();
  if (existing) {
    await db.budgets.update(existing.id, { limit });
    return existing.id;
  }
  const id = uid();
  await db.budgets.add({ id, month, categoryId, limit });
  return id;
}

export async function deleteBudget(id: string): Promise<void> {
  await db.budgets.delete(id);
}

/** Copia i budget di un mese in un altro (sovrascrive i limiti già presenti). */
export async function copyBudgets(from: ISOMonth, to: ISOMonth): Promise<number> {
  const src = await db.budgets.where('month').equals(from).toArray();
  if (src.length === 0) throw new ValidationError(['Il mese di origine non ha budget.']);
  await db.transaction('rw', db.budgets, db.categories, async () => {
    for (const b of src) await upsertBudget(to, b.categoryId, b.limit);
  });
  return src.length;
}

// ---------------------------------------------------------------------------
// Obiettivi
// ---------------------------------------------------------------------------

export type GoalInput = Omit<SavingsGoal, 'id' | 'createdAt'>;

function validateGoal(g: GoalInput) {
  check()
    .text(g.name, 'Nome', { max: 80 })
    .cents(g.targetAmount, 'Importo desiderato', { allowNegative: false, allowZero: false })
    .cents(g.currentAmount, 'Importo accumulato', { allowNegative: false })
    .date(g.targetDate, 'Data obiettivo', true)
    .oneOf(g.priority, PRIORITIES, 'Priorità')
    .text(g.description ?? '', 'Descrizione', { min: 0, max: 500 })
    .done();
}

export async function createGoal(input: GoalInput): Promise<string> {
  validateGoal(input);
  const id = uid();
  await db.savings_goals.add({ ...input, name: input.name.trim(), targetDate: input.targetDate || null, id, createdAt: todayISO() });
  return id;
}

export async function updateGoal(id: string, input: GoalInput): Promise<void> {
  validateGoal(input);
  const g = await db.savings_goals.get(id);
  if (!g) throw new ValidationError(['Obiettivo non trovato.']);
  await db.savings_goals.put({ ...g, ...input, name: input.name.trim(), targetDate: input.targetDate || null });
}

export async function contributeToGoal(id: string, delta: Cents): Promise<void> {
  check().cents(delta, 'Importo', { allowZero: false }).done();
  await db.transaction('rw', db.savings_goals, async () => {
    const g = await db.savings_goals.get(id);
    if (!g) throw new ValidationError(['Obiettivo non trovato.']);
    const next = g.currentAmount + delta;
    if (next < 0) throw new ValidationError(["Non puoi prelevare più dell'importo accumulato."]);
    await db.savings_goals.update(id, { currentAmount: next });
  });
}

export async function deleteGoal(id: string): Promise<void> {
  await db.savings_goals.delete(id);
}

// ---------------------------------------------------------------------------
// Asset
// ---------------------------------------------------------------------------

export type AssetInput = Omit<Asset, 'id'>;

function validateAsset(a: AssetInput) {
  check()
    .text(a.name, 'Nome', { max: 80 })
    .oneOf(a.type, ASSET_TYPES, 'Categoria')
    .require(Number.isFinite(a.quantity) && a.quantity > 0 && a.quantity < 1e12, 'Quantità: deve essere maggiore di zero.')
    .cents(a.purchasePrice, 'Prezzo di acquisto', { allowNegative: false })
    .cents(a.currentPrice, 'Valore corrente', { allowNegative: false })
    .currency(a.currency)
    .date(a.updatedAt, 'Data di aggiornamento')
    .require(a.purchaseDate === undefined || /^\d{4}-\d{2}-\d{2}$/.test(a.purchaseDate), 'Data di acquisto non valida.')
    .require(a.depreciationRate === undefined || (Number.isFinite(a.depreciationRate) && a.depreciationRate >= 0 && a.depreciationRate < 100), 'Deprezzamento annuo: tra 0% e 99%.')
    .done();
}

export async function createAsset(input: AssetInput): Promise<string> {
  validateAsset(input);
  const id = uid();
  await db.transaction('rw', db.assets, db.asset_valuations, async () => {
    await db.assets.add({ ...input, name: input.name.trim(), id });
    await db.asset_valuations.add({ id: uid(), assetId: id, date: input.updatedAt, unitPrice: input.currentPrice, quantity: input.quantity });
  });
  return id;
}

export async function updateAsset(id: string, input: AssetInput): Promise<void> {
  validateAsset(input);
  await db.transaction('rw', db.assets, db.asset_valuations, async () => {
    const old = await db.assets.get(id);
    if (!old) throw new ValidationError(['Asset non trovato.']);
    await db.assets.put({ ...input, name: input.name.trim(), id });
    if (old.currentPrice !== input.currentPrice || old.quantity !== input.quantity || old.updatedAt !== input.updatedAt) {
      await recordValuation(id, input.updatedAt, input.currentPrice, input.quantity);
    }
  });
}

/** Registra (o sostituisce) la valutazione di un asset per una data. */
async function recordValuation(assetId: string, date: ISODate, unitPrice: Cents, quantity: number) {
  const same = await db.asset_valuations.where('[assetId+date]').equals([assetId, date]).toArray();
  await db.asset_valuations.bulkDelete(same.map((v) => v.id));
  await db.asset_valuations.add({ id: uid(), assetId, date, unitPrice, quantity });
}

export async function updateAssetPrice(id: string, unitPrice: Cents, date: ISODate): Promise<void> {
  check().cents(unitPrice, 'Valore corrente', { allowNegative: false }).date(date, 'Data').done();
  await db.transaction('rw', db.assets, db.asset_valuations, async () => {
    const a = await db.assets.get(id);
    if (!a) throw new ValidationError(['Asset non trovato.']);
    if (date >= a.updatedAt) await db.assets.update(id, { currentPrice: unitPrice, updatedAt: date });
    await recordValuation(id, date, unitPrice, a.quantity);
  });
}

export async function deleteAsset(id: string): Promise<void> {
  await db.transaction('rw', db.assets, db.asset_valuations, async () => {
    await db.asset_valuations.where('assetId').equals(id).delete();
    await db.assets.delete(id);
  });
}

// ---------------------------------------------------------------------------
// Cancellazione completa
// ---------------------------------------------------------------------------

export async function wipeAllData(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });
  // ripristina le categorie predefinite e le impostazioni di base
  await db.categories.bulkAdd(defaultCategories());
  await db.settings.bulkPut([
    { key: 'baseCurrency', value: 'EUR' },
    { key: 'exchangeRates', value: {} },
  ]);
  try {
    localStorage.removeItem('pfi.prefs');
  } catch {
    /* storage non disponibile */
  }
}

export type { Budget };
