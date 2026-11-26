// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { db } from '../../database/db';
import { resetDb } from '../dbReset';
import { BridgeClient, parseCallback } from '../../services/bank/client';
import { compareBalance, mapTransactions, parseBalances, pickBalance } from '../../services/bank/mapping';
import { alignAccountBalance, applyLinkChoices, chooseReferenceBalance, needsAutoSync, revokeConnection, saveSession, suggestedSyncFrom, syncAll } from '../../services/bank/sync';
import * as repo from '../../services/repository';
import { accountBalance } from '../../services/finance';
// @ts-expect-error modulo JS senza tipi
import { createBridge, isAllowedOrigin } from '../../../bridge/pfi-bridge.mjs';
// @ts-expect-error modulo JS senza tipi
import { createMockEnableBanking } from '../../../e2e/mock-enablebanking.mjs';

const listen = (s: Server) => new Promise<number>((ok) => s.listen(0, '127.0.0.1', () => ok((s.address() as AddressInfo).port)));

let mock: ReturnType<typeof createMockEnableBanking>;
let bridge: Server;
let client: BridgeClient;
let bridgeUrl = '';

beforeAll(async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  mock = createMockEnableBanking({ publicKey, appId: 'app-test' });
  const ebPort = await listen(mock.server);
  bridge = createBridge(
    {
      applicationId: 'app-test',
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      privateKeyPath: '',
      redirectUrl: 'https://localhost/pfi-callback',
      apiBase: `http://127.0.0.1:${ebPort}`,
      port: 0,
      allowedOrigins: [],
    },
    { log: () => {} },
  );
  bridgeUrl = `http://127.0.0.1:${await listen(bridge)}`;
  client = new BridgeClient(bridgeUrl);
});

afterAll(() => {
  bridge.close();
  mock.server.close();
});

beforeEach(resetDb);

describe('bridge', () => {
  it('verifica le credenziali firmando un JWT valido', async () => {
    const h = await client.health(true);
    expect(h.ok).toBe(true);
    expect(h.application?.name).toBe('PFI test');
  });
  it('blocca pagamenti e origini esterne', async () => {
    const pay = await fetch(`${bridgeUrl}/eb/payments`, { method: 'POST', body: '{}' });
    expect(pay.status).toBe(403);
    const evil = await fetch(`${bridgeUrl}/eb/aspsps?country=IT`, { headers: { Origin: 'https://evil.example' } });
    expect(evil.status).toBe(403);
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true);
    expect(mock.state.requests.some((r: string) => r.includes('payments'))).toBe(false);
  });
  it('forza il redirect configurato', async () => {
    await client.startAuth({ aspsp: { name: 'Fineco', country: 'IT' }, validUntil: '2027-01-01T00:00:00Z', state: 's1' });
    expect(mock.state.lastAuth.redirect_url).toBe('https://localhost/pfi-callback');
  });
});

