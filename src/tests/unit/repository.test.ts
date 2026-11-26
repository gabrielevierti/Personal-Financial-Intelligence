import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../database/db';
import { accountBalance } from '../../services/finance';
import { buildPreview, detectHeaderRow, guessMapping } from '../../services/importParser';
import { parseCsvText } from '../../services/fileReader';
import * as repo from '../../services/repository';
import { ValidationError } from '../../services/validation';
import { resetDb } from '../dbReset';

const acc = (p: Partial<repo.AccountInput> = {}): repo.AccountInput => ({
  name: 'Conto corrente',
  institution: 'Banca',
  type: 'checking',
  currency: 'EUR',
  initialBalance: 100000,
  createdAt: '2024-01-01',
  ...p,
});

async function balance(id: string) {
  const a = (await db.accounts.get(id))!;
  return accountBalance(a, await db.transactions.toArray());
}

beforeEach(resetDb);

describe('database', () => {
  it('popola categorie predefinite e impostazioni', async () => {
    expect(await db.categories.count()).toBe(21);
    expect(await repo.getSettings()).toEqual({ baseCurrency: 'EUR', exchangeRates: {} });
  });
});

describe('conti', () => {
  it('CRUD completo', async () => {
    const id = await repo.createAccount(acc());
    expect((await db.accounts.get(id))?.name).toBe('Conto corrente');
    await repo.updateAccount(id, acc({ name: 'Principale' }));
    expect((await db.accounts.get(id))?.name).toBe('Principale');
    await repo.deleteAccount(id);
    expect(await db.accounts.count()).toBe(0);
  });
  it('valida gli input', async () => {
    await expect(repo.createAccount(acc({ name: '' }))).rejects.toBeInstanceOf(ValidationError);
    await expect(repo.createAccount(acc({ currency: 'euro' }))).rejects.toThrow(/Valuta/);
    await expect(repo.createAccount(acc({ initialBalance: 10.5 }))).rejects.toThrow(/importo/);
  });
  it('impedisce il cambio valuta con movimenti presenti', async () => {
    const id = await repo.createAccount(acc());
    await repo.createTransaction({ accountId: id, date: '2024-01-02', description: 'x', amount: 100, type: 'expense', categoryId: null });
    await expect(repo.updateAccount(id, acc({ currency: 'USD' }))).rejects.toThrow(/valuta/);
  });
});

describe('movimenti', () => {
  it('crea, modifica, elimina con saldo calcolato', async () => {
    const a = await repo.createAccount(acc());
    const t = await repo.createTransaction({ accountId: a, date: '2024-01-05', description: 'Spesa', amount: 2550, type: 'expense', categoryId: 'exp-groceries' });
    expect(await balance(a)).toBe(97450);
    await repo.updateTransaction(t, { accountId: a, date: '2024-01-05', description: 'Spesa', amount: 1000, type: 'expense', categoryId: 'exp-groceries' });
    expect(await balance(a)).toBe(99000);
    await repo.deleteTransaction(t);
    expect(await balance(a)).toBe(100000);
  });
  it('rifiuta categoria incoerente e importo zero', async () => {
    const a = await repo.createAccount(acc());
    await expect(repo.createTransaction({ accountId: a, date: '2024-01-05', description: 'x', amount: 100, type: 'expense', categoryId: 'inc-salary' })).rejects.toThrow(/categoria/);
    await expect(repo.createTransaction({ accountId: a, date: '2024-01-05', description: 'x', amount: 0, type: 'expense', categoryId: null })).rejects.toThrow(/zero/);
  });
});

