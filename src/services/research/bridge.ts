/**
 * Accesso ai dati di mercato tramite il bridge locale, con cache in IndexedDB.
 * Se la fonte non risponde si usa l'ultimo dato in cache, segnalandolo come non aggiornato.
 */
import { db } from '../../database/db';
import { getBridgeUrl } from '../bank/sync';
import { ProviderError } from './types';

export interface Fetched<T> {
  data: T;
  fetchedAt: string;
  fromCache: boolean;
  /** true se la fonte non ha risposto ed è stato usato un dato in cache scaduto */
  stale: boolean;
}

export const TTL = {
  minute: 60_000,
  quote: 15 * 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
};

type FetchImpl = typeof fetch;
let fetchImpl: FetchImpl = (...a) => fetch(...a);
let baseOverride: string | null = null;

/** Solo per i test. */
export function __setResearchFetch(f: FetchImpl | null, base: string | null = null): void {
  fetchImpl = f ?? ((...a) => fetch(...a));
  baseOverride = base;
}

async function base(): Promise<string> {
  return (baseOverride ?? (await getBridgeUrl())).replace(/\/$/, '');
}

export async function bridgeGet<T>(path: string, provider: string, ttl: number, opts: { force?: boolean } = {}): Promise<Fetched<T>> {
  const key = `r:${path}`;
  const cached = await db.research_cache.get(key);
  if (cached && !opts.force && Date.now() - new Date(cached.fetchedAt).getTime() < ttl) {
    return { data: cached.value as T, fetchedAt: cached.fetchedAt, fromCache: true, stale: false };
  }
  let res: Response;
  try {
    res = await fetchImpl(`${await base()}${path}`);
  } catch {
    if (cached) return { data: cached.value as T, fetchedAt: cached.fetchedAt, fromCache: true, stale: true };
    throw new ProviderError(provider, 'BRIDGE_DOWN', 'Il bridge locale non risponde: avvialo con "npm run bridge" per scaricare i dati di mercato.');
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non JSON */
  }
  if (!res.ok) {
    if (cached && res.status === 429) return { data: cached.value as T, fetchedAt: cached.fetchedAt, fromCache: true, stale: true };
    const j = (json ?? {}) as { error?: string; message?: string };
    throw new ProviderError(provider, j.error ?? String(res.status), j.message ?? `Errore ${res.status} da ${provider}`);
  }
  const fetchedAt = new Date().toISOString();
  await db.research_cache.put({ key, fetchedAt, value: json });
  return { data: json as T, fetchedAt, fromCache: false, stale: false };
}

export interface BridgeResearchStatus {
  providers: Record<string, { configured: boolean; needs: string; coverage: string; usedToday?: number }>;
}

export async function researchStatus(): Promise<BridgeResearchStatus | null> {
  try {
    const res = await fetchImpl(`${await base()}/research/status`);
    if (!res.ok) return null;
    return (await res.json()) as BridgeResearchStatus;
  } catch {
    return null;
  }
}

export async function clearResearchCache(): Promise<number> {
  const n = await db.research_cache.count();
  await db.research_cache.clear();
  return n;
}
