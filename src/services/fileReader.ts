/**
 * Lettura locale dei file (CSV/XLS/XLSX). Nessun dato lascia il dispositivo.
 */
import Papa from 'papaparse';
import type { RawRow } from './importParser';

export interface ParsedFile {
  fileName: string;
  kind: 'csv' | 'xlsx' | 'pdf';
  sheets: string[];
  sheet: string;
  rows: RawRow[];
  /** Solo PDF: pagine lette e se le colonne sono state allineate a un'intestazione. */
  pdf?: { pages: number; aligned: boolean };
}

export const MAX_FILE_SIZE = 20 * 1024 * 1024;

export function fileKind(name: string): 'csv' | 'xlsx' | 'pdf' | null {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'csv' || ext === 'txt') return 'csv';
  if (ext === 'xls' || ext === 'xlsx') return 'xlsx';
  if (ext === 'pdf') return 'pdf';
  return null;
}

/** Decodifica testo provando UTF-8 e, in caso di caratteri non validi, Windows-1252 (comune nelle banche italiane). */
export function decodeText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export function parseCsvText(text: string): RawRow[] {
  const result = Papa.parse<string[]>(text, {
    delimiter: '', // auto-detect ( , ; \t | )
    skipEmptyLines: false,
    delimitersToGuess: [';', ',', '\t', '|'],
  });
  return result.data.map((r) => (Array.isArray(r) ? r.map((c) => (typeof c === 'string' ? c.trim() : c)) : []));
}

export async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error ?? new Error('Lettura del file non riuscita'));
    r.readAsArrayBuffer(file);
  });
}

export async function parseWorkbook(buffer: ArrayBuffer, sheetName?: string): Promise<{ sheets: string[]; sheet: string; rows: RawRow[] }> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true, dense: true });
  const sheets = wb.SheetNames;
  if (sheets.length === 0) throw new Error('Il file non contiene fogli di lavoro.');
  const sheet = sheetName && sheets.includes(sheetName) ? sheetName : sheets[0];
  const ws = wb.Sheets[sheet];
  const rows = XLSX.utils.sheet_to_json<RawRow>(ws, { header: 1, raw: true, defval: '', blankrows: true });
  return { sheets, sheet, rows };
}

export async function readStatementFile(file: File, sheetName?: string): Promise<ParsedFile> {
  const kind = fileKind(file.name);
  if (!kind) throw new Error('Formato non supportato. Usa CSV, XLS, XLSX o PDF.');
  if (file.size === 0) throw new Error('Il file è vuoto.');
  if (file.size > MAX_FILE_SIZE) throw new Error('File troppo grande (massimo 20 MB).');
  const buffer = await readFileAsArrayBuffer(file);
  if (kind === 'csv') {
    const rows = parseCsvText(decodeText(buffer));
    return { fileName: file.name, kind, sheets: [], sheet: '', rows };
  }
  if (kind === 'pdf') {
    const { browserPdfAssets, loadBrowserPdfJs, pdfToTable } = await import('./pdfReader');
    const table = await pdfToTable(await loadBrowserPdfJs(), new Uint8Array(buffer), browserPdfAssets());
    return { fileName: file.name, kind, sheets: [], sheet: '', rows: table.rows, pdf: { pages: table.pages, aligned: table.aligned } };
  }
  const { sheets, sheet, rows } = await parseWorkbook(buffer, sheetName);
  return { fileName: file.name, kind, sheets, sheet, rows };
}
