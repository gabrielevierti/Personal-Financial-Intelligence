/**
 * Estrae dalla descrizione bancaria il nome dell'esercente o della controparte, eliminando
 * il "rumore" tipico degli estratti italiani (tipo di operazione, numeri di carta, date, codici).
 *   "Ristorante Hazama Milano It Carta N. ***** 703 Data Operazione 26/09/26" → "ristorante hazama milano"
 *   "Pagamento Visa Debit ESSELUNGA MILANO VIALE PIAVE"                      → "esselunga milano viale"
 *   "Iliad Addebito Sdd Fattura a Vs Carico da It46zzz0000013970161009"     → "iliad"
 */
import { normalizeText } from '../utils/text';

const NOISE = new Set([
  'pagamento', 'pagam', 'pag', 'pos', 'visa', 'debit', 'mastercard', 'maestro', 'carta', 'card', 'n', 'nr', 'num', 'numero', 'data', 'operazione', 'op',
  'addebito', 'addebiti', 'accredito', 'sdd', 'sepa', 'core', 'bonifico', 'bonif', 'bon', 'a', 'favore', 'di', 'da', 'del', 'della', 'per', 'il', 'la', 'lo',
  'it', 'ita', 'italy', 'italia', 'eur', 'euro', 'fattura', 'vs', 'carico', 'rif', 'riferimento', 'cro', 'trn', 'id', 'mandato', 'presso', 'acquisto',
  'contactless', 'apple', 'pay', 'google', 'online', 'ecommerce', 'commercio', 'elettronico', 'pagobancomat', 'bancomat', 'prelievo', 'atm', 'ricevuto',
  'disposto', 'in', 'entrata', 'uscita', 'ordinante', 'beneficiario', 'causale', 'debitore', 'creditore', 'web', 'app', 'srl', 'spa', 's', 'p', 'r', 'l',
  'sp', 'sa', 'ltd', 'inc', 'gmbh', 'bv', 'eu', 'sarl', 'sas', 'snc',
]);

/** Parole che vanno conservate anche se in NOISE perché identificano il movimento. */
const KEEP_WHEN_ALONE = new Set(['prelievo', 'bonifico', 'atm']);

export function merchantKey(description: string, maxWords = 3): string {
  const words = normalizeText(description)
    .replace(/\b[a-z]{2}\d{2}[a-z0-9]{10,30}\b/g, ' ') // IBAN e identificativi creditore
    .split(' ')
    .filter(Boolean);
  const kept: string[] = [];
  for (const w of words) {
    if (/\d/.test(w)) continue; // numeri, date, codici
    if (w.length < 2) continue;
    if (NOISE.has(w)) continue;
    kept.push(w);
    if (kept.length >= maxWords) break;
  }
  if (kept.length === 0) {
    const fallback = words.find((w) => KEEP_WHEN_ALONE.has(w));
    return fallback ?? words.slice(0, 2).join(' ');
  }
  return kept.join(' ');
}

/** Somiglianza tra due descrizioni (0–1) sulle parole significative. */
export function merchantSimilarity(a: string, b: string): number {
  const A = new Set(merchantKey(a, 6).split(' ').filter(Boolean));
  const B = new Set(merchantKey(b, 6).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}
