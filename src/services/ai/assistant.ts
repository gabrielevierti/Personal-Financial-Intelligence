/**
 * Assistente finanziario: costruisce il contesto per il modello locale e gestisce la categorizzazione con l'AI.
 */
import type { Category, CategoryKind, Transaction } from '../../types';
import { formatDate, formatMonth, monthOf } from '../../utils/date';
import { formatMoney, formatPercent } from '../../utils/money';
import { isFallback } from '../categorize';
import { ACCOUNT_TYPE_LABELS, balancesByAccount, makeConverter, monthlySeries, totalsByCategory } from '../finance';
import { merchantKey } from '../merchant';
import type { DataSet } from '../reports';
import { addMonths } from '../../utils/date';
import { parseJsonLoose, type AiClient, type ChatMessage } from './client';
import type { Insights } from './insights';

export const SYSTEM_PROMPT = `Sei l'assistente finanziario di PFI, un'app di finanza personale che gira sul computer dell'utente.
Rispondi sempre in italiano, in modo chiaro e concreto, con frasi brevi ed elenchi puntati quando servono.
Regole:
- Usa SOLO i dati del contesto qui sotto. Non inventare importi, movimenti, conti o date.
- I numeri del contesto sono già calcolati e corretti: riportali così come sono, non rifare i conti.
- Se una domanda richiede dati che non hai, dillo chiaramente.
- Dai suggerimenti pratici e personalizzati (abbonamenti da valutare, categorie in crescita, budget, obiettivi di risparmio).
- Non sei un consulente finanziario: su investimenti e prodotti finanziari dai solo informazioni generali.`;

const eur = (c: number, cur: string) => formatMoney(c, cur);

/** Riassunto compatto dei dati finanziari, pensato per un modello piccolo (poche migliaia di token). */
export function buildContext(ds: DataSet, ins: Insights): string {
  const cur = ins.currency;
  const conv = makeConverter(ds.settings);
  const lines: string[] = [];
  lines.push(`Data di oggi: ${formatDate(ins.generatedAt)}. Valuta: ${cur}. Mesi di dati: ${ins.monthsOfData}.`);
  lines.push(`Patrimonio netto attuale: ${eur(ins.netWorth, cur)}. Proiezione a fine anno al ritmo attuale: ${eur(ins.netWorthEndOfYear, cur)}.`);

  const bal = balancesByAccount(ds.accounts, ds.transactions);
  lines.push('\nCONTI');
  for (const a of ds.accounts) lines.push(`- ${a.name} (${ACCOUNT_TYPE_LABELS[a.type]}): saldo ${formatMoney(bal.get(a.id) ?? 0, a.currency)}`);

  const months = Array.from({ length: 6 }, (_, i) => addMonths(monthOf(ins.generatedAt), i - 5));
  lines.push('\nULTIMI 6 MESI (entrate / uscite / risparmio; trasferimenti tra conti esclusi)');
  for (const p of monthlySeries(ds.transactions, months, conv)) {
    lines.push(`- ${formatMonth(p.month, true)}: ${eur(p.income, cur)} / ${eur(p.expense, cur)} / ${eur(p.net, cur)}${p.month === monthOf(ins.generatedAt) ? ' (mese in corso)' : ''}`);
  }
  lines.push(`Media degli ultimi 3 mesi completi: entrate ${eur(ins.avgMonthlyIncome, cur)}, uscite ${eur(ins.avgMonthlyExpense, cur)}, risparmio ${eur(ins.avgMonthlyNet, cur)}${ins.avgMonthlyIncome > 0 ? ` (${formatPercent(ins.avgMonthlyNet / ins.avgMonthlyIncome)} delle entrate)` : ''}.`);

  const f = ins.forecast;
  lines.push(`\nPREVISIONE ${formatMonth(f.month, true).toUpperCase()} (giorno ${f.dayOfMonth} di ${f.daysInMonth})`);
  lines.push(`- Finora: entrate ${eur(f.incomeSoFar, cur)}, uscite ${eur(f.expenseSoFar, cur)}.`);
  lines.push(`- Ancora attese: pagamenti ricorrenti ${eur(f.expectedRecurringExpense, cur)}, spese variabili stimate ${eur(f.expectedVariableExpense, cur)}, entrate ricorrenti ${eur(f.expectedRecurringIncome, cur)}.`);
  lines.push(`- A fine mese: entrate ${eur(f.projectedIncome, cur)}, uscite ${eur(f.projectedExpense, cur)}, risparmio ${eur(f.projectedNet, cur)}. Liquidità prevista ${eur(f.projectedLiquidity, cur)} (oggi ${eur(f.liquidityNow, cur)}).`);

  const last3 = { start: `${addMonths(monthOf(ins.generatedAt), -3)}-01`, end: ins.generatedAt, label: '' };
  lines.push('\nSPESE PER CATEGORIA (ultimi 3 mesi + mese in corso)');
  for (const c of totalsByCategory(ds.transactions, last3, 'expense', ds.categories, conv).slice(0, 12)) lines.push(`- ${c.name}: ${eur(c.total, cur)} (${formatPercent(c.share, 0)}, ${c.count} movimenti)`);

  const rising = ins.trends.filter((t) => t.average > 0 && t.projected > t.average * 1.2).slice(0, 5);
  if (rising.length) {
    lines.push('\nCATEGORIE IN AUMENTO QUESTO MESE (proiezione a fine mese vs media mensile)');
    for (const t of rising) lines.push(`- ${t.name}: ${eur(t.projected, cur)} vs ${eur(t.average, cur)}`);
  }

  if (ins.recurring.length) {
    lines.push('\nPAGAMENTI E ENTRATE RICORRENTI (mensili)');
    for (const r of ins.recurring.slice(0, 15)) {
      const cat = ds.categories.find((c) => c.id === r.categoryId)?.name ?? '';
      lines.push(`- ${r.kind === 'income' ? 'Entrata' : 'Uscita'} «${r.merchant}» ${eur(r.amount, cur)} al mese${cat ? ` [${cat}]` : ''}, prossima attesa ${formatDate(r.nextExpected)}`);
    }
    lines.push(`Totale abbonamenti: ${eur(ins.subscriptionsMonthly, cur)} al mese (${eur(ins.subscriptionsMonthly * 12, cur)} l'anno).`);
  }

  const budgets = ds.budgets.filter((b) => b.month === monthOf(ins.generatedAt));
  if (budgets.length) {
    lines.push('\nBUDGET DEL MESE');
    for (const b of budgets) {
      const name = b.categoryId ? (ds.categories.find((c) => c.id === b.categoryId)?.name ?? '') : 'Totale';
      const spent = b.categoryId ? (ins.trends.find((t) => t.categoryId === b.categoryId)?.thisMonth ?? 0) : f.expenseSoFar;
      lines.push(`- ${name}: speso ${eur(spent, cur)} su ${eur(b.limit, cur)}`);
    }
  }
  return lines.join('\n');
}

