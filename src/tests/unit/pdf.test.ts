import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CATEGORIES } from '../../database/seed';
import { buildPreview, detectHeaderRow, guessMapping, previewStats, statementCheck } from '../../services/importParser';
import { groupLines, itemsToTable, type PdfTextItem } from '../../services/pdfLayout';
import { pdfToTable, type PdfJsLike } from '../../services/pdfReader';

const categories = DEFAULT_CATEGORIES.map((c) => ({ ...c, isDefault: true }));
const opts = { dateFormat: 'auto' as const, decimal: 'auto' as const, invertSign: false, accountId: 'acc', accountCurrency: 'EUR' };

const it8 = (text: string, x: number, y: number, page = 1): PdfTextItem => ({ text, x, y, w: text.length * 4, h: 8, page });

describe('ricostruzione layout PDF (sintetico)', () => {
  it('unisce le parole vicine e separa le colonne distanti', () => {
    const lines = groupLines([it8('Pagamento', 100, 500), it8('POS', 138, 500.5), it8('12,00', 300, 500)]);
    expect(lines).toHaveLength(1);
    expect(lines[0].segments.map((s) => s.text)).toEqual(['Pagamento POS', '12,00']);
  });
  it('allinea le celle alle intestazioni anche con colonne vuote', () => {
    const t = itemsToTable([
      it8('Data', 40, 700), it8('Entrate', 200, 700), it8('Uscite', 280, 700), it8('Descrizione', 360, 700),
      it8('01/02/2026', 40, 680), it8('100,00', 200, 680), it8('Stipendio', 360, 680),
      it8('02/02/2026', 40, 664), it8('9,90', 284, 664), it8('Spotify', 360, 664),
      it8('abbonamento mensile', 360, 654), // continuazione
    ]);
    expect(t.aligned).toBe(true);
    expect(t.rows).toEqual([
      ['Data', 'Entrate', 'Uscite', 'Descrizione'],
      ['01/02/2026', '100,00', '', 'Stipendio'],
      ['02/02/2026', '', '9,90', 'Spotify abbonamento mensile'],
    ]);
  });
  it('senza intestazione restituisce le righe divise per spaziatura', () => {
    const t = itemsToTable([it8('01/02/2026', 40, 680), it8('Caffè', 200, 680), it8('-1,20', 300, 680)]);
    expect(t.aligned).toBe(false);
    expect(t.rows).toEqual([['01/02/2026', 'Caffè', '-1,20']]);
  });
});

describe('PDF reale (pdf.js)', async () => {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJsLike & { GlobalWorkerOptions: { workerSrc: string } };
  pdfjs.GlobalWorkerOptions.workerSrc = join(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
  const data = new Uint8Array(readFileSync(join(process.cwd(), 'e2e/fixtures/estratto-banca.pdf')));
  const assets = {
    standardFontDataUrl: join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts') + '/',
    cMapUrl: join(process.cwd(), 'node_modules/pdfjs-dist/cmaps') + '/',
  };

  it('estrae i movimenti da un estratto conto su 2 pagine', async () => {
    const table = await pdfToTable(pdfjs, data, assets);
    expect(table.pages).toBe(2);
    expect(table.aligned).toBe(true);
    const h = detectHeaderRow(table.rows);
    const m = guessMapping(table.rows[h], table.rows.slice(h + 1));
    expect(table.rows[h][m.date]).toBe('Data Operazione');
    expect(table.rows[h][m.credit]).toBe('Entrate');
    expect(table.rows[h][m.debit]).toBe('Uscite');
    // tra "Descrizione" e "Descrizione Completa" viene scelta automaticamente quella più ricca
    expect(table.rows[h][m.description]).toBe('Descrizione Completa');
    const prev = buildPreview(table.rows, h, m, opts, { categories, existingFingerprints: new Map() });
    const valid = prev.filter((r) => r.errors.length === 0);
    expect(valid).toHaveLength(12);
    expect(valid[0]).toMatchObject({ date: '2026-10-01', amount: 245000, description: 'Bonifico SEPA da ACME SRL Stipendio ottobre 2026' });
    expect(valid[7]).toMatchObject({ date: '2026-10-20', amount: -123456, description: 'Bonifico SEPA a Concessionaria Auto Anticipo acquisto auto rif. contratto 4471' });
    expect(valid[8]).toMatchObject({ date: '2026-10-22', amount: -5450 }); // prima riga di pagina 2
    // le due righe di saldo (iniziale e finale) sono le uniche escluse
    expect(prev.length - valid.length).toBe(2);
    // con la colonna descrizione breve, le righe di saldo sono riconosciute esplicitamente
    const short = buildPreview(table.rows, h, { ...m, description: table.rows[h].indexOf('Descrizione') }, opts, { categories, existingFingerprints: new Map() });
    expect(short.filter((r) => r.errors.includes('Riga di saldo o totale, non un movimento'))).toHaveLength(2);
    // verifica di quadratura con i saldi dell'estratto
    expect(statementCheck(prev)).toMatchObject({ opening: 100000, closing: 106741, difference: 0, lastDate: '2026-10-30' });
    const missingRow = prev.filter((r) => r.amount !== -5450);
    expect(statementCheck(missingRow).difference).toBe(-5450);
    const s = previewStats(prev);
    expect(s.income).toBe(245000 + 1999 + 42);
    expect(s.expense).toBe(8635 + 85000 + 6210 + 350 + 1299 + 123456 + 5450 + 6000 + 3900);
  });

  it('rifiuta un file che non è un PDF', async () => {
    await expect(pdfToTable(pdfjs, new TextEncoder().encode('ciao'))).rejects.toThrow(/PDF valido|Invalid PDF/i);
  });
});
