import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../database/db';
import { DEFAULT_CATEGORIES } from '../../database/seed';
import { merchantKey, merchantSimilarity } from '../../services/merchant';
import { applyCategoryToMerchant, buildCategorizer, builtinCategory, recategorizeUncategorized } from '../../services/categorize';
import { findDuplicateAccounts, mergeAccounts } from '../../services/dataQuality';
import { accountBalance, dataCoverageStart } from '../../services/finance';
import * as repo from '../../services/repository';
import { resetDb } from '../dbReset';
import { account, tx } from '../fixtures';

const cats = DEFAULT_CATEGORIES.map((c) => ({ ...c, isDefault: true }));

describe('esercente', () => {
  it.each([
    ['Ristorante Hazama Milano It Carta N. ***** 703 Data Operazione 26/09/26', 'ristorante hazama milano'],
    ['Pam Panorama Mi-Tolsto Milano It Carta N. ***** 703 Data Operazione 27/09/26', 'pam panorama mi'],
    ['Iliad Addebito Sdd Fattura a Vs Carico da It46zzz0000013970161009', 'iliad'],
    ['Pagamento Visa Debit ESSELUNGA MILANO VIALE PIAVE', 'esselunga milano viale'],
    ['Conad Abbasanta It Carta N. ***** 703 Data Operazione 28/09/26', 'conad abbasanta'],
  ])('%s → %s', (d, k) => expect(merchantKey(d)).toBe(k));
  it('somiglianza tra descrizioni della stessa spesa da fonti diverse', () => {
    expect(merchantSimilarity('Pagamento Visa Debit ESSELUNGA MILANO', 'Esselunga Milano It Carta N. ***** 703')).toBeGreaterThanOrEqual(0.5);
    expect(merchantSimilarity('Netflix', 'Esselunga')).toBe(0);
  });
});

describe('categorie integrate', () => {
  it.each([
    ['Pam Panorama Mi-Tolsto Milano It Carta N. ***** 703', 'expense', 'exp-groceries'],
    ['Conad Abbasanta It Carta N. ***** 703', 'expense', 'exp-groceries'],
    ['Ristorante Hazama Milano It Carta N.', 'expense', 'exp-restaurants'],
    ['Briciole Pizza Reg Lin Segrate It Carta N.', 'expense', 'exp-restaurants'],
    ['Iliad Addebito Sdd Fattura a Vs Carico', 'expense', 'exp-bills'],
    ['Prima Assicurazioni Sp Milan Mi It Carta N.', 'expense', 'exp-insurance'],
    ['NETFLIX.COM', 'expense', 'exp-subscriptions'],
    ['Amazon Prime Video', 'expense', 'exp-subscriptions'],
    ['AMAZON EU SARL', 'expense', 'exp-shopping'],
    ['ATM Milano abbonamento mensile', 'expense', 'exp-transport'],
    ['ENI STATION 1234', 'expense', 'exp-transport'],
    ['Farmacia Centrale', 'expense', 'exp-health'],
    ['Accredito emolumenti NoiPA', 'income', 'inc-salary'],
    ['Interessi creditori', 'income', 'inc-interest'],
    ['Rimborso Amazon', 'income', 'inc-refund'],
  ] as const)('%s → %s', (d, k, c) => expect(builtinCategory(d, k)).toBe(c));
  it('nessuna regola per descrizioni sconosciute', () => {
    expect(builtinCategory('E1790596747235s0we Moo Milano', 'expense')).toBeNull();
  });
});

describe('categorizzatore', () => {
  it('regole utente > storico > integrate > generica', () => {
    const rules = [{ id: 'r', pattern: 'moo milano', kind: 'expense' as const, categoryId: 'exp-shopping', source: 'user' as const, createdAt: '' }];
    const history = [tx({ description: 'Bar Sport Milano', categoryId: 'exp-entertainment' }), tx({ description: 'Bar Sport Milano', categoryId: 'exp-entertainment' })];
    const c = buildCategorizer(rules, history, cats);
    expect(c.categorize('E1790596747235s0we Moo Milano It Carta N. ***** 703', 'expense')).toEqual({ categoryId: 'exp-shopping', source: 'rule' });
    expect(c.categorize('BAR SPORT MILANO Carta 703', 'expense')).toEqual({ categoryId: 'exp-entertainment', source: 'learned' });
    expect(c.categorize('Esselunga', 'expense').source).toBe('builtin');
    expect(c.categorize('Pinco pallino', 'expense')).toEqual({ categoryId: 'exp-other', source: 'fallback' });
  });
});

