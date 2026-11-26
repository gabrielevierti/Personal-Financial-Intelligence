import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { DEFAULT_CATEGORIES } from '../../database/seed';
import { buildPreview, detectHeaderRow, fingerprint, guessMapping, previewStats, validateMapping, type ParseContext, type ParseOptions } from '../../services/importParser';
import { decodeText, parseCsvText, parseWorkbook } from '../../services/fileReader';

const categories = DEFAULT_CATEGORIES.map((c) => ({ ...c, isDefault: true }));
const opts: ParseOptions = { dateFormat: 'auto', decimal: 'auto', invertSign: false, accountId: 'acc', accountCurrency: 'EUR' };
const ctx = (existing = new Map<string, number>()): ParseContext => ({ categories, existingFingerprints: existing });

const ITALIAN_CSV = `Estratto conto n. 12
Intestatario;Mario Rossi

Data operazione;Data valuta;Descrizione;Importo;Categoria
15/01/2024;15/01/2024;STIPENDIO GENNAIO;2.500,00;Stipendio
16/01/2024;16/01/2024;ESSELUNGA MILANO;-85,40;Alimentari
;;;;
17/01/2024;17/01/2024;BAR CENTRALE;-3,50;
17/01/2024;17/01/2024;BAR CENTRALE;-3,50;
data errata;;RIGA NON VALIDA;-10,00;
18/01/2024;18/01/2024;;-10,00;
`;

describe('CSV italiano con preambolo', () => {
  const rows = parseCsvText(ITALIAN_CSV);
  it('trova la riga di intestazione e associa le colonne', () => {
    const h = detectHeaderRow(rows);
    expect(h).toBe(3);
    const m = guessMapping(rows[h], rows.slice(h + 1, h + 10));
    expect(m.date).toBe(0);
    expect(m.description).toBe(2);
    expect(m.amount).toBe(3);
    expect(m.category).toBe(4);
    expect(m.currency).toBe(-1); // "Data valuta" non è la divisa
    expect(validateMapping(m)).toEqual([]);
  });
  it('genera anteprima validata, ignora righe vuote e segnala errori', () => {
    const h = detectHeaderRow(rows);
    const m = guessMapping(rows[h]);
    const prev = buildPreview(rows, h, m, opts, ctx());
    expect(prev).toHaveLength(6);
    expect(prev[0]).toMatchObject({ date: '2024-01-15', amount: 250000, type: 'income', categoryId: 'inc-salary', selected: true });
    expect(prev[1]).toMatchObject({ amount: -8540, type: 'expense', categoryId: 'exp-groceries' });
    expect(prev[2]).toMatchObject({ categoryId: 'exp-other', duplicate: 'none' });
    expect(prev[3]).toMatchObject({ duplicate: 'file', selected: true });
    expect(prev[4].errors).toContain('Data non valida');
    expect(prev[4].selected).toBe(false);
    expect(prev[5].errors).toContain('Descrizione mancante');
    const s = previewStats(prev);
    expect(s).toMatchObject({ total: 6, valid: 4, invalid: 2, selected: 4, income: 250000, expense: 8540 + 700 });
  });
  it('riconosce i duplicati già presenti (rispettando le occorrenze)', () => {
    const h = detectHeaderRow(rows);
    const m = guessMapping(rows[h]);
    const fpBar = fingerprint('acc', '2024-01-17', -350, 'BAR CENTRALE');
    const prev = buildPreview(rows, h, m, opts, ctx(new Map([[fpBar, 1]])));
    expect(prev[2]).toMatchObject({ duplicate: 'existing', selected: false });
    expect(prev[3]).toMatchObject({ duplicate: 'file', selected: true });
  });
});

describe('colonne dare/avere e formati internazionali', () => {
  it('gestisce entrate e uscite separate', () => {
    const rows = parseCsvText('Date,Details,Money In,Money Out\n2024-02-01,Salary,"1,500.00",\n2024-02-03,Coffee,,4.20\n');
    const m = guessMapping(rows[0]);
    expect(m.credit).toBe(2);
    expect(m.debit).toBe(3);
    const prev = buildPreview(rows, 0, m, opts, ctx());
    expect(prev.map((p) => p.amount)).toEqual([150000, -420]);
  });
  it('date USA rilevate automaticamente e inversione del segno', () => {
    const rows = parseCsvText('Date;Description;Amount\n01/13/2024;Shop;25.00\n02/20/2024;Shop 2;10.00\n');
    const prev = buildPreview(rows, 0, guessMapping(rows[0]), { ...opts, invertSign: true }, ctx());
    expect(prev.map((p) => [p.date, p.amount])).toEqual([
      ['2024-01-13', -2500],
      ['2024-02-20', -1000],
    ]);
  });
  it('intestazioni non standard: riconoscimento dal contenuto', () => {
    const rows = parseCsvText('Col A|Col B|Col C\n05.03.2024|Pagamento POS supermercato|-12,30\n06.03.2024|Bonifico ricevuto da cliente|300,00\n');
    const m = guessMapping(rows[0], rows.slice(1));
    expect(m).toMatchObject({ date: 0, description: 1, amount: 2 });
  });
  it('segnala valuta diversa da quella del conto', () => {
    const rows = parseCsvText('Data;Descrizione;Importo;Divisa\n01/03/2024;Amazon;-10,00;USD\n');
    const prev = buildPreview(rows, 0, guessMapping(rows[0]), opts, ctx());
    expect(prev[0].errors[0]).toMatch(/Valuta USD/);
  });
  it('mapping incompleto non valido', () => {
    expect(validateMapping({ date: -1, description: -1, amount: -1, credit: -1, debit: -1, category: -1, currency: -1 })).toHaveLength(3);
  });
});

describe('lettura file', () => {
  it('decodifica Windows-1252', () => {
    const bytes = new Uint8Array([0x43, 0x61, 0x66, 0xe8]); // "Cafè"
    expect(decodeText(bytes.buffer)).toBe('Cafè');
  });
  it('legge un XLSX con date native e numeri', async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Movimenti conto'],
      [],
      ['Data', 'Causale', 'Importo'],
      [new Date(Date.UTC(2024, 0, 15)), 'Affitto', -750],
      [45307, 'Rimborso', 20.5],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Foglio1');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const { rows, sheets } = await parseWorkbook(buf);
    expect(sheets).toEqual(['Foglio1']);
    const h = detectHeaderRow(rows);
    expect(h).toBe(2);
    const prev = buildPreview(rows, h, guessMapping(rows[h]), opts, ctx());
    expect(prev.map((p) => [p.date, p.description, p.amount])).toEqual([
      ['2024-01-15', 'Affitto', -75000],
      ['2024-01-16', 'Rimborso', 2050],
    ]);
  });
});