describe('trasferimenti', () => {
  it('sposta denaro senza generare entrate/uscite e si elimina in coppia', async () => {
    const a = await repo.createAccount(acc());
    const b = await repo.createAccount(acc({ name: 'Deposito', type: 'deposit', initialBalance: 0 }));
    const tid = await repo.createTransfer({ fromAccountId: a, toAccountId: b, date: '2024-01-10', amount: 30000, description: '' });
    expect(await balance(a)).toBe(70000);
    expect(await balance(b)).toBe(30000);
    const legs = await db.transactions.where('transferId').equals(tid).toArray();
    expect(legs.every((l) => l.type === 'transfer' && l.categoryId === null)).toBe(true);
    await repo.updateTransfer(tid, { fromAccountId: a, toAccountId: b, date: '2024-01-10', amount: 10000, description: 'Giroconto' });
    expect(await balance(b)).toBe(10000);
    const newLegs = await db.transactions.where('transferId').equals(tid).toArray();
    expect(newLegs).toHaveLength(2);
    await repo.deleteTransaction(newLegs[0].id);
    expect(await db.transactions.count()).toBe(0);
  });
  it('richiede l’importo di destinazione tra valute diverse', async () => {
    const a = await repo.createAccount(acc());
    const b = await repo.createAccount(acc({ name: 'USD', currency: 'USD' }));
    await expect(repo.createTransfer({ fromAccountId: a, toAccountId: b, date: '2024-01-10', amount: 100, description: '' })).rejects.toThrow(/valute diverse/);
    await repo.createTransfer({ fromAccountId: a, toAccountId: b, date: '2024-01-10', amount: 10000, toAmount: 10800, description: '' });
    expect(await balance(b)).toBe(110800);
  });
  it('rifiuta trasferimento sullo stesso conto', async () => {
    const a = await repo.createAccount(acc());
    await expect(repo.createTransfer({ fromAccountId: a, toAccountId: a, date: '2024-01-10', amount: 100, description: '' })).rejects.toThrow(/diversi/);
  });
  it('eliminando un conto, la gamba sull’altro conto diventa un movimento normale', async () => {
    const a = await repo.createAccount(acc());
    const b = await repo.createAccount(acc({ name: 'B', initialBalance: 0 }));
    await repo.createTransfer({ fromAccountId: a, toAccountId: b, date: '2024-01-10', amount: 5000, description: '' });
    await repo.deleteAccount(a);
    const rest = await db.transactions.toArray();
    expect(rest).toHaveLength(1);
    expect(rest[0]).toMatchObject({ accountId: b, type: 'income', categoryId: 'inc-other', amount: 5000 });
    expect(await balance(b)).toBe(5000);
  });
  it('collega due movimenti esistenti come trasferimento', async () => {
    const a = await repo.createAccount(acc());
    const b = await repo.createAccount(acc({ name: 'B' }));
    const o = await repo.createTransaction({ accountId: a, date: '2024-01-05', description: 'Bonifico', amount: 500, type: 'expense', categoryId: null });
    const i = await repo.createTransaction({ accountId: b, date: '2024-01-05', description: 'Bonifico', amount: 500, type: 'income', categoryId: null });
    await repo.linkAsTransfer(o, i);
    expect((await db.transactions.get(o))?.type).toBe('transfer');
  });
});

describe('importazione', () => {
  it('importa, riconosce i duplicati alla seconda importazione e consente l’annullamento', async () => {
    const a = await repo.createAccount(acc({ initialBalance: 0 }));
    const rows = parseCsvText('Data;Descrizione;Importo\n01/02/2024;Stipendio;1.000,00\n02/02/2024;Spesa;-50,00\n');
    const h = detectHeaderRow(rows);
    const m = guessMapping(rows[h]);
    const opts = { dateFormat: 'auto' as const, decimal: 'auto' as const, invertSign: false, accountId: a, accountCurrency: 'EUR' };
    const ctx = async () => ({ categories: await db.categories.toArray(), existingFingerprints: await repo.existingFingerprintCounts(a) });
    const first = buildPreview(rows, h, m, opts, await ctx());
    const { batchId, count } = await repo.commitImport(first, a, 'estratto.csv');
    expect(count).toBe(2);
    expect(await balance(a)).toBe(95000);

    const second = buildPreview(rows, h, m, opts, await ctx());
    expect(second.every((r) => r.duplicate === 'existing' && !r.selected)).toBe(true);
    await expect(repo.commitImport(second, a, 'estratto.csv')).rejects.toThrow(/Nessun movimento/);

    expect(await repo.undoImport(batchId)).toBe(2);
    expect(await db.transactions.count()).toBe(0);
  });
  it('un movimento inserito a mano viene riconosciuto come duplicato', async () => {
    const a = await repo.createAccount(acc());
    await repo.createTransaction({ accountId: a, date: '2024-02-02', description: 'Spesa', amount: 5000, type: 'expense', categoryId: null });
    const rows = parseCsvText('Data;Descrizione;Importo\n02/02/2024;SPESA;-50,00\n');
    const prev = buildPreview(rows, 0, guessMapping(rows[0]), { dateFormat: 'auto', decimal: 'auto', invertSign: false, accountId: a, accountCurrency: 'EUR' }, {
      categories: await db.categories.toArray(),
      existingFingerprints: await repo.existingFingerprintCounts(a),
    });
    expect(prev[0].duplicate).toBe('existing');
  });
});