export function buildMessages(context: string, history: ChatMessage[]): ChatMessage[] {
  return [{ role: 'system', content: `${SYSTEM_PROMPT}\n\nCONTESTO FINANZIARIO DELL'UTENTE\n${context}` }, ...history.slice(-8)];
}

export const SUGGESTED_QUESTIONS = [
  'Come sto andando questo mese rispetto alla media?',
  'Dove posso risparmiare 150 € al mese?',
  'Quali abbonamenti dovrei rivedere?',
  'Quanto avrò da parte a fine anno se continuo così?',
  'Proponimi un budget mensile per categoria.',
];

// ----------------------------------------------------------------------------- categorizzazione AI

export interface AiCategorySuggestion {
  merchant: string;
  kind: CategoryKind;
  example: string;
  count: number;
  categoryId: string;
}

/** Esercenti ancora in "Altre spese/entrate", raggruppati (una richiesta per esercente, non per movimento). */
export function uncategorizedMerchants(txs: Transaction[]): Array<{ merchant: string; kind: CategoryKind; example: string; count: number }> {
  const m = new Map<string, { merchant: string; kind: CategoryKind; example: string; count: number }>();
  for (const t of txs) {
    if (t.type === 'transfer' || !isFallback(t.categoryId)) continue;
    const merchant = merchantKey(t.description);
    const key = `${t.type}|${merchant}`;
    const cur = m.get(key) ?? { merchant, kind: t.type as CategoryKind, example: t.description, count: 0 };
    cur.count++;
    m.set(key, cur);
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
}

const BATCH = 20;

export async function categorizeWithAi(
  client: AiClient,
  items: Array<{ merchant: string; kind: CategoryKind; example: string; count: number }>,
  categories: Category[],
  opts: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<AiCategorySuggestion[]> {
  const out: AiCategorySuggestion[] = [];
  let processed = 0;
  for (const kind of ['expense', 'income'] as const) {
    const list = items.filter((i) => i.kind === kind);
    const cats = categories.filter((c) => c.kind === kind);
    const fallback = kind === 'expense' ? 'exp-other' : 'inc-other';
    for (let i = 0; i < list.length; i += BATCH) {
      const batch = list.slice(i, i + BATCH);
      const schema = {
        type: 'object',
        properties: { risultati: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer' }, categoria: { type: 'string', enum: cats.map((c) => c.id) } }, required: ['n', 'categoria'] } } },
        required: ['risultati'],
      };
      const prompt = `Classifica ogni ${kind === 'expense' ? 'spesa' : 'entrata'} bancaria italiana in una categoria.
Categorie disponibili (usa l'ID esatto):
${cats.map((c) => `- ${c.id}: ${c.name}`).join('\n')}
Se non sei sicuro usa "${fallback}".
Descrizioni:
${batch.map((b, j) => `${j + 1}. ${b.example.slice(0, 120)}`).join('\n')}
Rispondi solo con JSON: {"risultati":[{"n":1,"categoria":"ID"}, ...]}`;
      const text = await client.chat([{ role: 'user', content: prompt }], { json: schema, temperature: 0, signal: opts.signal });
      const parsed = parseJsonLoose<{ risultati?: Array<{ n: number; categoria: string }> }>(text);
      for (const r of parsed?.risultati ?? []) {
        const item = batch[r.n - 1];
        if (!item || !cats.some((c) => c.id === r.categoria) || r.categoria === fallback) continue;
        out.push({ ...item, categoryId: r.categoria });
      }
      processed += batch.length;
      opts.onProgress?.(processed, items.length);
    }
  }
  return out;
}
