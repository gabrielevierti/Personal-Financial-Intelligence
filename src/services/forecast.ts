/**
 * Previsioni di liquidità, deterministiche.
 *
 * Tre livelli di affidabilità, sempre separati:
 *  - certo:       quello che è già successo (saldo attuale, movimenti contabilizzati del mese);
 *  - programmato: movimenti pianificati dall'utente con importo fisso (stipendio, affitto, rate);
 *  - stimato:     pianificati con importo variabile, ricorrenti rilevati ma non pianificati,
 *                 spesa variabile media o budget residuo.
 */
import type { Cents, ISODate, ISOMonth, ScheduledFrequency, ScheduledItem } from '../types';
import { addDays, addMonths, daysBetween, monthEnd, monthOf, todayISO } from '../utils/date';
import type { Recurring } from './ai/insights';
import type { Converter } from './finance';

const STEP: Record<ScheduledFrequency, number> = { once: 0, monthly: 1, quarterly: 3, yearly: 12 };

/** Stessa data spostata di n mesi; il giorno viene limitato alla fine del mese (31 gen → 28/29 feb). */
export function shiftMonths(date: ISODate, n: number): ISODate {
  const m = addMonths(monthOf(date), n);
  const day = Math.min(Number(date.slice(8, 10)), Number(monthEnd(m).slice(8, 10)));
  return `${m}-${String(day).padStart(2, '0')}`;
}

/** Date delle scadenze di un movimento pianificato comprese in [from, to]. */
export function occurrences(item: Pick<ScheduledItem, 'frequency' | 'nextDate' | 'endDate'>, from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  const step = STEP[item.frequency];
  if (step === 0) {
    if (item.nextDate >= from && item.nextDate <= to) out.push(item.nextDate);
    return out;
  }
  let i = 0;
  let d = item.nextDate;
  while (d <= to && i < 600) {
    if (d >= from && (!item.endDate || d <= item.endDate)) out.push(d);
    i++;
    d = shiftMonths(item.nextDate, step * i);
  }
  return out;
}

export interface ForecastLine {
  name: string;
  date: ISODate;
  amount: Cents;
  level: 'scheduled' | 'estimated';
  source: 'pianificato' | 'ricorrente rilevato' | 'spesa variabile' | 'budget residuo';
}

export interface MonthEndForecast {
  month: ISOMonth;
  today: ISODate;
  daysLeft: number;
  /** Certo: liquidità oggi e movimenti già contabilizzati nel mese. */
  certain: { balance: Cents; incomeSoFar: Cents; expenseSoFar: Cents };
  scheduled: { income: Cents; expense: Cents };
  estimated: { income: Cents; expense: Cents; variableBasis: 'budget' | 'media' | 'nessuna' };
  lines: ForecastLine[];
  expectedIncome: Cents;
  expectedExpense: Cents;
  /** Saldo previsto a fine mese. */
  forecastBalance: Cents;
  /** Entrate previste meno uscite previste nel mese: quanto resta a fine mese. */
  margin: Cents;
}

export interface ForecastInput {
  today?: ISODate;
  liquidityNow: Cents;
  incomeSoFar: Cents;
  expenseSoFar: Cents;
  scheduled: ScheduledItem[];
  recurring: Recurring[];
  /** Spesa variabile media giornaliera (positiva). */
  dailyVariable: number;
  /** Budget totale del mese ancora disponibile, se esiste un budget totale. */
  remainingBudget: Cents | null;
  conv: Converter;
}

function uncoveredRecurring(recurring: Recurring[], scheduled: ScheduledItem[]): Recurring[] {
  const covered = new Set(scheduled.map((s) => s.merchant).filter(Boolean));
  return recurring.filter((r) => !covered.has(r.merchant));
}