describe('allineamento al saldo dell’estratto', () => {
  it('corregge il saldo iniziale in base al saldo a una data', async () => {
    const a = await repo.createAccount(acc({ initialBalance: 0 }));
    await repo.createTransaction({ accountId: a, date: '2024-01-10', description: 'x', amount: 2000, type: 'expense', categoryId: null });
    await repo.createTransaction({ accountId: a, date: '2024-03-10', description: 'dopo', amount: 500, type: 'expense', categoryId: null });
    expect(await repo.alignBalanceAt(a, 100000, '2024-01-31')).toBe(102000);
    const acct = (await db.accounts.get(a))!;
    expect(accountBalance(acct, await db.transactions.toArray(), '2024-01-31')).toBe(100000);
    expect(await balance(a)).toBe(99500);
  });
});

describe('categorie', () => {
  it('crea categoria personalizzata ed eliminandola riassegna i movimenti', async () => {
    const a = await repo.createAccount(acc());
    const c = await repo.createCategory({ name: 'Animali', kind: 'expense', color: '#fff', icon: 'tag' });
    const t = await repo.createTransaction({ accountId: a, date: '2024-01-05', description: 'Veterinario', amount: 100, type: 'expense', categoryId: c });
    await repo.upsertBudget('2024-01', c, 1000);
    await expect(repo.createCategory({ name: 'animali', kind: 'expense', color: '#fff', icon: 'tag' })).rejects.toThrow(/Esiste già/);
    await repo.deleteCategory(c);
    expect((await db.transactions.get(t))?.categoryId).toBe('exp-other');
    expect(await db.budgets.count()).toBe(0);
    await expect(repo.deleteCategory('exp-home')).rejects.toThrow(/predefinite/);
  });
});

describe('budget, obiettivi, asset', () => {
  it('budget: upsert e copia mese', async () => {
    await repo.upsertBudget('2024-01', null, 100000);
    await repo.upsertBudget('2024-01', null, 120000);
    await repo.upsertBudget('2024-01', 'exp-home', 50000);
    expect(await db.budgets.count()).toBe(2);
    expect(await repo.copyBudgets('2024-01', '2024-02')).toBe(2);
    expect((await db.budgets.where('month').equals('2024-02').toArray()).map((b) => b.limit).sort()).toEqual([120000, 50000]);
    await expect(repo.upsertBudget('2024-01', 'inc-salary', 10)).rejects.toThrow(/uscita/);
  });
  it('obiettivi: versamenti e prelievi', async () => {
    const g = await repo.createGoal({ name: 'Vacanza', targetAmount: 100000, currentAmount: 0, targetDate: '2025-06-01', priority: 'medium', description: '' });
    await repo.contributeToGoal(g, 25000);
    await repo.contributeToGoal(g, -5000);
    expect((await db.savings_goals.get(g))?.currentAmount).toBe(20000);
    await expect(repo.contributeToGoal(g, -50000)).rejects.toThrow(/prelevare/);
    await repo.deleteGoal(g);
    expect(await db.savings_goals.count()).toBe(0);
  });
  it('asset: storico valutazioni', async () => {
    const id = await repo.createAsset({ name: 'VWCE', type: 'etf', quantity: 10, purchasePrice: 10000, currentPrice: 10000, currency: 'EUR', updatedAt: '2024-01-01' });
    await repo.updateAssetPrice(id, 11000, '2024-02-01');
    await repo.updateAssetPrice(id, 11500, '2024-02-01');
    expect(await db.asset_valuations.count()).toBe(2);
    expect((await db.assets.get(id))?.currentPrice).toBe(11500);
    await repo.deleteAsset(id);
    expect(await db.asset_valuations.count()).toBe(0);
  });
});

describe('cancellazione completa', () => {
  it('svuota tutto e ripristina le categorie predefinite', async () => {
    await repo.createAccount(acc());
    await repo.createCategory({ name: 'X', kind: 'income', color: '#fff', icon: 'tag' });
    await repo.wipeAllData();
    expect(await db.accounts.count()).toBe(0);
    expect(await db.categories.count()).toBe(21);
  });
});
