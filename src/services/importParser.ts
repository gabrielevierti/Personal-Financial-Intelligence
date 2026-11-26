/**
 * Parser puro degli estratti conto: riconoscimento colonne, normalizzazione,
 * validazione e rilevamento dei duplicati. Nessun accesso al DOM o al database.
 */
import type { Category, Cents, ISODate } from '../types';
import { FALLBACK_CATEGORY } from '../database/seed';
import { detectDateFormat, parseDate, type DateFormat } from '../utils/date';
import { parseAmount, type DecimalSeparator } from '../utils/money';
import { sha256 } from '../utils/sha256';
import { normalizeText } from '../utils/text';

export type RawCell = string | number | boolean | Date | null | undefined;
export type RawRow = RawCell[];

export type MappableField = 'date' | 'description' | 'amount' | 'credit' | 'debit' | 'category' | 'currency';

export type ColumnMapping = Record<MappableField, number>;

export const FIELD_LABELS: Record<MappableField, string> = {
  date: 'Data',
  description: 'Descrizione',
  amount: 'Importo (con segno)',
  credit: 'Entrate / Avere',
  debit: 'Uscite / Dare',
  category: 'Categoria',
  currency: 'Valuta',
};

const SYNONYMS: Record<MappableField, string[]> = {
  date: ['data', 'data operazione', 'data contabile', 'data registrazione', 'date', 'booking date', 'transaction date', 'data movimento', 'giorno'],
  description: ['descrizione', 'causale', 'descrizione operazione', 'description', 'dettagli', 'details', 'memo', 'beneficiario', 'operazione', 'narrative', 'payee', 'descrizione estesa'],
  amount: ['importo', 'amount', 'importo eur', 'importo euro', 'valore', 'totale', 'importo operazione', 'saldo movimento'],
  credit: ['entrate', 'avere', 'accrediti', 'accredito', 'credit', 'credito', 'in', 'money in', 'entrata'],
  debit: ['uscite', 'dare', 'addebiti', 'addebito', 'debit', 'debito', 'out', 'money out', 'uscita'],
  category: ['categoria', 'category', 'tipologia', 'tipo spesa'],
  currency: ['valuta', 'divisa', 'currency', 'moneta'],
};

/** "Data valuta" in molti estratti italiani è la data di valuta, non la divisa: va trattata come data secondaria. */
const DATE_SECONDARY = ['data valuta', 'value date', 'valuta data'];

export function emptyMapping(): ColumnMapping {
  return { date: -1, description: -1, amount: -1, credit: -1, debit: -1, category: -1, currency: -1 };
}

function cellText(c: RawCell): string {
  if (c === null || c === undefined) return '';
  if (c instanceof Date) return c.toISOString();
  return String(c).trim();
}

export function isEmptyRow(row: RawRow | undefined): boolean {
  return !row || row.every((c) => cellText(c) === '');
}

function matchScore(header: string, field: MappableField): number {
  const h = normalizeText(header);
  if (!h) return 0;
  if (field === 'currency' && DATE_SECONDARY.includes(h)) return 0;
  if (field === 'date' && DATE_SECONDARY.includes(h)) return 1;
  let best = 0;
  for (const syn of SYNONYMS[field]) {
    if (h === syn) best = Math.max(best, 3);
    else if (syn.length > 3 && (h.startsWith(`${syn} `) || h.endsWith(` ${syn}`) || h.includes(` ${syn} `))) best = Math.max(best, 2);
  }
  return best;
}

/** Numero di campi distinti riconosciuti in una riga candidata a intestazione. */
export function headerFieldCount(row: RawRow): number {
  const fields = new Set<MappableField>();
  for (const cell of row) {
    const text = cellText(cell);
    if (text.length > 40) continue;
    for (const f of Object.keys(SYNONYMS) as MappableField[]) if (matchScore(text, f) > 1) fields.add(f);
  }
  return fields.size;
}

/** Righe di riepilogo presenti negli estratti (saldi, totali) che non sono movimenti. */
const SUMMARY_ROW = /^(saldo (iniziale|finale|contabile|disponibile|liquido|precedente|al|a)|totale (entrate|uscite|movimenti|dare|avere)|totali|riporto|a riportare)\b/i;

