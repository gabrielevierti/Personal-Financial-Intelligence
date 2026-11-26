// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { AiClient, parseJsonLoose, stripThinking } from '../../services/ai/client';
import { buildInsights, findRecurring } from '../../services/ai/insights';
import { buildContext, categorizeWithAi, uncategorizedMerchants } from '../../services/ai/assistant';
import { DEFAULT_CATEGORIES } from '../../database/seed';
import { account, tx } from '../fixtures';
import { resetDb } from '../dbReset';
// @ts-expect-error modulo JS senza tipi
import { createMockOllama } from '../../../e2e/mock-ollama.mjs';

const cats = DEFAULT_CATEGORIES.map((c) => ({ ...c, isDefault: true }));
let server: Server;
let client: AiClient;

beforeAll(async () => {
  server = createMockOllama().server;
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
  client = new AiClient({ provider: 'ollama', baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, model: 'qwen2.5:3b' });
});
afterAll(() => server.close());
beforeEach(resetDb);

function dataset(today: string) {
  const months = ['2026-08', '2026-09', '2026-10', '2026-11'];
  const txs = months.flatMap((m, i) => [
    tx({ id: `s${i}`, date: `${m}-01`, amount: 245000, type: 'income', categoryId: 'inc-salary', description: 'Accredito emolumenti NoiPA' }),
    tx({ id: `n${i}`, date: `${m}-12`, amount: -1299, categoryId: 'exp-subscriptions', description: 'Netflix.com' }),
    tx({ id: `a${i}`, date: `${m}-05`, amount: -85000, categoryId: 'exp-home', description: 'Affitto' }),
    ...[3, 9, 16, 22].map((d) => tx({ id: `g${i}${d}`, date: `${m}-${String(d).padStart(2, '0')}`, amount: -6000, categoryId: 'exp-groceries', description: 'Esselunga' })),
  ]).filter((t) => t.date <= today);
  return {
    accounts: [account({ initialBalance: 100000 })],
    transactions: txs,
    categories: cats,
    budgets: [],
    assets: [],
    valuations: [],
    settings: { baseCurrency: 'EUR', exchangeRates: {} },
  };
}

describe('analisi deterministiche', () => {
  it('riconosce i ricorrenti e non le spese frequenti', () => {
    const ds = dataset('2026-11-10');
    const r = findRecurring(ds.transactions, '2026-11-10');
    const names = r.map((x) => x.merchant).sort();
    expect(names).toEqual(['affitto', 'emolumenti noipa', 'netflix com']);
    const netflix = r.find((x) => x.merchant === 'netflix com')!;
    expect(netflix).toMatchObject({ amount: 1299, chargedThisMonth: false, nextExpected: '2026-11-12' });
  });
  it('previsione del mese: ricorrenti attesi + variabili stimate', () => {
    const ins = buildInsights(dataset('2026-11-10') as never, '2026-11-10');
    const f = ins.forecast;
    expect(f.incomeSoFar).toBe(245000);
    expect(f.expenseSoFar).toBe(85000 + 2 * 6000);
    expect(f.expectedRecurringExpense).toBe(1299);
    // spesa variabile: 4 spese da 60 € al mese ≈ 7,89 €/giorno × 20 giorni
    expect(f.expectedVariableExpense).toBeGreaterThan(14000);
    expect(f.expectedVariableExpense).toBeLessThan(17000);
    expect(ins.subscriptionsMonthly).toBe(1299);
    expect(ins.avgMonthlyIncome).toBe(245000);
  });
  it('il contesto per il modello contiene i numeri già calcolati', () => {
    const ds = dataset('2026-11-10') as never;
    const ctx = buildContext(ds, buildInsights(ds, '2026-11-10'));
    expect(ctx).toContain('PREVISIONE NOVEMBRE 2026');
    expect(ctx).toContain('netflix com');
    expect(ctx.replace(/\s/g, ' ')).toContain('2.450,00 €');
  });
});

describe('client modello locale', () => {
  it('elenca i modelli e risponde in streaming, senza il ragionamento interno', async () => {
    expect(await client.listModels()).toEqual(['qwen2.5:3b']);
    const tokens: string[] = [];
    const out = await client.chat([{ role: 'system', content: 'CONTI ... PREVISIONE' }, { role: 'user', content: 'ciao' }], { onToken: (t) => tokens.push(t) });
    expect(out).toContain('Ho ricevuto il contesto finanziario.');
    expect(out).not.toContain('ragionamento');
    expect(tokens.length).toBeGreaterThan(3);
  });
  it('errore chiaro se il modello non è installato o il server è spento', async () => {
    const other = new AiClient({ ...client.settings, model: 'llama9' });
    await expect(other.chat([{ role: 'user', content: 'x' }])).rejects.toThrow(/ollama pull llama9/);
    const off = new AiClient({ ...client.settings, baseUrl: 'http://127.0.0.1:9' });
    await expect(off.listModels()).rejects.toThrow(/non risponde/);
  });
  it('categorizzazione con schema JSON, ignorando categorie generiche', async () => {
    const items = uncategorizedMerchants([
      tx({ description: 'E1790596747235s0we Moo Milano It Carta N. 703', categoryId: 'exp-other' }),
      tx({ description: 'Embraer_190 Fiumicino It Carta N. 703', categoryId: 'exp-other' }),
      tx({ description: 'Codice misterioso', categoryId: 'exp-other' }),
      tx({ description: 'Esselunga', categoryId: 'exp-groceries' }),
    ]);
    expect(items).toHaveLength(3);
    const s = await categorizeWithAi(client, items, cats);
    expect(s.map((x) => [x.merchant, x.categoryId])).toEqual([
      ['moo milano', 'exp-shopping'],
      ['embraer fiumicino', 'exp-travel'],
    ]);
  });
  it('utility', () => {
    expect(stripThinking('<think>x</think>Ciao')).toBe('Ciao');
    expect(parseJsonLoose('Ecco: ```json {"a":1} ```')).toEqual({ a: 1 });
    expect(parseJsonLoose('niente')).toBeNull();
  });
});