function linesBetween(input: ForecastInput, from: ISODate, to: ISODate): ForecastLine[] {
  const lines: ForecastLine[] = [];
  for (const it of input.scheduled) {
    const amount = input.conv(it.amount, it.currency);
    for (const date of occurrences(it, from, to)) lines.push({ name: it.name, date, amount, level: it.fixedAmount ? 'scheduled' : 'estimated', source: 'pianificato' });
  }
  for (const r of uncoveredRecurring(input.recurring, input.scheduled)) {
    // ricorrenza mensile: la prossima attesa e poi ogni mese
    // un addebito atteso nel mese e non ancora arrivato si considera ancora dovuto
    let d = r.nextExpected < from && !r.chargedThisMonth && monthOf(r.nextExpected) === monthOf(from) ? from : r.nextExpected;
    let i = 0;
    while (d <= to && i < 24) {
      if (d >= from) lines.push({ name: r.description, date: d, amount: r.kind === 'income' ? r.amount : -r.amount, level: 'estimated', source: 'ricorrente rilevato' });
      i++;
      d = shiftMonths(r.nextExpected, i);
    }
  }
  return lines.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function monthEndForecast(input: ForecastInput): MonthEndForecast {
  const today = input.today ?? todayISO();
  const month = monthOf(today);
  const end = monthEnd(month);
  const daysLeft = Math.max(0, daysBetween(today, end));
  const lines = linesBetween(input, addDays(today, 1), end);

  let variable = 0;
  let basis: MonthEndForecast['estimated']['variableBasis'] = 'nessuna';
  if (input.remainingBudget !== null) {
    variable = Math.max(0, input.remainingBudget);
    basis = 'budget';
  } else if (input.dailyVariable > 0) {
    variable = Math.round(input.dailyVariable * daysLeft);
    basis = 'media';
  }
  if (variable > 0) lines.push({ name: basis === 'budget' ? 'Budget del mese ancora disponibile' : 'Spesa variabile al ritmo medio', date: end, amount: -variable, level: 'estimated', source: basis === 'budget' ? 'budget residuo' : 'spesa variabile' });

  const sum = (level: ForecastLine['level'], sign: 1 | -1) => lines.filter((l) => l.level === level && Math.sign(l.amount) === sign).reduce((s, l) => s + Math.abs(l.amount), 0);
  const scheduled = { income: sum('scheduled', 1), expense: sum('scheduled', -1) };
  const estimated = { income: sum('estimated', 1), expense: sum('estimated', -1), variableBasis: basis };
  const expectedIncome = input.incomeSoFar + scheduled.income + estimated.income;
  const expectedExpense = input.expenseSoFar + scheduled.expense + estimated.expense;
  return {
    month,
    today,
    daysLeft,
    certain: { balance: input.liquidityNow, incomeSoFar: input.incomeSoFar, expenseSoFar: input.expenseSoFar },
    scheduled,
    estimated,
    lines,
    expectedIncome,
    expectedExpense,
    forecastBalance: input.liquidityNow + scheduled.income - scheduled.expense + estimated.income - estimated.expense,
    margin: expectedIncome - expectedExpense,
  };
}

export interface Projection {
  months: number;
  date: ISODate;
  balance: Cents;
  scheduledNet: Cents;
  estimatedNet: Cents;
}

/**
 * Proiezione della liquidità a n mesi dalla fine del mese corrente: pianificati e ricorrenti
 * scadenza per scadenza, spesa variabile alla media mensile. Le entrate occasionali non pianificate
 * non sono incluse, quindi la stima è prudente.
 */
export function projectLiquidity(input: ForecastInput, horizons: number[] = [3, 6, 12]): Projection[] {
  const today = input.today ?? todayISO();
  const base = monthEndForecast(input);
  const start = addDays(monthEnd(monthOf(today)), 1);
  const monthlyVariable = Math.round(input.dailyVariable * 30.4);
  return horizons.map((n) => {
    const end = monthEnd(addMonths(monthOf(today), n));
    const lines = linesBetween(input, start, end);
    const scheduledNet = lines.filter((l) => l.level === 'scheduled').reduce((s, l) => s + l.amount, 0);
    const estimatedNet = lines.filter((l) => l.level === 'estimated').reduce((s, l) => s + l.amount, 0) - monthlyVariable * n;
    return { months: n, date: end, balance: base.forecastBalance + scheduledNet + estimatedNet, scheduledNet, estimatedNet };
  });
}

/** Scadenze nei prossimi giorni (pianificati con importo negativo o positivo). */
export function upcoming(items: ScheduledItem[], days = 30, today: ISODate = todayISO()): Array<{ item: ScheduledItem; date: ISODate }> {
  const to = addDays(today, days);
  return items
    .flatMap((item) => occurrences(item, today, to).map((date) => ({ item, date })))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}
