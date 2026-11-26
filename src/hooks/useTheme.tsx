import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

const KEY = 'pfi.theme';

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function resolveTheme(pref: ThemePref): Theme {
  if (pref !== 'system') return pref;
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Applica il tema prima del primo render, per evitare lampeggi. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0d1117' : '#ffffff');
}

export interface ChartColors {
  income: string;
  expense: string;
  accent: string;
  warning: string;
  grid: string;
  axis: string;
  muted: string;
  surface: string;
}

function readColors(): ChartColors {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
  return {
    income: v('--income', '#1a7f37'),
    expense: v('--expense', '#d1242f'),
    accent: v('--chart-1', '#0969da'),
    warning: v('--warning', '#9a6700'),
    grid: v('--chart-grid', '#d8dee4'),
    axis: v('--chart-axis', '#59636e'),
    muted: v('--faint', '#818b98'),
    surface: v('--bg', '#ffffff'),
  };
}

interface ThemeApi {
  pref: ThemePref;
  theme: Theme;
  setPref: (p: ThemePref) => void;
  colors: ChartColors;
}

const Ctx = createContext<ThemeApi | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(readThemePref);
  const [systemDark, setSystemDark] = useState(() => resolveTheme('system') === 'dark');
  const theme: Theme = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
  const [colors, setColors] = useState<ChartColors>(() => readColors());

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    applyTheme(theme);
    setColors(readColors());
  }, [theme]);

  const api = useMemo<ThemeApi>(
    () => ({
      pref,
      theme,
      colors,
      setPref: (p) => {
        setPrefState(p);
        try {
          if (p === 'system') localStorage.removeItem(KEY);
          else localStorage.setItem(KEY, p);
        } catch {
          /* ignora */
        }
      },
    }),
    [pref, theme, colors],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTheme fuori da ThemeProvider');
  return c;
}

/** Colori dei grafici per il tema corrente (fuori dal provider: valori del tema chiaro). */
export function useChartColors(): ChartColors {
  const c = useContext(Ctx);
  return c?.colors ?? { income: '#1a7f37', expense: '#d1242f', accent: '#0969da', warning: '#9a6700', grid: '#d8dee4', axis: '#59636e', muted: '#818b98', surface: '#ffffff' };
}
