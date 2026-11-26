import { useEffect } from 'react';
import { useRoute } from './hooks/useRoute';
import { PrefsProvider } from './hooks/usePrefs';
import { ToastProvider } from './hooks/useToast';
import { useEarliestDate } from './hooks/useData';
import { AppLayout } from './layouts/AppLayout';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { AccountsPage } from './features/accounts/AccountsPage';
import { TransactionsPage } from './features/transactions/TransactionsPage';
import { ImportPage } from './features/import/ImportPage';
import { BudgetsPage } from './features/budgets/BudgetsPage';
import { GoalsPage } from './features/savings/GoalsPage';
import { InvestmentsPage } from './features/investments/InvestmentsPage';
import { ReportsPage } from './features/reports/ReportsPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { BanksPage } from './features/banks/BanksPage';
import { AssistantPage } from './features/assistant/AssistantPage';
import { NetWorthPage } from './features/wealth/NetWorthPage';
import { PerformancePage } from './features/wealth/PerformancePage';
import { InsightsPage } from './features/intelligence/InsightsPage';
import { SimulationsPage } from './features/intelligence/SimulationsPage';
import { ResearchPage } from './features/research/ResearchPage';
import { WatchlistPage } from './features/research/WatchlistPage';
import { ComparePage } from './features/research/ComparePage';
import { MarketPage } from './features/research/MarketPage';
import { AiProvider } from './components/ai/AiProvider';
import { useBankAutoSync } from './hooks/useBankAutoSync';
import { ThemeProvider } from './hooks/useTheme';
import { NotFound } from './pages/NotFound';
import { ErrorBoundary } from './pages/ErrorBoundary';

const PAGES = {
  dashboard: DashboardPage,
  accounts: AccountsPage,
  transactions: TransactionsPage,
  import: ImportPage,
  budgets: BudgetsPage,
  goals: GoalsPage,
  investments: InvestmentsPage,
  reports: ReportsPage,
  settings: SettingsPage,
  banks: BanksPage,
  assistant: AssistantPage,
  networth: NetWorthPage,
  performance: PerformancePage,
  research: ResearchPage,
  watchlist: WatchlistPage,
  compare: ComparePage,
  market: MarketPage,
  insights: InsightsPage,
  simulations: SimulationsPage,
  backup: BackupPage,
  notfound: NotFound,
} as const;

export function App() {
  const route = useRoute();
  const earliest = useEarliestDate();
  const Page = PAGES[route.name];
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.name]);
  return (
    <ThemeProvider>
    <ToastProvider>
      <PrefsProvider earliest={earliest}>
        <BankAutoSync />
        <AiProvider route={route.name}>
          <AppLayout route={route.name}>
            <ErrorBoundary resetKey={route.name}>
              <Page />
            </ErrorBoundary>
          </AppLayout>
        </AiProvider>
      </PrefsProvider>
    </ToastProvider>
    </ThemeProvider>
  );
}

function BackupPage() {
  return <SettingsPage mode="backup" />;
}

function BankAutoSync() {
  useBankAutoSync();
  return null;
}
