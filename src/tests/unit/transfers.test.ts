import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../database/db';
import { detectTransfers, ownerNames, autoLinkTransfers, setOwnerNames, ignorePair, findTransferCandidates } from '../../services/transfers';
import * as repo from '../../services/repository';
import { summarize, makeConverter, accountBalance } from '../../services/finance';
import { resetDb } from '../dbReset';
import { tx } from '../fixtures';

const accounts = [
  { id: 'fineco', currency: 'EUR' },
  { id: 'tr', currency: 'EUR' },
];
const links = [
  { accountId: 'fineco', iban: 'IT05N0301503200000006385656', name: 'VIERTI GABRIELE' },
  { accountId: 'tr', iban: 'IT85V0367401600006916226311', name: 'Gabriele Vierti' },
];

describe('riconoscimento trasferimenti (puro)', () => {
  it('ricava il nome dell’intestatario dai nomi dei conti', () => {
    expect(ownerNames([], links)).toEqual([
      ['vierti', 'gabriele'],
      ['gabriele', 'vierti'],
    ]);
    expect(ownerNames([], [{ name: 'Conto corrente' }, { name: 'Carta Visa 123' }])).toEqual([]);
  });

  it('certo con il nome dell’intestatario, anche a 2 giorni di distanza', () => {
    const out = tx({ id: 'o', accountId: 'fineco', date: '2026-11-10', amount: -50000, description: 'Bonifico SEPA a Gabriele Vierti · Ricarica TR' });
    const inn = tx({ id: 'i', accountId: 'tr', date: '2026-11-12', amount: 50000, type: 'income', description: 'VIERTI GABRIELE · Bonifico in entrata' });
    const r = detectTransfers([out, inn], accounts, links);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ outId: 'o', inId: 'i', certain: true });
  });

  it('certo con l’IBAN del conto di destinazione', () => {
    const out = tx({ id: 'o', accountId: 'fineco', date: '2026-11-10', amount: -10000, description: 'Bonifico', counterpartIban: 'IT85V0367401600006916226311' });
    const inn = tx({ id: 'i', accountId: 'tr', date: '2026-11-10', amount: 10000, type: 'income', description: 'Incoming transfer' });
    expect(detectTransfers([out, inn], accounts, links)[0]).toMatchObject({ certain: true, reasons: ['IBAN del tuo altro conto'] });
  });

  it('solo possibile senza prove; ignora importi diversi, stesso conto, date lontane e coppie scartate', () => {
    const out = tx({ id: 'o', accountId: 'fineco', date: '2026-11-10', amount: -2000, description: 'Pagamento' });
    const inn = tx({ id: 'i', accountId: 'tr', date: '2026-11-11', amount: 2000, type: 'income', description: 'Rimborso' });
    expect(detectTransfers([out, inn], accounts, links)[0].certain).toBe(false);
    // importo oltre la tolleranza fuzzy (5%): non deve essere riconosciuto
    expect(detectTransfers([out, { ...inn, amount: 3000 }], accounts, links)).toHaveLength(0);
    expect(detectTransfers([out, { ...inn, accountId: 'fineco' }], accounts, links)).toHaveLength(0);
    expect(detectTransfers([out, { ...inn, date: '2026-11-20' }], accounts, links)).toHaveLength(0);
    expect(detectTransfers([out, inn], accounts, links, [], new Set(['o|i']))).toHaveLength(0);
    expect(detectTransfers([out, { ...inn, pending: true }], accounts, links)).toHaveLength(0);
  });

  it('ogni movimento finisce in una sola coppia, la più probabile', () => {
    const out = tx({ id: 'o', accountId: 'fineco', date: '2026-11-10', amount: -5000, description: 'Giroconto a Gabriele Vierti' });
    const a = tx({ id: 'a', accountId: 'tr', date: '2026-11-14', amount: 5000, type: 'income', description: 'Altro' });
    const b = tx({ id: 'b', accountId: 'tr', date: '2026-11-10', amount: 5000, type: 'income', description: 'Gabriele Vierti' });
    const r = detectTransfers([out, a, b], accounts, links);
    expect(r).toHaveLength(1);
    expect(r[0].inId).toBe('b');
  });
});

describe('collegamento automatico (database)', () => {
  beforeEach(resetDb);
  it('collega le coppie certe: niente più entrate/uscite, saldi invariati', async () => {
    const f = await repo.createAccount({ name: 'Fineco', institution: '', type: 'checking', currency: 'EUR', initialBalance: 100000, createdAt: '2026-01-01' });
    const t = await repo.createAccount({ name: 'Trade Republic', institution: '', type: 'checking', currency: 'EUR', initialBalance: 0, createdAt: '2026-01-01' });
    await setOwnerNames(['Gabriele Vierti']);
    await repo.createTransaction({ accountId: f, date: '2026-11-10', description: 'Bonifico a Gabriele Vierti', amount: 30000, type: 'expense', categoryId: null });
    await repo.createTransaction({ accountId: t, date: '2026-11-11', description: 'Vierti Gabriele', amount: 30000, type: 'income', categoryId: null });
    // coppia solo possibile: non viene collegata in automatico
    await repo.createTransaction({ accountId: f, date: '2026-11-12', description: 'Amazon', amount: 1999, type: 'expense', categoryId: null });
    await repo.createTransaction({ accountId: t, date: '2026-11-12', description: 'Rimborso', amount: 1999, type: 'income', categoryId: null });

    expect(await autoLinkTransfers()).toBe(1);
    const all = await db.transactions.toArray();
    expect(all.filter((x) => x.type === 'transfer')).toHaveLength(2);
    const s = summarize(all, { start: '2026-11-01', end: '2026-11-30', label: '' }, makeConverter({ baseCurrency: 'EUR', exchangeRates: {} }));
    expect(s).toMatchObject({ income: 1999, expense: 1999 });
    expect(accountBalance((await db.accounts.get(f))!, all)).toBe(100000 - 30000 - 1999);
    const remaining = await findTransferCandidates();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].certain).toBe(false);
    await ignorePair(remaining[0].outId, remaining[0].inId);
    expect(await findTransferCandidates()).toHaveLength(0);
  });
});
