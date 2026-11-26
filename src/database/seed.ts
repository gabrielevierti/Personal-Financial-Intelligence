import type { Category } from '../types';

type Seed = Omit<Category, 'id' | 'isDefault'> & { id: string };

/** Categorie predefinite con ID stabili (necessari per backup e test deterministici). */
export const DEFAULT_CATEGORIES: Seed[] = [
  { id: 'inc-salary', name: 'Stipendio', kind: 'income', color: '#1a7f37', icon: 'briefcase' },
  { id: 'inc-freelance', name: 'Freelance', kind: 'income', color: '#2da44e', icon: 'laptop' },
  { id: 'inc-rent', name: 'Rendite', kind: 'income', color: '#1b7c83', icon: 'building' },
  { id: 'inc-interest', name: 'Interessi', kind: 'income', color: '#0969da', icon: 'percent' },
  { id: 'inc-refund', name: 'Rimborsi', kind: 'income', color: '#54aeff', icon: 'rotate-ccw' },
  { id: 'inc-other', name: 'Altre entrate', kind: 'income', color: '#6e7781', icon: 'plus-circle' },
  { id: 'exp-home', name: 'Casa', kind: 'expense', color: '#cf222e', icon: 'home' },
  { id: 'exp-groceries', name: 'Alimentari', kind: 'expense', color: '#bc4c00', icon: 'shopping-basket' },
  { id: 'exp-transport', name: 'Trasporti', kind: 'expense', color: '#d4a72c', icon: 'car' },
  { id: 'exp-bills', name: 'Bollette', kind: 'expense', color: '#9a6700', icon: 'zap' },
  { id: 'exp-health', name: 'Salute', kind: 'expense', color: '#bf3989', icon: 'heart-pulse' },
  { id: 'exp-shopping', name: 'Shopping', kind: 'expense', color: '#8250df', icon: 'shopping-bag' },
  { id: 'exp-restaurants', name: 'Ristoranti', kind: 'expense', color: '#fb8f44', icon: 'utensils' },
  { id: 'exp-subscriptions', name: 'Abbonamenti', kind: 'expense', color: '#0969da', icon: 'repeat' },
  { id: 'exp-travel', name: 'Viaggi', kind: 'expense', color: '#1b7c83', icon: 'plane' },
  { id: 'exp-entertainment', name: 'Intrattenimento', kind: 'expense', color: '#a475f9', icon: 'film' },
  { id: 'exp-insurance', name: 'Assicurazioni', kind: 'expense', color: '#57606a', icon: 'shield' },
  { id: 'exp-taxes', name: 'Tasse', kind: 'expense', color: '#a40e26', icon: 'landmark' },
  { id: 'inv-buy', name: 'Acquisto investimenti', kind: 'expense', color: '#0550ae', icon: 'trending-up' },
  { id: 'inv-sell', name: 'Vendita investimenti', kind: 'income', color: '#0550ae', icon: 'trending-down' },
  { id: 'exp-other', name: 'Altre spese', kind: 'expense', color: '#8c959f', icon: 'more-horizontal' },
];

export const FALLBACK_CATEGORY = { income: 'inc-other', expense: 'exp-other' } as const;

export function defaultCategories(): Category[] {
  return DEFAULT_CATEGORIES.map((c) => ({ ...c, isDefault: true }));
}

/** Colori delle categorie predefinite nella prima versione (per la migrazione al nuovo tema). */
export const LEGACY_CATEGORY_COLORS: Record<string, string> = {'inc-salary': '#6fcf97', 'inc-freelance': '#56b98a', 'inc-rent': '#4aa37a', 'inc-interest': '#8fd9b0', 'inc-refund': '#a8e3c2', 'inc-other': '#b9c9bf', 'exp-home': '#e07a6f', 'exp-groceries': '#e8a45c', 'exp-transport': '#d4b85a', 'exp-bills': '#c98d6b', 'exp-health': '#d46f8c', 'exp-shopping': '#b47fd1', 'exp-restaurants': '#e39373', 'exp-subscriptions': '#8f9ce0', 'exp-travel': '#6fb3d9', 'exp-entertainment': '#d98fb8', 'exp-insurance': '#9fb0a6', 'exp-taxes': '#c76b6b', 'exp-other': '#8a968f'};
