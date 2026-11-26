import { useEffect, useState, type ReactNode } from 'react';
import {
  Monitor,
  Moon,
  Sun,
  Sparkles,
  ArrowLeftRight, BarChart3, CalendarRange, Landmark, LayoutDashboard, Lock, Menu, PiggyBank, Settings, Target, TrendingUp, WifiOff,
  Building2, Star, Wallet,
} from 'lucide-react';
import { AiHeaderButton, AiPanel } from '../components/ai/AiPanel';
import { useAi } from '../components/ai/AiProvider';
import { Notifications } from './Notifications';
import { navigate, type RouteName } from '../hooks/useRoute';
import { usePrefs } from '../hooks/usePrefs';
import { useOnline } from '../hooks/useOnline';
import { PERIOD_LABELS, type PeriodPreset } from '../utils/date';
import { Modal } from '../components/ui/Modal';
import { useTheme, type ThemePref } from '../hooks/useTheme';

type NavGroup = { id: string; group: string; items: Array<{ name: RouteName; label: string; icon: typeof Menu }> };

export const NAV: NavGroup[] = [
  {
    id: 'personal',
    group: '',
    items: [
      { name: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { name: 'transactions', label: 'Movimenti', icon: ArrowLeftRight },
      { name: 'accounts', label: 'Conti', icon: Landmark },
      { name: 'budgets', label: 'Budget', icon: PiggyBank },
      { name: 'goals', label: 'Obiettivi', icon: Target },
    ],
  },
  {
    id: 'wealth',
    group: 'Patrimonio',
    items: [
      { name: 'networth', label: 'Patrimonio', icon: Wallet },
      { name: 'investments', label: 'Investimenti', icon: TrendingUp },
      { name: 'reports', label: 'Report', icon: BarChart3 },
    ],
  },
  {
    id: 'research',
    group: 'Mercati',
    items: [
      { name: 'research', label: 'Aziende', icon: Building2 },
      { name: 'watchlist', label: 'Watchlist', icon: Star },
    ],
  },
  {
    id: 'system',
    group: 'Altro',
    items: [
      { name: 'assistant', label: 'Assistente AI', icon: Sparkles },
      { name: 'settings', label: 'Impostazioni', icon: Settings },
    ],
  },
];

/** Pagine secondarie: raggiungibili dalle pagine principali, mostrate nel percorso sotto la loro sezione. */
const PARENT: Partial<Record<RouteName, RouteName>> = { import: 'accounts', banks: 'accounts', performance: 'investments', compare: 'research', market: 'research', insights: 'dashboard', simulations: 'investments', backup: 'settings' };

export const TITLES: Record<RouteName, string> = {
  dashboard: 'Dashboard',
  accounts: 'Conti',
  transactions: 'Movimenti',
  import: 'Importa estratto conto',
  budgets: 'Budget e pianificati',
  goals: 'Obiettivi di risparmio',
  networth: 'Patrimonio',
  investments: 'Investimenti e beni',
  performance: 'Performance',
  reports: 'Report e analisi',
  research: 'Aziende',
  watchlist: 'Watchlist',
  compare: 'Confronto aziende',
  market: 'Market Overview',
  insights: 'Financial Insights',
  assistant: 'Assistente AI',
  simulations: 'Analisi e simulazioni',
  settings: 'Impostazioni',
  backup: 'Backup e ripristino',
  banks: 'Collegamenti bancari',
};

function parentOf(route: RouteName | 'notfound'): RouteName | undefined {
  return route === 'notfound' ? undefined : PARENT[route];
}

/** Pagine in cui il selettore di periodo ha effetto. */
const PERIOD_PAGES: RouteName[] = ['dashboard', 'transactions', 'insights'];

const PRESETS: PeriodPreset[] = ['this_month', 'last_month', 'last_3_months', 'this_quarter', 'this_year', 'last_12_months', 'last_year', 'all', 'custom'];

function PeriodSelector() {
  const { prefs, setPrefs, period } = usePrefs();
  const [custom, setCustom] = useState(false);
  const [start, setStart] = useState(prefs.customStart ?? period.start);
  const [end, setEnd] = useState(prefs.customEnd ?? period.end);
  return (
    <>
      <div className="row" style={{ gap: 8 }}>
        <CalendarRange size={16} className="muted hide-mobile" aria-hidden="true" />
        <label className="sr-only" htmlFor="period">
          Periodo
        </label>
        <select
          id="period"
          className="select"
          style={{ width: 'auto', minWidth: 150 }}
          value={prefs.periodPreset}
          onChange={(e) => {
            const v = e.target.value as PeriodPreset;
            if (v === 'custom') setCustom(true);
            else setPrefs({ periodPreset: v });
          }}
        >
          {PRESETS.map((p) => (
            <option key={p} value={p}>
              {p === 'custom' && prefs.periodPreset === 'custom' ? period.label : PERIOD_LABELS[p]}
            </option>
          ))}
        </select>
      </div>
      {custom && (
        <Modal
          title="Periodo personalizzato"
          onClose={() => setCustom(false)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setCustom(false)}>
                Annulla
              </button>
              <button
                className="btn btn-primary"
                disabled={!start || !end || start > end}
                onClick={() => {
                  setPrefs({ periodPreset: 'custom', customStart: start, customEnd: end });
                  setCustom(false);
                }}
              >
                Applica periodo
              </button>
            </>
          }
        >
          <div className="form-row">
            <div className="field">
              <label htmlFor="ps">Dal</label>
              <input id="ps" type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="pe">Al</label>
              <input id="pe" type="date" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          {start > end && <p className="small" style={{ color: 'var(--danger)', marginTop: 10 }}>La data di inizio deve precedere quella di fine.</p>}
        </Modal>
      )}
    </>
  );
}

