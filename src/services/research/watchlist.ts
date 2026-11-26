import { db } from '../../database/db';
import type { WatchItem } from '../../types';
import { uid } from '../../utils/id';

export async function addToWatchlist(i: { symbol: string; name: string; exchange?: string; currency?: string }, list = 'Principale'): Promise<void> {
  const sym = i.symbol.toUpperCase();
  const existing = await db.watchlist.where('symbol').equals(sym).filter((w) => w.list === list).first();
  if (existing) return;
  await db.watchlist.add({ id: uid(), symbol: sym, name: i.name, exchange: i.exchange, currency: i.currency, list, favorite: false, addedAt: new Date().toISOString() });
}

export async function removeFromWatchlist(id: string): Promise<void> {
  await db.watchlist.delete(id);
}

export async function updateWatchItem(id: string, patch: Partial<Pick<WatchItem, 'favorite' | 'notes' | 'list'>>): Promise<void> {
  await db.watchlist.update(id, patch);
}
