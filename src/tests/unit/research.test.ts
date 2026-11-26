import { describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import { cagr, comparablesValue, dcf, ddm, drawdownSeries, ebitdaOf, enterpriseValue, findAnomalies, freeCashFlow, multiples, netDebtOf, pricePerformance, validateDcf, yearMetrics } from '../../services/research/metrics';
import { parseCompanyFacts, type CompanyFacts } from '../../services/research/sec';
import { parseAvStatements, parseTiingo } from '../../services/research/providers';
import { baseAssumptions, buildScenarios, fairValueRange } from '../../services/research/scenarios';
import type { FinancialYear } from '../../services/research/types';
// @ts-expect-error modulo JS senza tipi
import { createBridge } from '../../../bridge/pfi-bridge.mjs';
// @ts-expect-error modulo JS senza tipi
import { rateLimiter } from '../../../bridge/research.mjs';

const prov = { source: 'test', fetchedAt: '2026-11-26T00:00:00Z', status: 'ufficiale' as const };
function fy(p: Partial<FinancialYear>): FinancialYear {
  return {
    fiscalYear: 2025, periodEnd: '2025-12-31', currency: 'USD', revenue: 1000, costOfRevenue: 600, grossProfit: 400, operatingIncome: 200, netIncome: 150, ebitda: null, depreciation: 50, interestExpense: 20, incomeTax: 40, pretaxIncome: 190, epsDiluted: 1.5, sharesDiluted: 100,
    totalAssets: 2000, totalLiabilities: 1200, equity: 800, cash: 100, shortTermInvestments: 50, currentAssets: 600, currentLiabilities: 400, inventory: 100, receivables: 150, shortTermDebt: 100, longTermDebt: 500,
    operatingCashFlow: 250, capex: 80, dividendsPaid: 30, buybacks: 0, prov, derived: [], ...p,
  };
}

describe('metriche di bilancio', () => {
  const y = fy({});
  it('EBITDA, FCF, debito netto (lordo ≠ netto)', () => {
    expect(ebitdaOf(y)).toBe(250);
    expect(freeCashFlow(y)).toBe(170);
    expect(netDebtOf(y)).toBe(600 - 100 - 50);
    expect(ebitdaOf(fy({ ebitda: 999 }))).toBe(999);
    expect(netDebtOf(fy({ cash: null }))).toBeNull();
  });
  it('indicatori di debito, liquidità, redditività', () => {
    const [m] = yearMetrics([y, fy({ fiscalYear: 2024, periodEnd: '2024-12-31', revenue: 800, equity: 700, netIncome: 100 })]);
    expect(m.netDebtToEbitda).toBeCloseTo(450 / 250);
    expect(m.debtToEquity).toBeCloseTo(600 / 800);
    expect(m.interestCoverage).toBeCloseTo(10);
    expect(m.currentRatio).toBeCloseTo(1.5);
    expect(m.quickRatio).toBeCloseTo(500 / 400);
    expect(m.operatingMargin).toBeCloseTo(0.2);
    expect(m.roe).toBeCloseTo(150 / 750);
    expect(m.roa).toBeCloseTo(0.075);
    const tax = 40 / 190;
    expect(m.roic).toBeCloseTo((200 * (1 - tax)) / (600 + 800 - 100));
    expect(m.revenueGrowth).toBeCloseTo(0.25);
    expect(m.dividendsPerShare).toBeCloseTo(0.3);
  });
  it('dati mancanti → null, mai stimati', () => {
    const [m] = yearMetrics([fy({ interestExpense: null, currentLiabilities: null, operatingCashFlow: null })]);
    expect(m.interestCoverage).toBeNull();
    expect(m.currentRatio).toBeNull();
    expect(m.fcf).toBeNull();
  });
  it('anomalie e CAGR', () => {
    const ms = yearMetrics([fy({ revenue: 2000, netIncome: -10, operatingIncome: 20 }), fy({ fiscalYear: 2024 })]);
    const a = findAnomalies(ms).map((x) => x.field);
    expect(a).toContain('revenue');
    expect(a).toContain('netIncome');
    expect(cagr(100, 121, 2)).toBeCloseTo(0.1);
    expect(cagr(-1, 121, 2)).toBeNull();
  });
});

describe('valutazione', () => {
  it('multipli ed EV', () => {
    const y = fy({});
    expect(enterpriseValue(3000, y)).toBe(3450);
    const m = multiples({ price: 30, shares: 100, marketCap: null }, y);
    expect(m.marketCap).toBe(3000);
    expect(m.pe).toBeCloseTo(20);
    expect(m.evEbitda).toBeCloseTo(3450 / 250);
    expect(m.fcfYield).toBeCloseTo(170 / 3000);
  });
  it('DCF: valori attualizzati e valore terminale', () => {
    const r = dcf({ baseRevenue: 1000, revenueGrowth: 0.1, operatingMargin: 0.2, taxRate: 0.25, reinvestmentRate: 0.4, wacc: 0.1, terminalGrowth: 0.02, years: 2, netDebt: 100, shares: 10 })!;
    // anno 1: ricavi 1100, NOPAT 165, FCFF 99; anno 2: ricavi 1210, NOPAT 181.5, FCFF 108.9
    expect(r.rows[0].fcff).toBeCloseTo(99);
    expect(r.rows[1].fcff).toBeCloseTo(108.9);
    const pv = 99 / 1.1 + 108.9 / 1.21;
    const tv = (108.9 * 1.02) / 0.08;
    expect(r.terminalValue).toBeCloseTo(tv);
    expect(r.enterpriseValue).toBeCloseTo(pv + tv / 1.21);
    expect(r.perShare).toBeCloseTo((pv + tv / 1.21 - 100) / 10);
  });
  it('DCF rifiuta ipotesi incoerenti', () => {
    const bad = { baseRevenue: 1000, revenueGrowth: 0.1, operatingMargin: 0.2, taxRate: 0.25, reinvestmentRate: 0.4, wacc: 0.03, terminalGrowth: 0.04, years: 5, netDebt: 0, shares: 10 };
    expect(validateDcf(bad).length).toBeGreaterThan(0);
    expect(dcf(bad)).toBeNull();
  });
  it('DDM e comparabili', () => {
    expect(ddm(2, 0.08, 0.03)).toBeCloseTo(2.06 / 0.05);
    expect(ddm(0, 0.08, 0.03)).toBeNull();
    expect(ddm(2, 0.03, 0.05)).toBeNull();
    const c = comparablesValue([10, 20, 30, -5], 2, [8, 12], 250, 450, 100);
    expect(c.medianPe).toBe(20);
    expect(c.byPe).toBe(40);
    expect(c.byEvEbitda).toBeCloseTo((10 * 250 - 450) / 100);
  });
  it('scenari deterministici con regole esplicite', () => {
    const years = [fy({}), fy({ fiscalYear: 2024, periodEnd: '2024-12-31', revenue: 900 }), fy({ fiscalYear: 2023, periodEnd: '2023-12-31', revenue: 810 })];
    const base = baseAssumptions(years, yearMetrics(years), 100)!;
    expect(base.inputs.revenueGrowth).toBeCloseTo(cagr(810, 1000, 2)!);
    const sc = buildScenarios(base.inputs, 20);
    expect(sc.map((s) => s.id)).toEqual(['prudente', 'moderato', 'ottimista']);
    expect(sc[0].fairValue!).toBeLessThan(sc[1].fairValue!);
    expect(sc[1].fairValue!).toBeLessThan(sc[2].fairValue!);
    expect(sc[1].upside).toBeCloseTo(sc[1].fairValue! / 20 - 1);
    const r = fairValueRange(sc)!;
    expect(r.low).toBe(sc[0].fairValue);
  });
});

describe('prezzi', () => {
  const pts = Array.from({ length: 400 }, (_, i) => {
    const d = new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
    return { date: d, close: i < 200 ? 100 + i : 300 - (i - 200) / 2, volume: 1000 };
  });
  it('rendimenti, massimi/minimi 52 settimane e drawdown', () => {
    const p = pricePerformance(pts);
    expect(p.last?.close).toBe(200.5);
    expect(p.high52).toBe(300);
    expect(p.returns['5Y']).toBeNull();
    expect(p.returns['1M']).toBeCloseTo(200.5 / 215.5 - 1);
    expect(p.maxDrawdown).toBeCloseTo(200.5 / 300 - 1);
    expect(drawdownSeries([{ date: 'a', close: 10 }, { date: 'b', close: 5 }])[1].drawdown).toBe(-0.5);
  });
});

describe('adattatori', () => {
  it('SEC companyfacts: esercizi annuali dai 10-K, ultimo deposito vince, niente trimestri', () => {
    const f: CompanyFacts = {
      cik: 320193,
      entityName: 'Test Inc',
      facts: {
        'us-gaap': {
          Revenues: { units: { USD: [
            { start: '2024-01-01', end: '2024-12-31', val: 1000, form: '10-K', filed: '2025-02-01' },
            { start: '2024-01-01', end: '2024-12-31', val: 1010, form: '10-K/A', filed: '2025-06-01' },
            { start: '2024-10-01', end: '2024-12-31', val: 300, form: '10-K', filed: '2025-02-01' },
            { start: '2023-01-01', end: '2023-12-31', val: 900, form: '10-K', filed: '2024-02-01' },
            { start: '2025-01-01', end: '2025-03-31', val: 250, form: '10-Q', filed: '2025-05-01' },
          ] } },
          OperatingIncomeLoss: { units: { USD: [{ start: '2024-01-01', end: '2024-12-31', val: 200, form: '10-K', filed: '2025-02-01' }] } },
          DepreciationDepletionAndAmortization: { units: { USD: [{ start: '2024-01-01', end: '2024-12-31', val: 40, form: '10-K', filed: '2025-02-01' }] } },
          Assets: { units: { USD: [{ end: '2024-12-31', val: 5000, form: '10-K', filed: '2025-02-01' }] } },
          StockholdersEquity: { units: { USD: [{ end: '2024-12-31', val: 2000, form: '10-K', filed: '2025-02-01' }] } },
        },
      },
    };
    const ys = parseCompanyFacts(f, '2026-11-26T00:00:00Z');
    expect(ys.map((y) => y.fiscalYear)).toEqual([2024, 2023]);
    expect(ys[0].revenue).toBe(1010);
    expect(ys[0].ebitda).toBe(240);
    expect(ys[0].totalLiabilities).toBe(3000);
    expect(ys[0].derived).toEqual(['totalLiabilities', 'ebitda']);
    expect(ys[0].netIncome).toBeNull();
    expect(ys[0].prov.status).toBe('ufficiale');
  });
  it('Alpha Vantage: unisce conto economico, stato patrimoniale e flussi', () => {
    const ys = parseAvStatements(
      { annualReports: [{ fiscalDateEnding: '2024-12-31', reportedCurrency: 'EUR', totalRevenue: '1000', operatingIncome: '100', netIncome: 'None' }] },
      { annualReports: [{ fiscalDateEnding: '2024-12-31', totalAssets: '3000' }] },
      { annualReports: [{ fiscalDateEnding: '2024-12-31', operatingCashflow: '150', capitalExpenditures: '-40' }] },
      'x',
    );
    expect(ys[0]).toMatchObject({ currency: 'EUR', revenue: 1000, netIncome: null, totalAssets: 3000, capex: 40 });
    expect(freeCashFlow(ys[0])).toBe(110);
  });
  it('Tiingo: usa i prezzi rettificati', () => {
    expect(parseTiingo([{ date: '2026-11-20T00:00:00.000Z', close: 200, adjClose: 100, adjHigh: 101, adjLow: 99, adjOpen: 100, adjVolume: 5 }])).toEqual([{ date: '2026-11-20', open: 100, high: 101, low: 99, close: 100, volume: 5 }]);
  });
});

describe('bridge: rotte di ricerca', () => {
  const listen = (s: Server) => new Promise<number>((ok) => s.listen(0, '127.0.0.1', () => ok((s.address() as AddressInfo).port)));
  it('chiavi solo nel bridge, User-Agent SEC, funzioni consentite, limiti', async () => {
    const seen: Array<{ url: string; ua?: string; token?: string }> = [];
    const upstream = createServer((req, res) => {
      seen.push({ url: req.url ?? '', ua: req.headers['user-agent'], token: req.headers['x-finnhub-token'] as string | undefined });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url?.startsWith('/query')) res.end(JSON.stringify(req.url.includes('OVERVIEW') ? { Symbol: 'IBM' } : { Note: 'limit' }));
      else res.end(JSON.stringify({ ok: true }));
    });
    const up = `http://127.0.0.1:${await listen(upstream)}`;
    const bridge = createBridge(
      { applicationId: '', privateKeyPath: '', privateKeyPem: '', redirectUrl: '', apiBase: up, port: 0, allowedOrigins: [], research: { secUserAgent: 'PFI test test@example.com', alphaVantageKey: 'AVKEY', finnhubKey: 'FHKEY', tiingoKey: '', secWww: up, secData: up, avBase: up, finnhubBase: up, tiingoBase: up } },
      { log: () => {} },
    );
    const b = `http://127.0.0.1:${await listen(bridge)}`;
    try {
      const st = await (await fetch(`${b}/research/status`)).json();
      expect(st.providers.sec.configured).toBe(true);
      expect(st.providers.tiingo.configured).toBe(false);
      expect(JSON.stringify(st)).not.toContain('AVKEY');

      expect((await fetch(`${b}/research/sec/facts/320193`)).status).toBe(200);
      expect(seen.at(-1)).toMatchObject({ url: '/api/xbrl/companyfacts/CIK0000320193.json', ua: 'PFI test test@example.com' });

      expect((await fetch(`${b}/research/av/OVERVIEW?symbol=IBM`)).status).toBe(200);
      expect(seen.at(-1)?.url).toContain('apikey=AVKEY');
      const lim = await fetch(`${b}/research/av/GLOBAL_QUOTE?symbol=IBM`);
      expect(lim.status).toBe(429);
      expect((await fetch(`${b}/research/av/LISTING_STATUS`)).status).toBe(400);

      await fetch(`${b}/research/finnhub/quote?symbol=AAPL`);
      expect(seen.at(-1)).toMatchObject({ token: 'FHKEY' });
      expect(seen.at(-1)?.url).not.toContain('FHKEY');
      expect((await fetch(`${b}/research/finnhub/stock/candle?symbol=AAPL`)).status).toBe(400);

      expect((await fetch(`${b}/research/tiingo/prices?symbol=AAPL&startDate=2020-01-01`)).status).toBe(503);
      expect((await fetch(`${b}/research/status`, { method: 'POST' })).status).toBe(405);
    } finally {
      bridge.close();
      upstream.close();
    }
  });
  it('limitatore a finestra scorrevole', () => {
    let t = 0;
    const l = rateLimiter(2, 1000, () => t);
    expect([l.take(), l.take(), l.take()]).toEqual([true, true, false]);
    t = 1000;
    expect(l.take()).toBe(true);
  });
});
