import { useCallback, useEffect, useState } from 'react';
import { db } from '../../database/db';
import { loadCompany, loadHistory, type Attempt, type CompanyData } from '../../services/research/registry';
import type { PriceHistory } from '../../services/research/types';

export interface CompanyState {
  data: CompanyData | null;
  daily: PriceHistory | null;
  weekly: PriceHistory | null;
  historyAttempts: Attempt[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useCompany(symbol: string | null, cik?: string): CompanyState {
  const [state, setState] = useState<Omit<CompanyState, 'refresh'>>({ data: null, daily: null, weekly: null, historyAttempts: [], loading: false, error: null });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!symbol) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      try {
        const data = await loadCompany(symbol, cik ? { symbol, name: symbol, cik, source: 'link' } : undefined);
        if (!alive) return;
        setState((s) => ({ ...s, data, loading: true }));
        const h = await loadHistory(symbol, data.profile?.exchange);
        if (!alive) return;
        setState({ data, daily: h.daily, weekly: h.weekly, historyAttempts: h.attempts, loading: false, error: null });
      } catch (e) {
        if (alive) setState((s) => ({ ...s, loading: false, error: (e as Error).message }));
      }
    })();
    return () => {
      alive = false;
    };
  }, [symbol, cik, nonce]);
  const refresh = useCallback(async () => {
    if (!symbol) return;
    // rimuove dalla cache solo le risposte di questo titolo (non l'elenco SEC dei ticker)
    const enc = encodeURIComponent(symbol).toLowerCase();
    await db.research_cache.filter((r) => r.key.toLowerCase().includes(`symbol=${enc}`) || r.key.toLowerCase().includes(`s=${enc}`)).delete();
    setNonce((n) => n + 1);
  }, [symbol]);
  return { ...state, refresh };
}
