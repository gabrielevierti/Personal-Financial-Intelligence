import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback } from 'react';
import { db } from '../database/db';

/** Impostazione salvata nel database locale (tabella settings), reattiva. */
export function useSetting<T>(key: string, fallback: T): [T, (v: T) => Promise<void>, boolean] {
  const row = useLiveQuery(() => db.settings.get(key), [key]);
  const set = useCallback(async (v: T) => {
    await db.settings.put({ key, value: v });
  }, [key]);
  const loaded = row !== undefined || false;
  return [row?.value === undefined ? fallback : (row.value as T), set, loaded];
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row?.value === undefined ? fallback : (row.value as T);
}

export const EMERGENCY_MONTHS_KEY = 'emergencyMonths';
export const COST_BASIS_KEY = 'investCostBasis';
export const RISK_PROFILE_KEY = 'riskProfile';

export interface RiskProfile {
  horizonYears: number;
  tolerance: 'bassa' | 'media' | 'alta';
  /** Quota massima del patrimonio in un singolo titolo (0–1). */
  maxSinglePosition: number;
}

export const DEFAULT_RISK: RiskProfile = { horizonYears: 10, tolerance: 'media', maxSinglePosition: 0.1 };
