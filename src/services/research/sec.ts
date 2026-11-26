/**
 * SEC EDGAR: fonte ufficiale e gratuita per i bilanci delle società che depositano negli USA.
 * I dati XBRL ("companyfacts") sono quelli dei documenti 10-K / 20-F depositati.
 */
import { bridgeGet, TTL } from './bridge';
import type { FinancialYear, Filing, MarketDataProvider, Provenance, SearchResult } from './types';

interface TickerFile {
  fields: string[];
  data: Array<Array<string | number>>;
}

interface Fact {
  start?: string;
  end: string;
  val: number;
  fy?: number;
  fp?: string;
  form: string;
  filed: string;
}

export interface CompanyFacts {
  cik: number;
  entityName: string;
  facts: Record<string, Record<string, { label?: string; units: Record<string, Fact[]> }>>;
}

const ANNUAL_FORMS = new Set(['10-K', '10-K/A', '20-F', '20-F/A', '40-F', '40-F/A', '10-KT']);

type Field = Exclude<keyof FinancialYear, 'fiscalYear' | 'periodEnd' | 'currency' | 'prov' | 'derived'>;

/** Concetti XBRL in ordine di preferenza (US GAAP poi IFRS). */
export const CONCEPTS: Record<Field, { kind: 'flow' | 'instant'; unit: 'money' | 'shares' | 'perShare'; tags: string[] }> = {
  revenue: { kind: 'flow', unit: 'money', tags: ['us-gaap:Revenues', 'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax', 'us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax', 'us-gaap:SalesRevenueNet', 'ifrs-full:Revenue'] },
  costOfRevenue: { kind: 'flow', unit: 'money', tags: ['us-gaap:CostOfRevenue', 'us-gaap:CostOfGoodsAndServicesSold', 'us-gaap:CostOfGoodsSold', 'ifrs-full:CostOfSales'] },
  grossProfit: { kind: 'flow', unit: 'money', tags: ['us-gaap:GrossProfit', 'ifrs-full:GrossProfit'] },
  operatingIncome: { kind: 'flow', unit: 'money', tags: ['us-gaap:OperatingIncomeLoss', 'ifrs-full:ProfitLossFromOperatingActivities'] },
  netIncome: { kind: 'flow', unit: 'money', tags: ['us-gaap:NetIncomeLoss', 'ifrs-full:ProfitLossAttributableToOwnersOfParent', 'ifrs-full:ProfitLoss'] },
  ebitda: { kind: 'flow', unit: 'money', tags: [] },
  depreciation: { kind: 'flow', unit: 'money', tags: ['us-gaap:DepreciationDepletionAndAmortization', 'us-gaap:DepreciationAndAmortization', 'us-gaap:DepreciationAmortizationAndAccretionNet', 'us-gaap:Depreciation', 'ifrs-full:DepreciationAndAmortisationExpense'] },
  interestExpense: { kind: 'flow', unit: 'money', tags: ['us-gaap:InterestExpense', 'us-gaap:InterestExpenseNonoperating', 'us-gaap:InterestExpenseDebt', 'ifrs-full:InterestExpense', 'ifrs-full:FinanceCosts'] },
  incomeTax: { kind: 'flow', unit: 'money', tags: ['us-gaap:IncomeTaxExpenseBenefit', 'ifrs-full:IncomeTaxExpenseContinuingOperations'] },
  pretaxIncome: { kind: 'flow', unit: 'money', tags: ['us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments', 'ifrs-full:ProfitLossBeforeTax'] },
  epsDiluted: { kind: 'flow', unit: 'perShare', tags: ['us-gaap:EarningsPerShareDiluted', 'ifrs-full:DilutedEarningsLossPerShare'] },
  sharesDiluted: { kind: 'flow', unit: 'shares', tags: ['us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding', 'ifrs-full:WeightedAverageNumberOfOrdinarySharesOutstandingDiluted'] },
  totalAssets: { kind: 'instant', unit: 'money', tags: ['us-gaap:Assets', 'ifrs-full:Assets'] },
  totalLiabilities: { kind: 'instant', unit: 'money', tags: ['us-gaap:Liabilities', 'ifrs-full:Liabilities'] },
  equity: { kind: 'instant', unit: 'money', tags: ['us-gaap:StockholdersEquity', 'us-gaap:StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest', 'ifrs-full:EquityAttributableToOwnersOfParent', 'ifrs-full:Equity'] },
  cash: { kind: 'instant', unit: 'money', tags: ['us-gaap:CashAndCashEquivalentsAtCarryingValue', 'us-gaap:CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'ifrs-full:CashAndCashEquivalents'] },
  shortTermInvestments: { kind: 'instant', unit: 'money', tags: ['us-gaap:ShortTermInvestments', 'us-gaap:MarketableSecuritiesCurrent', 'us-gaap:AvailableForSaleSecuritiesDebtSecuritiesCurrent', 'ifrs-full:CurrentInvestments'] },
  currentAssets: { kind: 'instant', unit: 'money', tags: ['us-gaap:AssetsCurrent', 'ifrs-full:CurrentAssets'] },
  currentLiabilities: { kind: 'instant', unit: 'money', tags: ['us-gaap:LiabilitiesCurrent', 'ifrs-full:CurrentLiabilities'] },
  inventory: { kind: 'instant', unit: 'money', tags: ['us-gaap:InventoryNet', 'ifrs-full:Inventories'] },
  receivables: { kind: 'instant', unit: 'money', tags: ['us-gaap:AccountsReceivableNetCurrent', 'ifrs-full:TradeAndOtherCurrentReceivables'] },
  shortTermDebt: { kind: 'instant', unit: 'money', tags: ['us-gaap:DebtCurrent', 'us-gaap:LongTermDebtCurrent', 'ifrs-full:CurrentBorrowings'] },
  longTermDebt: { kind: 'instant', unit: 'money', tags: ['us-gaap:LongTermDebtNoncurrent', 'ifrs-full:NoncurrentBorrowings'] },
  operatingCashFlow: { kind: 'flow', unit: 'money', tags: ['us-gaap:NetCashProvidedByUsedInOperatingActivities', 'ifrs-full:CashFlowsFromUsedInOperatingActivities'] },
  capex: { kind: 'flow', unit: 'money', tags: ['us-gaap:PaymentsToAcquirePropertyPlantAndEquipment', 'us-gaap:PaymentsToAcquireProductiveAssets', 'ifrs-full:PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities'] },
  dividendsPaid: { kind: 'flow', unit: 'money', tags: ['us-gaap:PaymentsOfDividends', 'us-gaap:PaymentsOfDividendsCommonStock', 'ifrs-full:DividendsPaidClassifiedAsFinancingActivities'] },
  buybacks: { kind: 'flow', unit: 'money', tags: ['us-gaap:PaymentsForRepurchaseOfCommonStock', 'ifrs-full:PaymentsToAcquireOrRedeemEntitysShares'] },
};

const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

function unitsOf(f: CompanyFacts, tag: string) {
  const [tax, name] = tag.split(':');
  return f.facts[tax]?.[name]?.units;
}

function pickUnit(units: Record<string, Fact[]>, kind: 'money' | 'shares' | 'perShare'): [string, Fact[]] | null {
  const keys = Object.keys(units);
  const k = kind === 'shares' ? keys.find((u) => u === 'shares') : kind === 'perShare' ? keys.find((u) => /\/shares$/.test(u)) : keys.find((u) => /^[A-Z]{3}$/.test(u));
  return k ? [k, units[k]] : null;
}

/** Valori annuali di un concetto, indicizzati per data di chiusura dell'esercizio (ultimo deposito vince). */
function annualValues(f: CompanyFacts, tags: string[], kind: 'flow' | 'instant', unit: 'money' | 'shares' | 'perShare'): { byEnd: Map<string, number>; currency: string | null } {
  for (const tag of tags) {
    const units = unitsOf(f, tag);
    if (!units) continue;
    const picked = pickUnit(units, unit);
    if (!picked) continue;
    const [u, facts] = picked;
    const byEnd = new Map<string, { val: number; filed: string }>();
    for (const x of facts) {
      if (!ANNUAL_FORMS.has(x.form)) continue;
      if (kind === 'flow') {
        if (!x.start) continue;
        const d = days(x.start, x.end);
        if (d < 340 || d > 380) continue;
      } else if (x.start) continue;
      const cur = byEnd.get(x.end);
      if (!cur || x.filed > cur.filed) byEnd.set(x.end, { val: x.val, filed: x.filed });
    }
    if (byEnd.size) return { byEnd: new Map([...byEnd].map(([k, v]) => [k, v.val])), currency: unit === 'money' ? u : unit === 'perShare' ? u.split('/')[0] : null };
  }
  return { byEnd: new Map(), currency: null };
}

/** Converte i companyfacts in esercizi annuali (al massimo `years`, dal più recente). Nessun valore stimato. */
export function parseCompanyFacts(f: CompanyFacts, fetchedAt: string, years = 10): FinancialYear[] {
  const values = {} as Record<Field, Map<string, number>>;
  let currency: string | null = null;
  for (const [field, def] of Object.entries(CONCEPTS) as Array<[Field, (typeof CONCEPTS)[Field]]>) {
    const r = annualValues(f, def.tags, def.kind, def.unit);
    values[field] = r.byEnd;
    if (!currency && def.unit === 'money' && r.currency) currency = r.currency;
  }
  // esercizi: le date di chiusura dei flussi annuali principali
  const ends = new Set<string>([...values.revenue.keys(), ...values.netIncome.keys(), ...values.operatingCashFlow.keys()]);
  const sorted = [...ends].sort().reverse();
  // scarta chiusure troppo vicine (es. esercizi di transizione duplicati)
  const kept: string[] = [];
  for (const e of sorted) if (!kept.some((k) => Math.abs(days(e, k)) < 300)) kept.push(e);
  const near = (m: Map<string, number>, end: string): number | null => {
    if (m.has(end)) return m.get(end)!;
    for (const [k, v] of m) if (Math.abs(days(k, end)) <= 7) return v;
    return null;
  };
  return kept.slice(0, years).map((end) => {
    const derived: string[] = [];
    const g = (field: Field) => near(values[field], end);
    const y: FinancialYear = {
      fiscalYear: Number(end.slice(0, 4)),
      periodEnd: end,
      currency: currency ?? 'USD',
      revenue: g('revenue'),
      costOfRevenue: g('costOfRevenue'),
      grossProfit: g('grossProfit'),
      operatingIncome: g('operatingIncome'),
      netIncome: g('netIncome'),
      ebitda: null,
      depreciation: g('depreciation'),
      interestExpense: g('interestExpense'),
      incomeTax: g('incomeTax'),
      pretaxIncome: g('pretaxIncome'),
      epsDiluted: g('epsDiluted'),
      sharesDiluted: g('sharesDiluted'),
      totalAssets: g('totalAssets'),
      totalLiabilities: g('totalLiabilities'),
      equity: g('equity'),
      cash: g('cash'),
      shortTermInvestments: g('shortTermInvestments'),
      currentAssets: g('currentAssets'),
      currentLiabilities: g('currentLiabilities'),
      inventory: g('inventory'),
      receivables: g('receivables'),
      shortTermDebt: g('shortTermDebt'),
      longTermDebt: g('longTermDebt'),
      operatingCashFlow: g('operatingCashFlow'),
      capex: g('capex'),
      dividendsPaid: g('dividendsPaid'),
      buybacks: g('buybacks'),
      prov: { source: 'SEC EDGAR (XBRL, bilanci depositati)', fetchedAt, period: `Esercizio chiuso il ${end}`, currency: currency ?? 'USD', unit: 'unità di valuta', status: 'ufficiale', url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${f.cik}&type=10-K` },
      derived,
    };
    if (y.grossProfit === null && y.revenue !== null && y.costOfRevenue !== null) {
      y.grossProfit = y.revenue - y.costOfRevenue;
      derived.push('grossProfit');
    }
    if (y.totalLiabilities === null && y.totalAssets !== null && y.equity !== null) {
      y.totalLiabilities = y.totalAssets - y.equity;
      derived.push('totalLiabilities');
    }
    if (y.operatingIncome !== null && y.depreciation !== null) {
      y.ebitda = y.operatingIncome + y.depreciation;
      derived.push('ebitda');
    }
    return y;
  });
}

const cikPad = (cik: string | number) => String(cik).replace(/^0+/, '');

export const secProvider: MarketDataProvider & { tickers(): Promise<SearchResult[]>; facts(cik: string): Promise<{ data: CompanyFacts; fetchedAt: string }> } = {
  id: 'sec',
  label: 'SEC EDGAR',
  async tickers() {
    const r = await bridgeGet<TickerFile>('/research/sec/tickers', 'SEC EDGAR', TTL.week);
    const idx = (n: string) => r.data.fields.indexOf(n);
    const [ci, ni, ti, ei] = [idx('cik'), idx('name'), idx('ticker'), idx('exchange')];
    return r.data.data.map((row) => ({ symbol: String(row[ti]), name: String(row[ni]), exchange: row[ei] ? String(row[ei]) : undefined, cik: String(row[ci]), region: 'United States', currency: 'USD', source: 'SEC EDGAR' }));
  },
  async searchCompany(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const all = await this.tickers();
    const exact = all.filter((t) => t.symbol.toLowerCase() === q);
    const starts = all.filter((t) => t.symbol.toLowerCase() !== q && (t.symbol.toLowerCase().startsWith(q) || t.name.toLowerCase().startsWith(q)));
    const contains = all.filter((t) => !exact.includes(t) && !starts.includes(t) && (t.name.toLowerCase().includes(q) || t.exchange?.toLowerCase() === q));
    return [...exact, ...starts, ...contains].slice(0, 15);
  },
  async facts(cik) {
    const r = await bridgeGet<CompanyFacts>(`/research/sec/facts/${cikPad(cik)}`, 'SEC EDGAR', TTL.day);
    return { data: r.data, fetchedAt: r.fetchedAt };
  },
  async getFinancialStatements(symbol, hint) {
    let cik = hint?.cik;
    if (!cik) cik = (await this.tickers()).find((t) => t.symbol.toUpperCase() === symbol.toUpperCase())?.cik;
    if (!cik) return null;
    const { data, fetchedAt } = await this.facts(cik);
    return parseCompanyFacts(data, fetchedAt);
  },
  async getCompanyProfile(symbol, hint) {
    let cik = hint?.cik;
    if (!cik) cik = (await this.tickers()).find((t) => t.symbol.toUpperCase() === symbol.toUpperCase())?.cik;
    if (!cik) return null;
    const r = await bridgeGet<{ name: string; tickers: string[]; exchanges: string[]; sicDescription?: string; fiscalYearEnd?: string; website?: string; stateOfIncorporation?: string }>(`/research/sec/submissions/${cikPad(cik)}`, 'SEC EDGAR', TTL.day);
    const prov: Provenance = { source: 'SEC EDGAR', fetchedAt: r.fetchedAt, status: 'ufficiale' };
    return { symbol, name: r.data.name, exchange: r.data.exchanges?.[0], industry: r.data.sicDescription, country: 'US', currency: 'USD', cik, fiscalYearEnd: r.data.fiscalYearEnd, website: r.data.website || undefined, sources: [prov] };
  },
  async getFilings(symbol, hint) {
    let cik = hint?.cik;
    if (!cik) cik = (await this.tickers()).find((t) => t.symbol.toUpperCase() === symbol.toUpperCase())?.cik;
    if (!cik) return null;
    const r = await bridgeGet<{ filings: { recent: { form: string[]; filingDate: string[]; reportDate: string[]; accessionNumber: string[]; primaryDocument: string[] } } }>(`/research/sec/submissions/${cikPad(cik)}`, 'SEC EDGAR', TTL.day);
    const rec = r.data.filings?.recent;
    if (!rec) return [];
    const out: Filing[] = [];
    for (let i = 0; i < rec.form.length && out.length < 25; i++) {
      if (!/^(10-K|10-Q|20-F|40-F|8-K|6-K)/.test(rec.form[i])) continue;
      out.push({ form: rec.form[i], filingDate: rec.filingDate[i], reportDate: rec.reportDate[i] || undefined, url: `https://www.sec.gov/Archives/edgar/data/${cikPad(cik)}/${rec.accessionNumber[i].replace(/-/g, '')}/${rec.primaryDocument[i]}` });
    }
    return out;
  },
};