describe('database: categorie e qualità dati', () => {
  beforeEach(resetDb);

  it('ricategorizza solo i movimenti generici e ricorda la scelta per esercente', async () => {
    const a = await repo.createAccount({ name: 'C', institution: '', type: 'checking', currency: 'EUR', initialBalance: 0, createdAt: '2026-01-01' });
    const t1 = await repo.createTransaction({ accountId: a, date: '2026-09-01', description: 'Conad Abbasanta It Carta', amount: 1000, type: 'expense', categoryId: null });
    const t2 = await repo.createTransaction({ accountId: a, date: '2026-09-02', description: 'Esselunga', amount: 1000, type: 'expense', categoryId: 'exp-home' });
    const t3 = await repo.createTransaction({ accountId: a, date: '2026-09-03', description: 'Moo Milano It Carta N 703', amount: 500, type: 'expense', categoryId: null });
    const t4 = await repo.createTransaction({ accountId: a, date: '2026-09-04', description: 'MOO MILANO Carta 703 Data Operazione', amount: 700, type: 'expense', categoryId: null });
    expect(await recategorizeUncategorized()).toBe(1);
    expect((await db.transactions.get(t1))?.categoryId).toBe('exp-groceries');
    expect((await db.transactions.get(t2))?.categoryId).toBe('exp-home'); // scelta dell'utente intatta
    expect(await applyCategoryToMerchant('Moo Milano It Carta N 703', 'expense', 'exp-shopping')).toBe(2);
    expect((await db.transactions.get(t3))?.categoryId).toBe('exp-shopping');
    expect((await db.transactions.get(t4))?.categoryId).toBe('exp-shopping');
    expect(await db.category_rules.count()).toBe(1);
  });

  it('trova un conto importato da PDF e lo stesso conto collegato alla banca, e li unisce senza doppioni', async () => {
    const pdf = await repo.createAccount({ name: 'Fineco', institution: '', type: 'checking', currency: 'EUR', initialBalance: 50000, createdAt: '2026-06-01' });
    const bank = await repo.createAccount({ name: 'VIERTI GABRIELE', institution: 'FinecoBank', type: 'checking', currency: 'EUR', initialBalance: 0, createdAt: '2026-08-27' });
    await db.bank_links.add({ id: 'L', connectionId: 'S', iban: 'IT05', name: 'VIERTI GABRIELE', currency: 'EUR', accountId: bank, syncFrom: '2026-08-28', lastSyncAt: null, lastBookingDate: null, bankBalance: null, bankBalanceType: null, bankBalanceDate: null });
    // PDF: giugno-settembre; banca: da fine agosto (sovrapposizione settembre)
    await repo.createTransaction({ accountId: pdf, date: '2026-06-10', description: 'Stipendio giugno', amount: 200000, type: 'income', categoryId: null });
    const shared = [
      ['2026-09-03', 'Ristorante Hazama Milano It Carta N. ***** 703', 19800],
      ['2026-09-10', 'Conad Abbasanta It Carta N. ***** 703', 1438],
      ['2026-09-15', 'Iliad Addebito Sdd Fattura', 3499],
      ['2026-09-20', 'Pam Panorama Milano It Carta', 358],
    ] as const;
    for (const [d, desc, amt] of shared) {
      await repo.createTransaction({ accountId: pdf, date: d, description: desc, amount: amt, type: 'expense', categoryId: null });
      await repo.createTransaction({ accountId: bank, date: d, description: `Pagamento Visa Debit ${desc.split(' It ')[0].toUpperCase()}`, amount: amt, type: 'expense', categoryId: null });
    }
    await repo.createTransaction({ accountId: bank, date: '2026-11-01', description: 'Netflix', amount: 1299, type: 'expense', categoryId: null });
    await repo.alignBalanceAt(bank, 107495, '2026-11-30'); // saldo reale secondo la banca: 1.074,95

    const accounts = await db.accounts.toArray();
    const txs = await db.transactions.toArray();
    const dup = findDuplicateAccounts(accounts, txs);
    expect(dup).toHaveLength(1);
    expect(dup[0].matches).toHaveLength(4);
    expect(dataCoverageStart(accounts, txs)).toBe('2026-08-27');

    const r = await mergeAccounts(pdf, bank);
    expect(r).toEqual({ moved: 1, duplicates: 4 });
    expect(await db.accounts.count()).toBe(1);
    const merged = (await db.accounts.get(bank))!;
    // il saldo attuale resta quello della banca, la storia si allunga a giugno
    expect(accountBalance(merged, await db.transactions.toArray())).toBe(107495);
    expect(merged.createdAt).toBe('2026-06-01');
    expect(await db.transactions.count()).toBe(6);
  });

  it('copertura dei dati: la data più recente tra gli inizi dei conti', () => {
    expect(dataCoverageStart([account({ id: 'a', createdAt: '2026-06-01' }), account({ id: 'b', createdAt: '2026-08-27' })], [tx({ accountId: 'b', date: '2026-08-01' })])).toBe('2026-08-01');
  });
});
