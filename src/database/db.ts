import Dexie, { type EntityTable } from 'dexie';
import type { Account, AiConversation, Asset, AssetValuation, BankConnection, BankLink, Budget, Category, CategoryRule, CompanySnapshot, ResearchCacheRow, SavingsGoal, ScheduledItem, SettingRow, Transaction, WatchItem } from '../types';
import { defaultCategories, LEGACY_CATEGORY_COLORS } from './seed';

export const DB_NAME = 'pfi';
export const SCHEMA_VERSION = 5;

export interface ImportBatch {
  id: string;
  fileName: string;
  accountId: string;
  importedAt: string;
  count: number;
}

export class PFIDatabase extends Dexie {
  accounts!: EntityTable<Account, 'id'>;
  transactions!: EntityTable<Transaction, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  budgets!: EntityTable<Budget, 'id'>;
  savings_goals!: EntityTable<SavingsGoal, 'id'>;
  assets!: EntityTable<Asset, 'id'>;
  asset_valuations!: EntityTable<AssetValuation, 'id'>;
  settings!: EntityTable<SettingRow, 'key'>;
  import_batches!: EntityTable<ImportBatch, 'id'>;
  bank_connections!: EntityTable<BankConnection, 'id'>;
  bank_links!: EntityTable<BankLink, 'id'>;
  category_rules!: EntityTable<CategoryRule, 'id'>;
  scheduled_items!: EntityTable<ScheduledItem, 'id'>;
  ai_conversations!: EntityTable<AiConversation, 'id'>;
  watchlist!: EntityTable<WatchItem, 'id'>;
  company_snapshots!: EntityTable<CompanySnapshot, 'id'>;
  /** Cache delle risposte dei fornitori di dati di mercato: non va nel backup. */
  research_cache!: EntityTable<ResearchCacheRow, 'key'>;

  constructor(name = DB_NAME) {
    super(name);

    // v1: schema iniziale
    this.version(1).stores({
      accounts: 'id, type, name',
      transactions: 'id, accountId, date, categoryId, type, [accountId+date]',
      categories: 'id, kind, name',
      budgets: 'id, month, categoryId',
      savings_goals: 'id, targetDate, priority',
      assets: 'id, type',
      asset_valuations: 'id, assetId, date, [assetId+date]',
      settings: 'key',
    });

    // v2: impronte per i duplicati, collegamento trasferimenti, lotti di importazione
    this.version(2)
      .stores({
        transactions: 'id, accountId, date, categoryId, type, fingerprint, transferId, importBatchId, [accountId+date]',
        budgets: 'id, month, categoryId, [month+categoryId]',
        import_batches: 'id, accountId, importedAt',
      })
      .upgrade(async (tx) => {
        await tx
          .table('transactions')
          .toCollection()
          .modify((t: Partial<Transaction>) => {
            if (!t.fingerprint) t.fingerprint = '';
          });
      });

    // v3: collegamento bancario in sola lettura (Enable Banking)
    this.version(3).stores({
      transactions: 'id, accountId, date, categoryId, type, fingerprint, transferId, importBatchId, externalId, [accountId+date]',
      bank_connections: 'id, status',
      bank_links: 'id, connectionId, accountId',
    });

    // v4: regole di categorizzazione per esercente
    this.version(4)
      .stores({
        category_rules: 'id, pattern, categoryId, [pattern+kind]',
      })
      .upgrade(async (tx) => {
        // nuovi colori delle categorie predefinite, solo se l'utente non li ha cambiati
        const fresh = new Map(defaultCategories().map((c) => [c.id, c.color]));
        await tx
          .table('categories')
          .toCollection()
          .modify((c: Category) => {
            if (LEGACY_CATEGORY_COLORS[c.id] && c.color === LEGACY_CATEGORY_COLORS[c.id]) c.color = fresh.get(c.id) ?? c.color;
          });
      });

    // v5: movimenti pianificati, conversazioni AI, ricerca investimenti, categorie di investimento
    this.version(5)
      .stores({
        scheduled_items: 'id, nextDate, kind',
        ai_conversations: 'id, section, updatedAt',
        watchlist: 'id, symbol',
        company_snapshots: 'id, symbol, createdAt',
        research_cache: 'key, fetchedAt',
      })
      .upgrade(async (tx) => {
        const cats = tx.table('categories');
        for (const c of defaultCategories().filter((d) => d.id.startsWith('inv-'))) {
          if (!(await cats.get(c.id))) await cats.add(c);
        }
      });

    this.on('populate', (tx) => {
      tx.table('categories').bulkAdd(defaultCategories());
      tx.table('settings').bulkAdd([
        { key: 'baseCurrency', value: 'EUR' },
        { key: 'exchangeRates', value: {} },
      ]);
    });
  }
}

export let db = new PFIDatabase();

/** Solo per i test: sostituisce l'istanza del database. */
export function __setDatabase(instance: PFIDatabase): void {
  db = instance;
}

export const ALL_TABLES = [
  'accounts',
  'transactions',
  'categories',
  'budgets',
  'savings_goals',
  'assets',
  'asset_valuations',
  'settings',
  'import_batches',
  'bank_connections',
  'bank_links',
  'category_rules',
  'scheduled_items',
  'ai_conversations',
  'watchlist',
  'company_snapshots',
] as const;

/** Tabelle aggiunte dopo la v1 del formato di backup: se mancano in un backup vengono considerate vuote. */
export const OPTIONAL_BACKUP_TABLES: readonly TableName[] = ['import_batches', 'bank_connections', 'bank_links', 'category_rules', 'scheduled_items', 'ai_conversations', 'watchlist', 'company_snapshots'];

export type TableName = (typeof ALL_TABLES)[number];
