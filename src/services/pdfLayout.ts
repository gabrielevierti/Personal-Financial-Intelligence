/**
 * Ricostruzione di una tabella da un PDF di estratto conto, a partire dalle posizioni del testo.
 * Logica pura (nessuna dipendenza da pdf.js) così da essere testabile in modo deterministico.
 *
 * Strategia:
 *  1. raggruppa i frammenti di testo in righe (stessa coordinata verticale);
 *  2. unisce in "segmenti" i frammenti vicini sulla stessa riga (parole della stessa cella);
 *  3. individua la riga di intestazione (Data, Descrizione, Entrate, Uscite, …) e usa la posizione
 *     orizzontale di ogni intestazione come ancora di colonna: così le celle vuote (es. "Entrate"
 *     vuota in una riga di uscita) non fanno scorrere le colonne;
 *  4. assegna ogni segmento alla colonna con cui si sovrappone di più;
 *  5. unisce le righe di continuazione (descrizioni su più righe) alla riga precedente;
 *  6. scarta le intestazioni ripetute nelle pagine successive.
 */
import { guessMapping, headerFieldCount, type RawRow } from './importParser';
import { parseAmount } from '../utils/money';
import { parseDate } from '../utils/date';
import { normalizeText } from '../utils/text';

export interface PdfTextItem {
  text: string;
  /** coordinata x del bordo sinistro */
  x: number;
  /** coordinata y della linea di base (origine in basso, come in PDF) */
  y: number;
  /** larghezza del frammento */
  w: number;
  /** altezza del carattere */
  h: number;
  page: number;
}

interface Segment {
  text: string;
  x0: number;
  x1: number;
}

interface Line {
  page: number;
  y: number;
  h: number;
  segments: Segment[];
}

export interface PdfTable {
  rows: RawRow[];
  /** true se è stata trovata una riga di intestazione usata per allineare le colonne */
  aligned: boolean;
  pages: number;
  lines: number;
}

export function groupLines(items: PdfTextItem[]): Line[] {
  const byPage = new Map<number, PdfTextItem[]>();
  for (const it of items) {
    if (!it.text.trim()) continue;
    const list = byPage.get(it.page) ?? [];
    list.push(it);
    byPage.set(it.page, list);
  }
  const lines: Line[] = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const list = byPage.get(page)!.sort((a, b) => b.y - a.y || a.x - b.x);
    let current: { y: number; h: number; items: PdfTextItem[] } | null = null;
    const pageLines: Array<{ y: number; h: number; items: PdfTextItem[] }> = [];
    for (const it of list) {
      const tol = Math.max(2, Math.min(it.h, current?.h ?? it.h) * 0.45);
      if (current && Math.abs(current.y - it.y) <= tol) {
        current.items.push(it);
      } else {
        current = { y: it.y, h: it.h, items: [it] };
        pageLines.push(current);
      }
    }
    for (const l of pageLines) {
      const sorted = l.items.sort((a, b) => a.x - b.x);
      const segments: Segment[] = [];
      for (const it of sorted) {
        const last = segments[segments.length - 1];
        const gap = last ? it.x - last.x1 : Infinity;
        // spazio tra parole ≈ 0,25–0,35 em; tra colonne molto di più
        if (last && gap <= Math.max(1.5, it.h * 0.6)) {
          const sep = gap > it.h * 0.12 && !last.text.endsWith(' ') && !it.text.startsWith(' ') ? ' ' : '';
          last.text += sep + it.text;
          last.x1 = Math.max(last.x1, it.x + it.w);
        } else {
          segments.push({ text: it.text, x0: it.x, x1: it.x + it.w });
        }
      }
      for (const s of segments) s.text = s.text.replace(/\s+/g, ' ').trim();
      lines.push({ page, y: l.y, h: l.h, segments: segments.filter((s) => s.text) });
    }
  }
  return lines.filter((l) => l.segments.length > 0);
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.min(a1, b1) - Math.max(a0, b0);
}

