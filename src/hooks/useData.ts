import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../database/db';
import type { DataSet } from '../services/reports';
import type { AppSettings } from '../types';

/** Carica l'intero dataset in modo reattivo. Restituisce undefined durante il caricamento. */
export function useDataSet(): DataSet | undefined {
  return useLiveQuery(async () => {
    const [accounts, transactions, categories, budgets, assets, valuations, settingsRows] = await Promise.all([
      db.accounts.toArray(),
      db.transactions.toArray(),
      db.categories.toArray(),
      db.budgets.toArray(),
      db.assets.toArray(),
      db.asset_valuations.toArray(),
      db.settings.toArray(),
    ]);
    const map = new Map(settingsRows.map((r) => [r.key, r.value]));
    const settings: AppSettings = {
      baseCurrency: (map.get('baseCurrency') as string) ?? 'EUR',
      exchangeRates: (map.get('exchangeRates') as Record<string, number>) ?? {},
    };
    accounts.sort((a, b) => a.name.localeCompare(b.name, 'it'));
    categories.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'it') : a.kind === 'income' ? -1 : 1));
    return { accounts, transactions, categories, budgets, assets, valuations, settings };
  }, []);
}

export function useEarliestDate(): string | undefined {
  return useLiveQuery(async () => (await db.transactions.orderBy('date').first())?.date, []);
}
