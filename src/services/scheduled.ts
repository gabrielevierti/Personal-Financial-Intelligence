import { db } from '../database/db';
import type { ScheduledItem } from '../types';
import { isValidISODate } from '../utils/date';
import { uid } from '../utils/id';

export const SCHEDULED_KIND_LABELS: Record<ScheduledItem['kind'], string> = {
  income: 'Entrata (stipendio, rendita)',
  rent: 'Affitto o mutuo',
  bill: 'Bolletta',
  insurance: 'Assicurazione',
  subscription: 'Abbonamento',
  debt: 'Rata di un debito',
  investment: 'Piano di investimento',
  other: 'Altro',
};

export const FREQUENCY_LABELS: Record<ScheduledItem['frequency'], string> = { once: 'Una volta', monthly: 'Ogni mese', quarterly: 'Ogni 3 mesi', yearly: 'Ogni anno' };

export function validateScheduled(i: Omit<ScheduledItem, 'id'>): string[] {
  const e: string[] = [];
  if (!i.name.trim()) e.push('Inserisci un nome.');
  if (!Number.isInteger(i.amount) || i.amount === 0) e.push("Inserisci un importo diverso da zero.");
  if (!isValidISODate(i.nextDate)) e.push('Data della prossima scadenza non valida.');
  if (i.endDate && (!isValidISODate(i.endDate) || i.endDate < i.nextDate)) e.push('La data di fine deve seguire la prossima scadenza.');
  if (i.kind === 'income' && i.amount < 0) e.push('Un’entrata deve avere importo positivo.');
  if (i.kind !== 'income' && i.kind !== 'other' && i.amount > 0) e.push('Questa voce è un’uscita: l’importo deve essere negativo.');
  return e;
}

export async function saveScheduled(input: Omit<ScheduledItem, 'id'> & { id?: string }): Promise<string> {
  const errors = validateScheduled(input);
  if (errors.length) throw new Error(errors.join(' '));
  const id = input.id ?? uid();
  await db.scheduled_items.put({ ...input, name: input.name.trim(), id });
  return id;
}

export async function deleteScheduled(id: string): Promise<void> {
  await db.scheduled_items.delete(id);
}
