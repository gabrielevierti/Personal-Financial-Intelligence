/**
 * Tipi di Investment Research. Ogni valore porta con sé la sua provenienza:
 * fonte, data di aggiornamento, periodo, valuta, unità, stato di verifica e ritardo.
 * I valori finanziari delle aziende sono numeri in unità di valuta (non centesimi):
 * sono dati di terzi, spesso in miliardi, e non vengono mai sommati ai soldi personali.
 */

export type VerificationStatus =
  /** dato riportato dalla fonte ufficiale (es. bilancio depositato alla SEC) */
  | 'ufficiale'
  /** dato di un fornitore di dati di mercato */
  | 'fornitore'
  /** calcolato da PFI a partire da dati delle fonti */
  | 'calcolato'
  /** ipotesi inserita dall'utente */
  | 'ipotesi';

export interface Provenance {
  source: string;
  /** Quando PFI ha scaricato il dato (ISO). */
  fetchedAt: string;
  /** Data o periodo a cui si riferisce il dato (es. "FY2024", "2025-11-21"). */
  period?: string;
  currency?: string;
  unit?: string;
  status: VerificationStatus;
  /** Ritardo dichiarato: "fine giornata", "15 min", "ritardato (non in tempo reale)". */
  delay?: string;
  url?: string;
}

export interface Sourced<T> {
  value: T;
  prov: Provenance;
}

export interface SearchResult {
  symbol: string;
  name: string;
  exchange?: string;
  type?: string;
  region?: string;
  currency?: string;
  /** CIK SEC, se la società deposita i bilanci negli USA */
  cik?: string;
  isin?: string;
  source: string;
}

export interface CompanyProfile {
  symbol: string;
  name: string;
  exchange?: string;
  currency?: string;
  country?: string;
  sector?: string;
  industry?: string;
  description?: string;
  website?: string;
  logo?: string;
  ipo?: string;
  marketCap?: Sourced<number>;
  sharesOutstanding?: Sourced<number>;
  cik?: string;
  fiscalYearEnd?: string;
  sources: Provenance[];
}

export interface Quote {
  symbol: string;
  price: number;
  change?: number;
  changePct?: number;
  previousClose?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  currency?: string;
  /** Data/ora a cui si riferisce il prezzo secondo la fonte. */
  asOf: string;
  prov: Provenance;
}

export interface PricePoint {
  date: string;
  open?: number;
  high?: number;
  low?: number;
  close: number;
  volume?: number;
}

export interface PriceHistory {
  symbol: string;
  interval: 'daily' | 'weekly';
  points: PricePoint[];
  prov: Provenance;
}

/** Voci di bilancio di un esercizio. null = la fonte non riporta il dato (mai stimato). */
export interface FinancialYear {
  fiscalYear: number;
  periodEnd: string;
  currency: string;
  revenue: number | null;
  costOfRevenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  ebitda: number | null;
  depreciation: number | null;
  interestExpense: number | null;
  incomeTax: number | null;
  pretaxIncome: number | null;
  epsDiluted: number | null;
  sharesDiluted: number | null;
  // stato patrimoniale
  totalAssets: number | null;
  totalLiabilities: number | null;
  equity: number | null;
  cash: number | null;
  shortTermInvestments: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  inventory: number | null;
  receivables: number | null;
  shortTermDebt: number | null;
  longTermDebt: number | null;
  // flussi di cassa
  operatingCashFlow: number | null;
  capex: number | null;
  dividendsPaid: number | null;
  buybacks: number | null;
  /** Fonte di ogni voce (stessa per tutto l'esercizio, salvo eccezioni). */
  prov: Provenance;
  /** Voci la cui origine è diversa da prov (es. EBITDA calcolato). */
  derived: string[];
}

export interface AnalystData {
  recommendations?: Sourced<Array<{ period: string; strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }>>;
  priceTarget?: Sourced<{ mean: number | null; high: number | null; low: number | null }>;
  /** Motivo per cui un dato non è disponibile (mai simulato). */
  unavailable: string[];
}

export interface NewsItem {
  headline: string;
  url: string;
  source: string;
  datetime: string;
  summary?: string;
}

export interface Filing {
  form: string;
  filingDate: string;
  reportDate?: string;
  url: string;
}

export interface ProviderStatus {
  id: string;
  configured: boolean;
  needs: string;
  coverage: string;
  usedToday?: number;
}

/** Interfaccia modulare dei fornitori: ognuno implementa solo ciò che sa fare. */
export interface MarketDataProvider {
  id: string;
  label: string;
  searchCompany?(query: string): Promise<SearchResult[]>;
  getCompanyProfile?(symbol: string, hint?: SearchResult): Promise<CompanyProfile | null>;
  getQuote?(symbol: string): Promise<Quote | null>;
  getHistoricalPrices?(symbol: string, interval: 'daily' | 'weekly'): Promise<PriceHistory | null>;
  getFinancialStatements?(symbol: string, hint?: { cik?: string }): Promise<FinancialYear[] | null>;
  getFinancialRatios?(symbol: string): Promise<Record<string, Sourced<number>> | null>;
  getAnalystEstimates?(symbol: string): Promise<AnalystData | null>;
  getNews?(symbol: string): Promise<NewsItem[] | null>;
  getFilings?(symbol: string, hint?: { cik?: string }): Promise<Filing[] | null>;
}

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
