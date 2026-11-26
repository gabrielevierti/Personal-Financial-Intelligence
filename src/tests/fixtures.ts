import type { Account, AppSettings, Asset, Transaction } from '../types';

export const settings: AppSettings = { baseCurrency: 'EUR', exchangeRates: { USD: 0.9 } };

export function account(p: Partial<Account> = {}): Account {
  return { id: 'a1', name: 'Conto', institution: 'Banca', type: 'checking', currency: 'EUR', initialBalance: 0, createdAt: '2024-01-01', archived: false, ...p };
}

let n = 0;
export function tx(p: Partial<Transaction> = {}): Transaction {
  n++;
  return {
    id: `t${n}`,
    accountId: 'a1',
    date: '2024-01-10',
    description: 'test',
    amount: -1000,
    type: 'expense',
    categoryId: 'exp-groceries',
    currency: 'EUR',
    fingerprint: '',
    createdAt: `2024-01-01T00:00:${String(n).padStart(2, '0')}Z`,
    updatedAt: '',
    ...p,
  };
}

export function asset(p: Partial<Asset> = {}): Asset {
  return { id: 'as1', name: 'ETF', type: 'etf', quantity: 10, purchasePrice: 10000, currentPrice: 12000, currency: 'EUR', updatedAt: '2024-01-01', ...p };
}