export function isSummaryDescription(description: string): boolean {
  return SUMMARY_ROW.test(normalizeText(description));
}

/** Individua la riga di intestazione (gestisce righe di preambolo tipiche degli estratti bancari). */
export function detectHeaderRow(rows: RawRow[], maxScan = 30): number {
  let bestRow = -1;
  let bestScore = 0;
  const limit = Math.min(rows.length, maxScan);
  for (let i = 0; i < limit; i++) {
    const row = rows[i];
    if (isEmptyRow(row)) continue;
    let score = 0;
    const fields = new Set<MappableField>();
    for (const cell of row) {
      const text = cellText(cell);
      for (const f of Object.keys(SYNONYMS) as MappableField[]) {
        const s = matchScore(text, f);
        if (s > 0 && !fields.has(f)) {
          fields.add(f);
          score += s;
        }
      }
    }
    if (fields.size >= 2 && score > bestScore) {
      bestScore = score;
      bestRow = i;
    }
  }
  if (bestRow >= 0) return bestRow;
  // nessuna intestazione riconosciuta: prima riga non vuota
  return Math.max(0, rows.findIndex((r) => !isEmptyRow(r)));
}

/** Associa automaticamente le colonne in base alle intestazioni e al contenuto. */
export function guessMapping(headers: RawRow, samples: RawRow[] = []): ColumnMapping {
  const sampleRows = samples.filter((r) => !isEmptyRow(r));
  const mapping = emptyMapping();
  const used = new Set<number>();
  const fields: MappableField[] = ['date', 'amount', 'credit', 'debit', 'description', 'category', 'currency'];
  for (const field of fields) {
    let bestIdx = -1;
    let bestScore = 0;
    headers.forEach((h, idx) => {
      if (used.has(idx)) return;
      const s = matchScore(cellText(h), field);
      if (s > bestScore) {
        bestScore = s;
        bestIdx = idx;
      }
    });
    if (bestIdx >= 0) {
      mapping[field] = bestIdx;
      used.add(bestIdx);
    }
  }
  // Più colonne descrizione (es. "Descrizione" e "Descrizione completa"): sceglie quella con testi più ricchi
  if (sampleRows.length > 0) {
    const candidates = headers.map((h, i) => ({ i, s: matchScore(cellText(h), 'description') })).filter((c) => c.s > 0 && (c.i === mapping.description || !Object.values(mapping).includes(c.i)));
    if (candidates.length > 1) {
      const avg = (i: number) => sampleRows.reduce((sum, r) => sum + cellText(r[i]).length, 0) / sampleRows.length;
      mapping.description = candidates.sort((a, b) => avg(b.i) - avg(a.i))[0].i;
    }
  }

  // Se esiste un importo unico, ignora le colonne dare/avere solo se non entrambe presenti
  if (mapping.amount >= 0 && mapping.credit >= 0 && mapping.debit >= 0) mapping.amount = -1;

  // Fallback basato sul contenuto per intestazioni non standard
  if (sampleRows.length > 0) {
    const cols = headers.length || Math.max(...sampleRows.map((r) => r.length));
    const isFree = (i: number) => !Object.values(mapping).includes(i);
    if (mapping.date < 0) {
      for (let i = 0; i < cols; i++) {
        if (!isFree(i)) continue;
        const ok = sampleRows.filter((r) => parseDate(r[i]) !== null).length;
        if (ok >= Math.ceil(sampleRows.length * 0.8)) {
          mapping.date = i;
          break;
        }
      }
    }
    if (mapping.amount < 0 && (mapping.credit < 0 || mapping.debit < 0)) {
      for (let i = 0; i < cols; i++) {
        if (!isFree(i)) continue;
        const ok = sampleRows.filter((r) => {
          const t = cellText(r[i]);
          return /\d/.test(t) && parseAmount(r[i]) !== null && parseDate(r[i]) === null;
        }).length;
        if (ok >= Math.ceil(sampleRows.length * 0.8)) {
          mapping.amount = i;
          break;
        }
      }
    }
    if (mapping.description < 0) {
      let bestLen = 0;
      for (let i = 0; i < cols; i++) {
        if (!isFree(i)) continue;
        const avg = sampleRows.reduce((s, r) => s + (parseAmount(r[i]) === null ? cellText(r[i]).length : 0), 0) / sampleRows.length;
        if (avg > bestLen) {
          bestLen = avg;
          mapping.description = i;
        }
      }
    }
  }
  return mapping;
}