const THEME_LABEL: Record<ThemePref, string> = { system: 'Tema: come il sistema', light: 'Tema chiaro', dark: 'Tema scuro' };

function ThemeToggle() {
  const { pref, setPref } = useTheme();
  const next: ThemePref = pref === 'system' ? 'light' : pref === 'light' ? 'dark' : 'system';
  const Icon = pref === 'system' ? Monitor : pref === 'light' ? Sun : Moon;
  return (
    <button className="btn icon-btn" onClick={() => setPref(next)} aria-label={`${THEME_LABEL[pref]}. Passa a: ${THEME_LABEL[next].toLowerCase()}`} title={THEME_LABEL[pref]} data-testid="theme-toggle">
      <Icon size={16} />
    </button>
  );
}

export function AppLayout({ route, children }: { route: RouteName | 'notfound'; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ai = useAi();
  const online = useOnline();
  useEffect(() => {
    setOpen(false);
  }, [route]);
  const title = route === 'notfound' ? 'Pagina non trovata' : TITLES[route];
  useEffect(() => {
    document.title = `${title} · PFI`;
  }, [title]);

  return (
    <div className="app">
      <a href="#main" className="sr-only">
        Vai al contenuto
      </a>
      {open && <div className="sidebar-scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
      <nav className={`sidebar${open ? ' is-open' : ''}`} aria-label="Navigazione principale">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">PFI</span>
          <span className="brand-name">Personal Finance Intelligence</span>
        </div>
        {NAV.map((g) => (
          <div key={g.id} className="nav-section">
            {g.group && <div className="nav-group">{g.group}</div>}
            {g.items.map((it) => (
              <a key={it.name} href={`#/${it.name}`} className="nav-link" aria-current={route === it.name || parentOf(route) === it.name ? 'page' : undefined} onClick={() => setOpen(false)}>
                <it.icon size={17} aria-hidden="true" />
                {it.label}
              </a>
            ))}
          </div>
        ))}
        <div className="sidebar-foot">
          <Lock size={13} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
          <span>Dati salvati solo su questo dispositivo. In rete va solo la sincronizzazione bancaria, se la attivi.</span>
        </div>
      </nav>
      <div className="main">
        <header className="header">
          <button className="btn btn-ghost icon-btn menu-btn" aria-label="Apri menu" onClick={() => setOpen(true)}>
            <Menu size={20} />
          </button>
          <nav className="header-title" aria-label="Percorso">
            <span className="crumb">PFI / </span>
            {parentOf(route) && <a className="crumb" href={`#/${parentOf(route)}`}>{TITLES[parentOf(route)!]} / </a>}
            <span aria-current="page">{title}</span>
          </nav>
          {!online && (
            <span className="offline-pill" title="Sei offline: l'app continua a funzionare">
              <WifiOff size={14} /> <span className="hide-mobile">Offline</span>
            </span>
          )}
          {route !== 'notfound' && PERIOD_PAGES.includes(route) && <PeriodSelector />}
          <Notifications />
          <AiHeaderButton />
          <ThemeToggle />
        </header>
        <div className={`workspace${ai.open ? ' with-ai' : ''}`}>
          <main id="main" className="content">
            {children}
          </main>
          <AiPanel />
        </div>
      </div>
    </div>
  );
}

export { navigate };
