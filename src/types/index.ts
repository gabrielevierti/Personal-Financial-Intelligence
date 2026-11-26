/**
 * Tipi di dominio di PFI.
 * Tutti gli importi monetari sono interi in centesimi (Cents).
 */

export type Cents = number;
export type ID = string;
/** Data ISO di calendario: YYYY-MM-DD */
export type ISODate = string;
/** Mese ISO: YYYY-MM */
export type ISOMonth = string;

export type AccountType =
  | 'checking'
  | 'deposit'
  | 'cash'
  | 'debit_card'
  | 'credit_card'
  | 'investment'
  | 'loan'
  | 'other';

export interface Account {
  id: ID;
  name: string;
  institution: string;
  type: AccountType;
  currency: string;
  initialBalance: Cents;
  createdAt: ISODate;
  archived: boolean;
  color?: string;
  notes?: string;
}

export type TransactionType = 'income' | 'expense' | 'transfer';

export interface Transaction {
  id: ID;
  accountId: ID;
  date: ISODate;
  description: string;
  /** Importo con segno rispetto al conto: positivo = entra, negativo = esce. */
  amount: Cents;
  type: TransactionType;
  categoryId: ID | null;
  currency: string;
  notes?: string;
  /** Collega le due gambe di un trasferimento. */
  transferId?: ID;
  /** Conto controparte (solo per trasferimenti). */
  counterAccountId?: ID;
  importBatchId?: ID;
  /** Identificativo del movimento presso la banca (sincronizzazione Enable Banking). */
  externalId?: string;
  /** Movimento non ancora contabilizzato dalla banca: viene sostituito a ogni sincronizzazione. */
  pending?: boolean;
  /** IBAN della controparte, se fornito dalla banca. */
  counterpartIban?: string;
  /** Impronta per il riconoscimento dei duplicati. */
  fingerprint: string;
  createdAt: string;
  updatedAt: string;
}

export type CategoryKind = 'income' | 'expense';

export interface Category {
  id: ID;
  name: string;
  kind: CategoryKind;
  color: string;
  icon: string;
  isDefault: boolean;
}

export interface Budget {
  id: ID;
  month: ISOMonth;
  /** null = budget totale del mese */
  categoryId: ID | null;
  limit: Cents;
}

export type GoalPriority = 'low' | 'medium' | 'high';

export interface SavingsGoal {
  id: ID;
  name: string;
  targetAmount: Cents;
  currentAmount: Cents;
  targetDate: ISODate | null;
  priority: GoalPriority;
  description: string;
  createdAt: ISODate;
}

export type AssetType =
  | 'liquidity'
  | 'deposit'
  | 'stock'
  | 'etf'
  | 'bond'
  | 'fund'
  | 'crypto'
  | 'real_estate'
  | 'vehicle'
  | 'physical'
  | 'other';

export interface Asset {
  id: ID;
  name: string;
  type: AssetType;
  /** Quantità (può essere frazionaria, es. crypto o quote di fondi). */
  quantity: number;
  /** Prezzo medio di acquisto per unità, in centesimi. */
  purchasePrice: Cents;
  /** Valore corrente per unità, inserito manualmente, in centesimi. */
  currentPrice: Cents;
  currency: string;
  updatedAt: ISODate;
  notes?: string;
  /** Data di acquisto (beni fisici, veicoli). */
  purchaseDate?: ISODate;
  /** Deprezzamento annuo stimato in percentuale (es. 15 = −15%/anno). Solo una stima. */
  depreciationRate?: number;
}

