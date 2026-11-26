/**
 * Esportazioni locali (CSV, JSON, PDF). I file vengono generati nel browser e scaricati, mai inviati.
 */
import Papa from 'papaparse';
import type { Account, Category, Transaction } from '../types';
import { centsToInput } from '../utils/money';

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text: string, fileName: string, mime: string): void {
  // BOM per far riconoscere UTF-8 a Excel
  const prefix = mime.startsWith('text/csv') ? '﻿' : '';
  downloadBlob(new Blob([prefix + text], { type: mime }), fileName);
}

/** Protegge dall'injection di formule nei fogli di calcolo. */
export function safeCsvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s) ? `'${s}` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return Papa.unparse({ fields: headers, data: rows.map((r) => r.map(safeCsvCell)) }, { delimiter: ';' });
}

const TYPE_LABEL = { income: 'Entrata', expense: 'Uscita', transfer: 'Trasferimento' } as const;

export function transactionsToCsv(txs: Transaction[], accounts: Account[], categories: Category[]): string {
  const acc = new Map(accounts.map((a) => [a.id, a.name]));
  const cat = new Map(categories.map((c) => [c.id, c.name]));
  const rows = [...txs]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((t) => [
      t.date,
      t.description,
      centsToInput(t.amount),
      t.currency,
      TYPE_LABEL[t.type],
      t.categoryId ? (cat.get(t.categoryId) ?? '') : '',
      acc.get(t.accountId) ?? '',
      t.counterAccountId ? (acc.get(t.counterAccountId) ?? '') : '',
      t.notes ?? '',
    ]);
  return toCsv(['Data', 'Descrizione', 'Importo', 'Valuta', 'Tipologia', 'Categoria', 'Conto', 'Conto controparte', 'Note'], rows);
}

export interface PdfSection {
  title: string;
  head: string[];
  body: string[][];
}

export async function exportPdf(fileName: string, title: string, subtitle: string, sections: PdfSection[]): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const { autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const green: [number, number, number] = [31, 61, 48];
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(20, 33, 27);
  doc.text(title, 40, 50);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(90, 100, 95);
  doc.text(subtitle, 40, 68);
  doc.text(`Generato localmente da PFI il ${new Date().toLocaleString('it-IT')}`, 40, 82);
  let y = 104;
  for (const s of sections) {
    if (y > 740) {
      doc.addPage();
      y = 50;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(20, 33, 27);
    doc.text(s.title, 40, y);
    autoTable(doc, {
      startY: y + 8,
      head: [s.head],
      body: s.body.length ? s.body : [[{ content: 'Nessun dato nel periodo', colSpan: s.head.length }] as unknown as string[]],
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: green, textColor: 255 },
      margin: { left: 40, right: 40 },
    });
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 28;
  }
  doc.save(fileName);
}