export interface ParseOptions {
  dateFormat: DateFormat;
  decimal: DecimalSeparator;
  /** Inverte il segno (es. estratti carte di credito dove le spese sono positive). */
  invertSign: boolean;
  accountId: string;
  accountCurrency: string;
}

export type DuplicateKind = 'none' | 'existing' | 'file';

export interface PreviewRow {
  /** Indice della riga nel file (0-based) */
  rowIndex: number;
  date: ISODate | null;
  description: string;
  amount: Cents | null;
  type: 'income' | 'expense' | null;
  categoryId: string | null;
  currency: string;
  errors: string[];
  duplicate: DuplicateKind;
  fingerprint: string;
  selected: boolean;
  /** Testo di tutte le celle della riga (per riconoscere le righe di saldo). */
  rawText: string;
}

export interface ParseContext {
  categories: Category[];
  /** Conteggio delle impronte già presenti nel database per il conto. */
  existingFingerprints: Map<string, number>;
  /** Categoria appresa da movimenti precedenti con la stessa descrizione normalizzata. */
  learnedCategories?: Map<string, string>;
  /** Categorizzatore automatico (regole, storico, esercenti noti). */
  categorize?: (description: string, kind: 'income' | 'expense') => string;
}

export function fingerprint(accountId: string, date: ISODate, amount: Cents, description: string): string {
  return sha256(`${accountId}|${date}|${amount}|${normalizeText(description)}`).slice(0, 24);
}

export function validateMapping(m: ColumnMapping): string[] {
  const errors: string[] = [];
  if (m.date < 0) errors.push('Seleziona la colonna della data.');
  if (m.amount < 0 && m.credit < 0 && m.debit < 0) errors.push("Seleziona la colonna dell'importo oppure le colonne entrate/uscite.");
  if (m.description < 0) errors.push('Seleziona la colonna della descrizione.');
  return errors;
}

function resolveCategory(
  raw: string,
  type: 'income' | 'expense',
  description: string,
  ctx: ParseContext,
): string {
  const name = normalizeText(raw);
  if (name) {
    const match = ctx.categories.find((c) => c.kind === type && normalizeText(c.name) === name);
    if (match) return match.id;
  }
  if (ctx.categorize) return ctx.categorize(description, type);
  const learned = ctx.learnedCategories?.get(normalizeText(description));
  if (learned) {
    const c = ctx.categories.find((x) => x.id === learned);
    if (c && c.kind === type) return c.id;
  }
  return FALLBACK_CATEGORY[type];
}