describe('mapping', () => {
  it('segno, date, descrizione e movimenti in attesa', () => {
    const { mapped, pending } = mapTransactions('L', mock.state.transactions);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ amount: -2000, externalId: 'eb:L:p:P1' });
    expect(mapped).toHaveLength(5);
    expect(mapped.find((m) => m.externalId === 'eb:L:T1')).toMatchObject({ amount: 245000, description: 'ACME SRL · Stipendio' });
    expect(mapped.find((m) => m.externalId === 'eb:L:T2')?.amount).toBe(-85000);
    const bars = mapped.filter((m) => m.description === 'BAR CENTRALE');
    expect(new Set(bars.map((b) => b.externalId)).size).toBe(2); // due caffè distinti nello stesso giorno
  });
  it('preferisce il saldo contabile', () => {
    const list = parseBalances([
      { balance_amount: { currency: 'EUR', amount: '1' }, balance_type: 'ITAV' },
      { balance_amount: { currency: 'EUR', amount: '2.5' }, balance_type: 'CLBD' },
      { name: 'x', balance_amount: { currency: 'EUR', amount: '1500.10' }, balance_type: 'OTHR' },
      { name: 'x', balance_amount: { currency: 'EUR', amount: '9' }, balance_type: 'OTHR' },
    ]);
    expect(list.map((b) => b.key)).toEqual(['ITAV|', 'CLBD|', 'OTHR|x', 'OTHR|x#2']);
    expect(pickBalance(list)).toMatchObject({ amount: 250, type: 'CLBD' });
    expect(pickBalance(list, 'OTHR|x')).toMatchObject({ amount: 150010 });
    expect(pickBalance(parseBalances([{ balance_amount: { currency: 'EUR', amount: '3' }, balance_type: 'OTHR' }]))?.amount).toBe(300);
  });
  it('confronta il saldo contabile senza i movimenti in attesa e quello disponibile con', () => {
    const txs = [{ amount: 1000 }, { amount: -300, pending: true }];
    expect(compareBalance({ bankBalance: 1000, bankBalanceType: 'CLBD' }, 0, txs)).toMatchObject({ ours: 1000, difference: 0, oursWithPending: 700 });
    expect(compareBalance({ bankBalance: 700, bankBalanceType: 'ITAV' }, 0, txs)).toMatchObject({ ours: 700, difference: 0, includesPending: true });
  });
  it('legge code e state dall’indirizzo di ritorno', () => {
    expect(parseCallback('https://localhost/pfi-callback?state=abc&code=XYZ-1')).toEqual({ code: 'XYZ-1', state: 'abc', error: null });
    expect(parseCallback('XYZ-123456')).toMatchObject({ code: 'XYZ-123456' });
    expect(parseCallback('https://x/cb?error=access_denied&error_description=Annullato')).toMatchObject({ error: 'Annullato' });
    expect(parseCallback('ciao')).toBeNull();
  });
});

