import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../database/db';
import { canonicalJSON, createBackup, parseBackupText, restoreBackup, validateBackup } from '../../services/backup';
import * as repo from '../../services/repository';
import { sha256 } from '../../utils/sha256';
import { resetDb } from '../dbReset';

beforeEach(resetDb);

async function seed() {
  const a = await repo.createAccount({ name: 'C', institution: 'B', type: 'checking', currency: 'EUR', initialBalance: 1000, createdAt: '2024-01-01' });
  await repo.createTransaction({ accountId: a, date: '2024-01-02', description: 'Spesa', amount: 500, type: 'expense', categoryId: null });
  await repo.createAsset({ name: 'ETF', type: 'etf', quantity: 1, purchasePrice: 100, currentPrice: 120, currency: 'EUR', updatedAt: '2024-01-01' });
  await repo.createGoal({ name: 'G', targetAmount: 1000, currentAmount: 10, targetDate: null, priority: 'low', description: '' });
  await repo.upsertBudget('2024-01', null, 5000);
}

describe('sha256', () => {
  it('vettori di test noti', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });
  it('JSON canonico indipendente dall’ordine delle chiavi', () => {
    expect(canonicalJSON({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(canonicalJSON({ a: [1, { c: 3, d: 2 }], b: 1 }));
  });
});

describe('backup', () => {
  it('esporta e ripristina in modo fedele (round-trip via JSON)', async () => {
    await seed();
    const b = await createBackup();
    expect(b.counts.accounts).toBe(1);
    const text = JSON.stringify(b);
    const before = await db.transactions.toArray();

    await repo.wipeAllData();
    expect(await db.transactions.count()).toBe(0);

    const v = parseBackupText(text);
    expect(v.ok).toBe(true);
    await restoreBackup(v.backup!);
    expect(await db.transactions.toArray()).toEqual(before);
    expect(await db.assets.count()).toBe(1);
    expect(await db.asset_valuations.count()).toBe(1);
    expect(await db.budgets.count()).toBe(1);
  });
  it('rileva manomissioni tramite checksum', async () => {
    await seed();
    const b = JSON.parse(JSON.stringify(await createBackup()));
    b.data.transactions[0].amount = -1;
    const v = validateBackup(b);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/Checksum/);
  });
  it('rifiuta file non validi o di versioni future', () => {
    expect(parseBackupText('{nope').errors[0]).toMatch(/JSON/);
    expect(validateBackup({ format: 'altro' }).ok).toBe(false);
    expect(validateBackup({ format: 'pfi-backup', version: 99, data: {} }).errors[0]).toMatch(/più recente/);
  });
  it('rifiuta importi non interi e riferimenti orfani', async () => {
    await seed();
    const b = JSON.parse(JSON.stringify(await createBackup()));
    b.data.transactions[0].amount = 1.5;
    expect(validateBackup(b).errors.join(' ')).toMatch(/intero/);
    const c = JSON.parse(JSON.stringify(await createBackup()));
    c.data.transactions[0].accountId = 'ghost';
    expect(validateBackup(c).errors.join(' ')).toMatch(/conti inesistenti/);
  });
  it('in caso di backup non valido i dati esistenti non vengono toccati', async () => {
    await seed();
    const b = JSON.parse(JSON.stringify(await createBackup()));
    b.checksum = 'x';
    await expect(restoreBackup(b)).rejects.toThrow();
    expect(await db.accounts.count()).toBe(1);
  });
});
