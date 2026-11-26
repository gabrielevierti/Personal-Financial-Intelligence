/**
 * Fonti di dati di mercato simulate per i test: SEC EDGAR, Finnhub e Tiingo con dati inventati e deterministici
 * (azienda fittizia "Testco", ticker TSTC). Non rappresentano nessuna azienda reale.
 */
import { createServer } from 'node:http';

const CIK = 1234567;
const fact = (end, val, start) => ({ ...(start ? { start } : {}), end, val, form: '10-K', filed: `${Number(end.slice(0, 4)) + 1}-02-01`, fy: Number(end.slice(0, 4)), fp: 'FY' });
const flow = (vals) => vals.map(([y, v]) => fact(`${y}-12-31`, v, `${y}-01-01`));
const inst = (vals) => vals.map(([y, v]) => fact(`${y}-12-31`, v));
const Y = [2021, 2022, 2023, 2024, 2025];
const series = (base, g) => Y.map((y, i) => [y, Math.round(base * Math.pow(1 + g, i))]);

export const COMPANY_FACTS = {
  cik: CIK,
  entityName: 'Testco Inc.',
  facts: {
    'us-gaap': {
      Revenues: { units: { USD: flow(series(10e9, 0.08)) } },
      CostOfRevenue: { units: { USD: flow(series(6e9, 0.07)) } },
      OperatingIncomeLoss: { units: { USD: flow(series(2e9, 0.1)) } },
      NetIncomeLoss: { units: { USD: flow(series(1.5e9, 0.1)) } },
      DepreciationDepletionAndAmortization: { units: { USD: flow(series(0.5e9, 0.05)) } },
      InterestExpense: { units: { USD: flow(series(0.1e9, 0)) } },
      IncomeTaxExpenseBenefit: { units: { USD: flow(series(0.4e9, 0.1)) } },
      IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: { units: { USD: flow(series(1.9e9, 0.1)) } },
      EarningsPerShareDiluted: { units: { 'USD/shares': flow(series(150, 0.1)).map((f) => ({ ...f, val: f.val / 100 })) } },
      WeightedAverageNumberOfDilutedSharesOutstanding: { units: { shares: flow(series(1e9, 0)) } },
      Assets: { units: { USD: inst(series(20e9, 0.05)) } },
      Liabilities: { units: { USD: inst(series(12e9, 0.03)) } },
      StockholdersEquity: { units: { USD: inst(series(8e9, 0.08)) } },
      CashAndCashEquivalentsAtCarryingValue: { units: { USD: inst(series(2e9, 0.05)) } },
      AssetsCurrent: { units: { USD: inst(series(6e9, 0.05)) } },
      LiabilitiesCurrent: { units: { USD: inst(series(4e9, 0.03)) } },
      InventoryNet: { units: { USD: inst(series(1e9, 0.02)) } },
      LongTermDebtCurrent: { units: { USD: inst(series(0.5e9, 0)) } },
      LongTermDebtNoncurrent: { units: { USD: inst(series(4e9, 0)) } },
      NetCashProvidedByUsedInOperatingActivities: { units: { USD: flow(series(2.2e9, 0.09)) } },
      PaymentsToAcquirePropertyPlantAndEquipment: { units: { USD: flow(series(0.6e9, 0.05)) } },
      PaymentsOfDividends: { units: { USD: flow(series(0.3e9, 0.05)) } },
    },
  },
};

function bars(base, drift) {
  const lines = [];
  const start = Date.UTC(2020, 0, 1);
  for (let i = 0; i < 1900; i++) {
    const d = new Date(start + i * 86_400_000);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const c = base * Math.pow(1 + drift, i) * (1 + 0.05 * Math.sin(i / 30));
    const r = Math.round(c * 100) / 100;
    lines.push({ date: `${d.toISOString().slice(0, 10)}T00:00:00.000Z`, close: r, adjClose: r, adjOpen: r, adjHigh: Math.round(r * 101) / 100, adjLow: Math.round(r * 99) / 100, adjVolume: 1000000 + (i % 7) * 10000 });
  }
  return lines;
}

export function createMockResearch() {
  const state = { requests: [] };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    state.requests.push({ path: url.pathname, ua: req.headers['user-agent'], token: req.headers['x-finnhub-token'] });
    const json = (b, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(b));
    };
    const p = url.pathname;
    if (p === '/files/company_tickers_exchange.json') return json({ fields: ['cik', 'name', 'ticker', 'exchange'], data: [[CIK, 'Testco Inc.', 'TSTC', 'Nasdaq'], [7654321, 'Altra Spa', 'ALTR', 'NYSE']] });
    if (p === `/api/xbrl/companyfacts/CIK000${CIK}.json`) return json(COMPANY_FACTS);
    if (p === `/submissions/CIK000${CIK}.json`) return json({ name: 'Testco Inc.', tickers: ['TSTC'], exchanges: ['Nasdaq'], sicDescription: 'Software', fiscalYearEnd: '1231', filings: { recent: { form: ['10-K', '10-Q'], filingDate: ['2026-02-01', '2026-05-01'], reportDate: ['2025-12-31', '2026-03-31'], accessionNumber: ['0001234567-26-000001', '0001234567-26-000002'], primaryDocument: ['tstc-10k.htm', 'tstc-10q.htm'] } } });
    // Finnhub
    const sym = url.searchParams.get('symbol');
    if (p === '/quote') return json(sym === 'TSTC' ? { c: 60, d: 1.2, dp: 2.04, h: 61, l: 58.5, o: 59, pc: 58.8, t: 1795000000 } : { c: 0 });
    if (p === '/stock/profile2') return json(sym === 'TSTC' ? { name: 'Testco Inc.', ticker: 'TSTC', exchange: 'NASDAQ NMS - GLOBAL MARKET', currency: 'USD', country: 'US', finnhubIndustry: 'Technology', marketCapitalization: 60000, shareOutstanding: 1000, weburl: 'https://example.com', ipo: '2010-05-01' } : {});
    if (p === '/stock/recommendation') return json(sym === 'TSTC' ? [{ period: '2026-11-01', strongBuy: 5, buy: 10, hold: 6, sell: 1, strongSell: 0 }] : []);
    if (p === '/stock/metric') return json({ metric: { '52WeekHigh': 65, '52WeekLow': 40, beta: 1.1, '3MonthAverageTradingVolume': 1.2 } });
    if (p === '/search') return json({ result: [{ symbol: 'TSTC', description: 'TESTCO INC', type: 'Common Stock', displaySymbol: 'TSTC' }] });
    if (p === '/company-news') return json([{ headline: 'Testco presenta i risultati', url: 'https://example.com/news', source: 'Esempio', datetime: 1795000000 }]);
    // Tiingo
    const tm = p.match(/^\/tiingo\/daily\/([a-z.]+)\/prices$/);
    if (tm) {
      if (req.headers.authorization !== 'Token e2e-key') return json({ detail: 'auth' }, 401);
      const rows = tm[1] === 'tstc' ? bars(30, 0.0004) : tm[1] === 'spy' ? bars(300, 0.0003) : null;
      return rows ? json(rows) : json({ detail: 'not found' }, 404);
    }
    res.writeHead(404);
    res.end();
  });
  return { server, state };
}