describe('sincronizzazione', () => {
  async function connect() {
    const session = await client.createSession('CODE-123');
    return saveSession(session);
  }

  it('conto nuovo: importa i movimenti contabilizzati e allinea il saldo alla banca', async () => {
    const [link] = await connect();
    await applyLinkChoices([{ linkId: link.id, target: 'new', syncFrom: mock.day(-30) }]);
    const [r] = await syncAll(client);
    expect(r.error).toBeUndefined();
    expect(r.added).toBe(5);
    expect(r.pending).toBe(1);
    const acc = (await db.accounts.toArray())[0];
    expect(acc.name).toBe('Conto Fineco');
    const all = await db.transactions.toArray();
    // saldo contabile della banca = movimenti contabilizzati; con quelli in attesa = saldo disponibile
    expect(accountBalance(acc, all.filter((t) => !t.pending))).toBe(300665);
    expect(accountBalance(acc, all)).toBe(298665);
    expect(r.difference).toBe(0);
    const stored = (await db.bank_links.toArray())[0];
    expect(stored.bankBalances).toHaveLength(3);
    expect(stored.pendingAmount).toBe(-2000);
  });

  it('le sincronizzazioni successive non duplicano e aggiungono solo i nuovi movimenti', async () => {
    const [link] = await connect();
    await applyLinkChoices([{ linkId: link.id, target: 'new', syncFrom: mock.day(-30) }]);
    await syncAll(client);
    const again = await syncAll(client);
    expect(again[0].added).toBe(0);
    expect(await db.transactions.filter((t) => !!t.pending).count()).toBe(1); // sostituito, non duplicato
    // il movimento in attesa viene contabilizzato: sparisce dagli "in attesa" e arriva come definitivo
    const p1 = mock.state.transactions.find((t: { transaction_id: string }) => t.transaction_id === 'P1');
    Object.assign(p1, { status: 'BOOK', booking_date: mock.day(-1), transaction_id: 'T-P1' });
    mock.state.balance = '2986.65';
    const booked = await syncAll(client);
    expect(booked[0]).toMatchObject({ added: 1, pending: 0, difference: 0 });
    expect(await db.transactions.filter((t) => !!t.pending).count()).toBe(0);
    Object.assign(p1, { status: 'PDNG', booking_date: null, transaction_id: 'P1' });
    mock.state.balance = '3006.65';
    await db.transactions.filter((t) => t.externalId?.endsWith('T-P1') ?? false).delete();
    await syncAll(client);
    mock.addTransaction({ transaction_id: 'T9', transaction_amount: { currency: 'EUR', amount: '12.99' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: mock.day(-1), remittance_information: ['NETFLIX'] });
    mock.state.balance = '2993.66';
    const third = await syncAll(client);
    expect(third[0].added).toBe(1);
    expect(third[0].difference).toBe(0);
    expect(await db.transactions.filter((t) => !t.pending).count()).toBe(6);
    mock.state.transactions.pop();
    mock.state.balance = '3006.65';
  });

  it('conto esistente: parte dal giorno dopo l’ultimo movimento e segnala la differenza di saldo', async () => {
    const a = await repo.createAccount({ name: 'Fineco', institution: 'Fineco', type: 'checking', currency: 'EUR', initialBalance: 100000, createdAt: '2020-01-01' });
    await repo.createTransaction({ accountId: a, date: mock.day(-16), description: 'Da estratto PDF', amount: 1000, type: 'expense', categoryId: null });
    expect(await suggestedSyncFrom(a)).toBe(mock.day(-15));
    const [link] = await connect();
    await applyLinkChoices([{ linkId: link.id, target: a, syncFrom: await suggestedSyncFrom(a) }]);
    const [r] = await syncAll(client);
    expect(r.added).toBe(4); // lo stipendio del giorno -20 è prima della data di partenza
    const acc = (await db.accounts.get(a))!;
    const booked = (await db.transactions.toArray()).filter((t) => !t.pending);
    const ours = accountBalance(acc, booked);
    expect(r.difference).toBe(300665 - ours);
    await alignAccountBalance(a);
    const after = (await db.transactions.toArray()).filter((t) => !t.pending);
    expect(accountBalance((await db.accounts.get(a))!, after)).toBe(300665);
    // scelta di un altro saldo di riferimento (disponibile): confronto con i movimenti in attesa
    const link2 = (await db.bank_links.toArray())[0];
    await chooseReferenceBalance(link2.id, 'ITAV|Saldo disponibile');
    const l2 = (await db.bank_links.get(link2.id))!;
    expect(l2).toMatchObject({ bankBalance: 298665, bankBalanceType: 'ITAV' });
    expect(compareBalance(l2, (await db.accounts.get(a))!.initialBalance, await db.transactions.where('accountId').equals(a).toArray())?.difference).toBe(0);
  });

  it('dopo un aggiornamento della logica rilegge tutto e corregge i movimenti salvati male', async () => {
    const [link] = await connect();
    await applyLinkChoices([{ linkId: link.id, target: 'new', syncFrom: mock.day(-30) }]);
    await syncAll(client);
    // simula dati salvati da una versione precedente: importo letto male e un doppione con ID calcolato errato
    const t2 = (await db.transactions.toArray()).find((t) => t.externalId === 'eb:acc-uid-1:T2')!;
    await db.transactions.update(t2.id, { amount: -850 });
    const bar = (await db.transactions.toArray()).find((t) => t.description === 'BAR CENTRALE')!;
    await db.transactions.add({ ...bar, id: 'stale-1', amount: -35, externalId: 'eb:acc-uid-1:hdeadbeef' });
    await db.bank_links.update(link.id, { syncVersion: 1 });
    const [r] = await syncAll(client);
    expect(r).toMatchObject({ added: 0, corrected: 1, removed: 1, difference: 0 });
    expect((await db.transactions.get(t2.id))?.amount).toBe(-85000);
    expect(await db.transactions.get('stale-1')).toBeUndefined();
    expect((await db.bank_links.get(link.id))?.syncVersion).toBe(2);
  });

  it('consenso scaduto: segnato come scaduto senza perdere i dati', async () => {
    const [link] = await connect();
    await applyLinkChoices([{ linkId: link.id, target: 'new', syncFrom: mock.day(-30) }]);
    await syncAll(client);
    mock.state.sessionStatus = 'EXPIRED';
    const [r] = await syncAll(client);
    expect(r.error).toMatch(/scaduto/);
    expect((await db.bank_connections.get('sess-1'))?.status).toBe('expired');
    expect(await db.transactions.filter((t) => !t.pending).count()).toBe(5);
    expect(await needsAutoSync()).toBe(false);
    mock.state.sessionStatus = 'AUTHORIZED';
  });

  it('revoca del consenso', async () => {
    await connect();
    await revokeConnection(client, 'sess-1');
    expect(await db.bank_connections.count()).toBe(0);
    expect(mock.state.sessionStatus).toBe('REVOKED');
  });
});
