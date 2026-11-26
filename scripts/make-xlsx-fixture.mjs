// Genera il file XLSX di test per gli E2E.
import * as XLSX from 'xlsx';
import { writeFileSync } from 'node:fs';
const ws = XLSX.utils.aoa_to_sheet([
  ['Lista movimenti carta'],
  [],
  ['Data', 'Causale', 'Dare', 'Avere'],
  [new Date(Date.UTC(2026, 9, 18)), 'Ristorante Da Mario', 54.5, ''],
  [new Date(Date.UTC(2026, 9, 20)), 'Rimborso Amazon', '', 19.99],
  [new Date(Date.UTC(2026, 9, 22)), 'Benzina ENI', 60, ''],
]);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Movimenti');
writeFileSync(process.argv[2] ?? 'e2e/fixtures/carta.xlsx', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
