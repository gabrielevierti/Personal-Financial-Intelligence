import { useEffect, useState } from 'react';

export type RouteName =
  | 'dashboard'
  | 'accounts'
  | 'transactions'
  | 'import'
  | 'budgets'
  | 'goals'
  | 'investments'
  | 'reports'
  | 'settings'
  | 'banks'
  | 'assistant'
  | 'networth'
  | 'performance'
  | 'research'
  | 'watchlist'
  | 'compare'
  | 'market'
  | 'insights'
  | 'simulations'
  | 'backup';

export const ROUTES: RouteName[] = ['dashboard', 'accounts', 'transactions', 'import', 'banks', 'budgets', 'goals', 'networth', 'investments', 'performance', 'reports', 'research', 'watchlist', 'compare', 'market', 'insights', 'assistant', 'simulations', 'settings', 'backup'];

export interface Route {
  name: RouteName | 'notfound';
  params: URLSearchParams;
}

function parse(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = hash.split('?');
  const name = (path || 'dashboard') as RouteName;
  return { name: ROUTES.includes(name) ? name : 'notfound', params: new URLSearchParams(query) };
}

export function navigate(name: RouteName, params?: Record<string, string>): void {
  const q = params ? `?${new URLSearchParams(params).toString()}` : '';
  window.location.hash = `/${name}${q}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
