import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ISODate, Period } from '../types';
import { resolvePeriod, type PeriodPreset } from '../utils/date';

/** Preferenze NON sensibili, salvate in localStorage. */
interface Prefs {
  periodPreset: PeriodPreset;
  customStart?: ISODate;
  customEnd?: ISODate;
  pageSize: number;
}

const KEY = 'pfi.prefs';
const DEFAULTS: Prefs = { periodPreset: 'this_month', pageSize: 25 };

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

interface PrefsApi {
  prefs: Prefs;
  period: Period;
  setPrefs: (p: Partial<Prefs>) => void;
}

const Ctx = createContext<PrefsApi | null>(null);

export function PrefsProvider({ children, earliest }: { children: ReactNode; earliest?: ISODate }) {
  const [prefs, setState] = useState<Prefs>(load);
  const setPrefs = useCallback((p: Partial<Prefs>) => {
    setState((cur) => {
      const next = { ...cur, ...p };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignora */
      }
      return next;
    });
  }, []);
  const period = useMemo(
    () =>
      resolvePeriod(
        prefs.periodPreset,
        undefined,
        prefs.customStart && prefs.customEnd ? { start: prefs.customStart, end: prefs.customEnd } : undefined,
        earliest,
      ),
    [prefs.periodPreset, prefs.customStart, prefs.customEnd, earliest],
  );
  return <Ctx.Provider value={{ prefs, period, setPrefs }}>{children}</Ctx.Provider>;
}

export function usePrefs(): PrefsApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('usePrefs fuori da PrefsProvider');
  return c;
}