export function buildPreview(
  rows: RawRow[],
  headerRow: number,
  mapping: ColumnMapping,
  opts: ParseOptions,
  ctx: ParseContext,
): PreviewRow[] {
  const dataRows = rows.slice(headerRow + 1);
  const dateFormat =
    opts.dateFormat === 'auto' && mapping.date >= 0 ? detectDateFormat(dataRows.slice(0, 200).map((r) => r[mapping.date])) : opts.dateFormat;

  const remainingExisting = new Map(ctx.existingFingerprints);
  const seenInFile = new Set<string>();
  const out: PreviewRow[] = [];

  dataRows.forEach((row, i) => {
    if (isEmptyRow(row)) return; // righe vuote ignorate
    const rowIndex = headerRow + 1 + i;
    const errors: string[] = [];

    const date = mapping.date >= 0 ? parseDate(row[mapping.date], dateFormat) : null;
    if (!date) errors.push('Data non valida');

    const description = mapping.description >= 0 ? cellText(row[mapping.description]).replace(/\s+/g, ' ') : '';
    if (!description) errors.push('Descrizione mancante');
    else if (isSummaryDescription(description)) errors.push('Riga di saldo o totale, non un movimento');

    let amount: Cents | null = null;
    if (mapping.amount >= 0) {
      amount = parseAmount(row[mapping.amount], opts.decimal);
    } else {
      const credit = mapping.credit >= 0 ? parseAmount(row[mapping.credit], opts.decimal) : null;
      const debit = mapping.debit >= 0 ? parseAmount(row[mapping.debit], opts.decimal) : null;
      if (credit !== null || debit !== null) amount = Math.abs(credit ?? 0) - Math.abs(debit ?? 0);
    }
    if (amount === null) errors.push('Importo non valido');
    else if (amount === 0) errors.push('Importo pari a zero');
    if (amount !== null && opts.invertSign) amount = -amount;

    const type: 'income' | 'expense' | null = amount === null || amount === 0 ? null : amount > 0 ? 'income' : 'expense';

    let currency = opts.accountCurrency;
    if (mapping.currency >= 0) {
      const c = cellText(row[mapping.currency]).toUpperCase();
      if (/^[A-Z]{3}$/.test(c)) currency = c;
      else if (c === '€') currency = 'EUR';
    }
    if (currency !== opts.accountCurrency) errors.push(`Valuta ${currency} diversa da quella del conto (${opts.accountCurrency})`);

    const categoryId = type ? resolveCategory(mapping.category >= 0 ? cellText(row[mapping.category]) : '', type, description, ctx) : null;

    let fp = '';
    let duplicate: DuplicateKind = 'none';
    if (date && amount !== null) {
      fp = fingerprint(opts.accountId, date, amount, description);
      const left = remainingExisting.get(fp) ?? 0;
      if (left > 0) {
        duplicate = 'existing';
        remainingExisting.set(fp, left - 1);
      } else if (seenInFile.has(fp)) {
        duplicate = 'file';
      }
      seenInFile.add(fp);
    }

    out.push({
      rowIndex,
      date,
      description,
      amount,
      type,
      categoryId,
      currency,
      errors,
      duplicate,
      fingerprint: fp,
      rawText: row.map(cellText).filter(Boolean).join(' '),
      // mai selezionare righe non valide o già presenti
      selected: errors.length === 0 && duplicate !== 'existing',
    });
  });
  return out;
}

export interface PreviewStats {
  total: number;
  valid: number;
  invalid: number;
  duplicatesExisting: number;
  duplicatesFile: number;
  selected: number;
  income: Cents;
  expense: Cents;
}

export function previewStats(rows: PreviewRow[]): PreviewStats {
  const s: PreviewStats = { total: rows.length, valid: 0, invalid: 0, duplicatesExisting: 0, duplicatesFile: 0, selected: 0, income: 0, expense: 0 };
  for (const r of rows) {
    if (r.errors.length) s.invalid++;
    else s.valid++;
    if (r.duplicate === 'existing') s.duplicatesExisting++;
    if (r.duplicate === 'file') s.duplicatesFile++;
    if (r.selected && r.errors.length === 0 && r.amount !== null) {
      s.selected++;
      if (r.amount > 0) s.income += r.amount;
      else s.expense += -r.amount;
    }
  }
  return s;
}

const OPENING = /\bsaldo (iniziale|precedente|di apertura|apertura|contabile iniziale)\b/;
const CLOSING = /\bsaldo (finale|di chiusura|chiusura|contabile finale|contabile al|al)\b/;

export interface StatementCheck {
  opening: Cents | null;
  closing: Cents | null;
  /** entrate − uscite delle righe valide (selezionate o no, duplicati compresi) */
  net: Cents;
  /** closing − (opening + net); null se manca un saldo */
  difference: Cents | null;
  lastDate: ISODate | null;
}

/** Usa le righe di saldo iniziale/finale presenti nell'estratto per verificare che i movimenti letti quadrino. */
export function statementCheck(rows: PreviewRow[]): StatementCheck {
  let opening: Cents | null = null;
  let closing: Cents | null = null;
  let net = 0;
  let lastDate: ISODate | null = null;
  for (const r of rows) {
    // solo le righe escluse possono essere righe di saldo: un movimento valido resta un movimento
    const d = r.errors.length ? normalizeText(`${r.description} ${r.rawText}`) : '';
    if (r.amount !== null && OPENING.test(d) && opening === null) opening = r.amount;
    else if (r.amount !== null && CLOSING.test(d)) closing = r.amount;
    else if (r.errors.length === 0 && r.amount !== null) {
      net += r.amount;
      if (r.date && (!lastDate || r.date > lastDate)) lastDate = r.date;
    }
  }
  return { opening, closing, net, difference: opening !== null && closing !== null ? closing - (opening + net) : null, lastDate };
}
