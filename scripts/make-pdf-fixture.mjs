// Genera un estratto conto PDF di prova con impaginazione tipica di una banca italiana:
// preambolo, intestazione ripetuta su ogni pagina, colonne Entrate/Uscite separate,
// descrizioni su più righe, righe di saldo, piè di pagina.
import { jsPDF } from 'jspdf';
import { writeFileSync } from 'node:fs';

const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
const cols = { dop: 40, dval: 115, ent: 250, usc: 330, desc: 360, full: 520 };

const movements = [
  ['01/10/2026', '01/10/2026', '2.450,00', '', 'Bonifico', ['Bonifico SEPA da ACME SRL', 'Stipendio ottobre 2026']],
  ['02/10/2026', '02/10/2026', '', '86,35', 'Pagamento Visa Debit', ['ESSELUNGA MILANO VIALE PIAVE']],
  ['05/10/2026', '05/10/2026', '', '850,00', 'Bonifico', ['Bonifico SEPA a Mario Bianchi', 'Affitto ottobre']],
  ['07/10/2026', '07/10/2026', '', '62,10', 'Addebito SDD', ['A2A ENERGIA SPA bolletta luce']],
  ['09/10/2026', '09/10/2026', '', '3,50', 'Pagamento Visa Debit', ['BAR CENTRALE']],
  ['12/10/2026', '12/10/2026', '', '12,99', 'Pagamento Visa Debit', ['NETFLIX.COM']],
  ['14/10/2026', '14/10/2026', '19,99', '', 'Storno', ['Rimborso AMAZON EU SARL']],
  ['20/10/2026', '20/10/2026', '', '1.234,56', 'Bonifico', ['Bonifico SEPA a Concessionaria Auto', 'Anticipo acquisto auto', 'rif. contratto 4471']],
  ['22/10/2026', '22/10/2026', '', '54,50', 'Pagamento Visa Debit', ['RISTORANTE DA MARIO']],
  ['25/10/2026', '25/10/2026', '', '60,00', 'Pagamento Visa Debit', ['ENI STATION 1234']],
  ['28/10/2026', '28/10/2026', '', '39,00', 'Pagamento Visa Debit', ['ATM MILANO ABBONAMENTO']],
  ['30/10/2026', '30/10/2026', '0,42', '', 'Interessi', ['Competenze di chiusura']],
];

function header(y) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('Data Operazione', cols.dop, y);
  doc.text('Data Valuta', cols.dval, y);
  doc.text('Entrate', cols.ent + 40, y, { align: 'right' });
  doc.text('Uscite', cols.usc, y, { align: 'right' });
  doc.text('Descrizione', cols.desc, y);
  doc.text('Descrizione Completa', cols.full, y);
  doc.setFont('helvetica', 'normal');
}

function pageTop(n) {
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Banca Esempio S.p.A.', 40, 40);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Estratto conto corrente n. 000012345 - Intestatario: Mario Rossi', 40, 56);
  doc.text('Periodo dal 01/10/2026 al 31/10/2026', 40, 68);
  doc.text(`Pagina ${n} di 2`, 760, 570, { align: 'right' });
  header(100);
}

pageTop(1);
let y = 116;
doc.setFontSize(8);
doc.text('Saldo iniziale al 30/09/2026', cols.desc, y);
doc.text('1.000,00', cols.ent + 40, y, { align: 'right' });
y += 16;
movements.forEach((m, i) => {
  if (i === 8) {
    doc.addPage();
    pageTop(2);
    y = 116;
  }
  doc.setFontSize(8);
  doc.text(m[0], cols.dop, y);
  doc.text(m[1], cols.dval, y);
  if (m[2]) doc.text(m[2], cols.ent + 40, y, { align: 'right' });
  if (m[3]) doc.text(m[3], cols.usc, y, { align: 'right' });
  doc.text(m[4], cols.desc, y);
  m[5].forEach((line, j) => doc.text(line, cols.full, y + j * 10));
  y += Math.max(1, m[5].length) * 10 + 8;
});
doc.text('Saldo finale al 31/10/2026', cols.desc, y + 8);
doc.text('1.067,41', cols.ent + 40, y + 8, { align: 'right' });

writeFileSync(process.argv[2] ?? 'e2e/fixtures/estratto-banca.pdf', Buffer.from(doc.output('arraybuffer')));
console.log('ok');