/** Indice della colonna a cui assegnare un segmento. */
function columnFor(seg: Segment, anchors: Array<{ x0: number; x1: number }>): number {
  let best = -1;
  let bestOverlap = 0;
  anchors.forEach((a, i) => {
    const o = overlap(seg.x0, seg.x1, a.x0, a.x1);
    if (o > bestOverlap) {
      bestOverlap = o;
      best = i;
    }
  });
  if (best >= 0) return best;
  // nessuna sovrapposizione: colonna più vicina
  let bestDist = Infinity;
  anchors.forEach((a, i) => {
    const d = seg.x1 < a.x0 ? a.x0 - seg.x1 : seg.x0 - a.x1;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

/** Allarga le ancore fino a metà strada dalle colonne adiacenti, per assorbire testi più larghi dell'intestazione. */
function widenAnchors(anchors: Segment[]): Array<{ x0: number; x1: number }> {
  return anchors.map((a, i) => {
    const prev = anchors[i - 1];
    const next = anchors[i + 1];
    return {
      x0: prev ? (prev.x1 + a.x0) / 2 : -Infinity,
      x1: next ? (a.x1 + next.x0) / 2 : Infinity,
    };
  });
}

export function linesToTable(lines: Line[]): PdfTable {
  const pages = new Set(lines.map((l) => l.page)).size;
  const textRows = lines.map((l) => l.segments.map((s) => s.text));

  // riga di intestazione = quella con più campi riconosciuti (almeno 2)
  let headerIdx = -1;
  let bestScore = 1;
  textRows.forEach((r, i) => {
    const s = headerFieldCount(r);
    if (s > bestScore) {
      bestScore = s;
      headerIdx = i;
    }
  });

  if (headerIdx < 0) {
    // nessuna intestazione: righe divise per spaziatura, associazione manuale nel passo successivo
    return { rows: textRows, aligned: false, pages, lines: lines.length };
  }

  const header = lines[headerIdx];
  const anchors = widenAnchors(header.segments);
  const headerKey = normalizeText(textRows[headerIdx].join(' '));
  const headerRow: RawRow = header.segments.map((s) => s.text);
  const mapping = guessMapping(headerRow);
  const amountCols = [mapping.amount, mapping.credit, mapping.debit].filter((c) => c >= 0);

  const out: RawRow[] = [headerRow];
  let prev: { row: string[]; line: Line } | null = null;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (normalizeText(textRows[i].join(' ')) === headerKey) {
      prev = null; // intestazione ripetuta su una nuova pagina
      continue;
    }
    const row: string[] = new Array(header.segments.length).fill('');
    for (const seg of line.segments) {
      const c = columnFor(seg, anchors);
      row[c] = row[c] ? `${row[c]} ${seg.text}` : seg.text;
    }

    const hasDate = mapping.date >= 0 && parseDate(row[mapping.date]) !== null;
    const hasAmount = amountCols.some((c) => row[c] && parseAmount(row[c]) !== null);
    const filled = row.map((v, idx) => (v ? idx : -1)).filter((idx) => idx >= 0);
    const onlyText = filled.length > 0 && filled.every((idx) => idx !== mapping.date && !amountCols.includes(idx));
    const close = prev !== null && prev.line.page === line.page && prev.line.y - line.y <= Math.max(prev.line.h, line.h) * 2.4;

    if (!hasDate && !hasAmount && onlyText && close && prev) {
      // continuazione della descrizione della riga precedente
      for (const idx of filled) prev.row[idx] = prev.row[idx] ? `${prev.row[idx]} ${row[idx]}` : row[idx];
      prev.line = line;
      continue;
    }
    if (!hasDate && !hasAmount) {
      // intestazioni di pagina, piè di pagina, note: non possono essere movimenti
      prev = null;
      continue;
    }
    out.push(row);
    prev = hasDate ? { row, line } : null;
  }
  return { rows: out, aligned: true, pages, lines: lines.length };
}

export function itemsToTable(items: PdfTextItem[]): PdfTable {
  return linesToTable(groupLines(items));
}