export interface AssetValuation {
  id: ID;
  assetId: ID;
  date: ISODate;
  unitPrice: Cents;
  quantity: number;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

export interface AppSettings {
  baseCurrency: string;
  /** Tassi di cambio manuali: 1 unità di valuta = rate unità di valuta base. */
  exchangeRates: Record<string, number>;
}

export interface Period {
  start: ISODate;
  end: ISODate;
  label: string;
}

/** Consenso di accesso in lettura concesso a una banca tramite Enable Banking. */
export interface BankConnection {
  /** session_id di Enable Banking */
  id: ID;
  aspspName: string;
  aspspCountry: string;
  validUntil: string;
  createdAt: string;
  status: 'active' | 'expired' | 'revoked';
  lastError?: string;
}

/** Conto bancario remoto, eventualmente associato a un conto PFI. */
export interface BankLink {
  /** uid del conto in Enable Banking */
  id: ID;
  connectionId: ID;
  iban: string;
  name: string;
  currency: string;
  cashAccountType?: string;
  accountId: ID | null;
  /** Data da cui importare i movimenti alla prima sincronizzazione. */
  syncFrom: ISODate;
  lastSyncAt: string | null;
  lastBookingDate: ISODate | null;
  bankBalance: Cents | null;
  bankBalanceType: string | null;
  bankBalanceDate: string | null;
  /** Conto creato dal collegamento: alla prima sincronizzazione il saldo viene allineato a quello della banca. */
  autoAlign?: boolean;
  /** Tutti i saldi restituiti dalla banca all'ultima sincronizzazione. */
  bankBalances?: StoredBalance[];
  /** Saldo scelto come riferimento (chiave in bankBalances); null = scelta automatica. */
  balanceKey?: string | null;
  pendingCount?: number;
  pendingAmount?: Cents;
  /** Versione della logica di sincronizzazione usata l'ultima volta (cambia → risincronizzazione completa). */
  syncVersion?: number;
}

export interface StoredBalance {
  key: string;
  type: string;
  name: string;
  amount: Cents;
  currency: string;
  date: string | null;
}

/** Regola di categorizzazione: i movimenti di un esercente vanno sempre in una categoria. */
export interface CategoryRule {
  id: ID;
  /** chiave esercente normalizzata (vedi merchantKey) */
  pattern: string;
  kind: CategoryKind;
  categoryId: ID;
  source: 'user' | 'ai';
  createdAt: string;
}

// ---------------------------------------------------------------------------
// PFI 2.0
// ---------------------------------------------------------------------------

export type ScheduledKind = 'income' | 'rent' | 'bill' | 'insurance' | 'subscription' | 'debt' | 'investment' | 'other';
export type ScheduledFrequency = 'once' | 'monthly' | 'quarterly' | 'yearly';

/** Movimento futuro noto (stipendio, affitto, bollette, rate…) usato dalle previsioni. */
export interface ScheduledItem {
  id: ID;
  name: string;
  kind: ScheduledKind;
  /** Importo con segno: positivo = entrata, negativo = uscita. */
  amount: Cents;
  currency: string;
  frequency: ScheduledFrequency;
  /** Prossima scadenza. */
  nextDate: ISODate;
  endDate?: ISODate | null;
  accountId?: ID | null;
  /** true = importo certo (contratto, stipendio fisso); false = importo stimato (bolletta variabile). */
  fixedAmount: boolean;
  /** Esercente del movimento ricorrente da cui è stato creato (evita di contarlo due volte nelle stime). */
  merchant?: string;
  notes?: string;
}

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
  at: string;
}

export interface AiConversation {
  id: ID;
  /** Sezione dell'app in cui è nata la conversazione (dashboard, transactions, company:AAPL…). */
  section: string;
  title: string;
  messages: AiMessage[];
  createdAt: string;
  updatedAt: string;
  model?: string;
}

export interface WatchItem {
  id: ID;
  symbol: string;
  name: string;
  exchange?: string;
  currency?: string;
  list: string;
  favorite: boolean;
  addedAt: string;
  notes?: string;
}

/** Istantanea riproducibile di un'analisi aziendale: dati, fonti e ipotesi usati. */
export interface CompanySnapshot {
  id: ID;
  symbol: string;
  name: string;
  createdAt: string;
  /** Dati e ipotesi serializzati (JSON). */
  payload: unknown;
  sources: string[];
}

export interface ResearchCacheRow {
  key: string;
  fetchedAt: string;
  value: unknown;
}
