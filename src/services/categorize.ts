/**
 * Categorizzazione automatica dei movimenti, deterministica e locale.
 * Ordine di priorità:
 *  1. regole dell'utente (o confermate dall'AI) per esercente;
 *  2. categorie già assegnate in passato allo stesso esercente;
 *  3. regole integrate per esercenti e parole chiave italiane;
 *  4. "Altre spese" / "Altre entrate".
 */
import { db } from '../database/db';
import { FALLBACK_CATEGORY } from '../database/seed';
import type { Category, CategoryKind, CategoryRule, Transaction } from '../types';
import { uid } from '../utils/id';
import { normalizeText } from '../utils/text';
import { merchantKey } from './merchant';

type Rule = [RegExp, string];

/** Regole integrate: espressioni sul testo normalizzato (minuscolo, senza accenti e punteggiatura). */
export const BUILTIN_EXPENSE_RULES: Rule[] = [
  // acquisti di titoli e piani di accumulo (Trade Republic, Fineco, Directa…): investimento, non spesa
  [/\b(buy trade|savings plan|sparplan|piano di accumulo|pac etf|esecuzione piano|acquisto titoli|compravendita titoli acquisto|eseguito acquisto|ordine di acquisto|kauf|purchase of securities|crypto purchase)\b/, 'inv-buy'],
  [/\b(affitto|canone locazione|condominio|amministrazione condominio|mutuo|rata mutuo)\b/, 'exp-home'],
  [/\b(esselunga|conad|coop|ipercoop|carrefour|lidl|eurospin|pam|panorama|despar|spar|interspar|unes|tigros|bennet|penny|md discount|aldi|naturasi|famila|crai|sigma|todis|basko|il gigante|simply|auchan|tuodi|u2 supermercato|supermercato|supermercati|alimentari|macelleria|panificio|panetteria|fruttivendolo|ortofrutta|pescheria|carrefour express|in s mercato|lillapois|iper)\b/, 'exp-groceries'],
  [/\b(ristorante|ristor|trattoria|osteria|pizzeria|pizza|sushi|bar|caffe|caffetteria|pasticceria|gelateria|bistrot|pub|burger|mcdonald|mcdonalds|burger king|kfc|starbucks|deliveroo|glovo|just eat|justeat|uber eats|poke|kebab|braceria|tavola calda|autogrill|spizzico|old wild west|roadhouse|briciole|panino|piadineria|ramen|hamburgeria|enoteca|birreria|cocktail|lounge|aperitivo)\b/, 'exp-restaurants'],
  [/\b(enel|a2a|edison|hera|iren|plenitude|eni gas|acea|sorgenia|engie|iberdrola|illumia|fastweb|tim|telecom|vodafone|windtre|wind tre|iliad|ho mobile|very mobile|kena|postemobile|poste mobile|bolletta|metropolitana milanese|servizio idrico|gas|luce|tari|linkem|eolo)\b/, 'exp-bills'],
  [/\b(eni|q8|esso|tamoil|shell|agip|benzina|carburante|carburanti|distributore|atm milano|atm|trenord|trenitalia|italo|frecciarossa|uber|free now|freenow|itaxi|taxi|telepass|autostrade|autostrada|pedaggio|parcheggio|parking|easypark|enjoy|share now|cooltra|lime|bird|bolt|movo|flixbus|bus|metro|ricarica auto|tesla supercharger|enel x way)\b/, 'exp-transport'],
  [/\b(netflix|spotify|disney|amazon prime|prime video|apple com bill|apple com|itunes|icloud|google storage|google one|youtube premium|youtube|dazn|now tv|nowtv|sky|paramount|chatgpt|openai|anthropic|claude ai|github|adobe|microsoft 365|office 365|dropbox|notion|playstation plus|xbox game pass|nintendo|audible|kindle unlimited|patreon|virgin active|mcfit|fit active|anytime fitness|palestra|abbonamento)\b/, 'exp-subscriptions'],
  [/\b(ryanair|easyjet|wizz|ita airways|alitalia|vueling|volotea|lufthansa|emirates|klm|air france|booking com|booking|airbnb|expedia|hotel|trivago|ostello|b b|aeroporto|aeroporti|sea aeroporti)\b/, 'exp-travel'],
  [/\b(farmacia|parafarmacia|medico|dentista|odontoiatr\w*|ospedale|ticket sanitario|asl|ats|analisi cliniche|laboratorio analisi|ottica|clinica|centro medico|poliambulatorio|psicolog\w*|fisioterap\w*|veterinari\w*)\b/, 'exp-health'],
  [/\b(assicurazion\w*|unipol|unipolsai|generali|allianz|axa|zurich|reale mutua|cattolica|prima assicurazioni|genertel|linear|verti|conte it|quixa)\b/, 'exp-insurance'],
  [/\b(f24|agenzia entrate|agenzia delle entrate|tributi|imposta|imposte|bollo auto|pagopa|inps|comune di|multa|sanzione|canone rai|irpef|imu)\b/, 'exp-taxes'],
  [/\b(cinema|uci|the space|ticketone|ticketmaster|vivaticket|teatro|museo|concerto|steam|epic games|playstation store|bowling|escape room|gardaland|mirabilandia|libreria|feltrinelli|mondadori)\b/, 'exp-entertainment'],
  [/\b(amazon|amzn|zalando|shein|ikea|decathlon|zara|hm|primark|mediaworld|unieuro|euronics|apple store|leroy merlin|bricoman|obi|tigota|acqua e sapone|sephora|douglas|ovs|uniqlo|nike|adidas|ebay|aliexpress|temu|vinted|subito|bershka|pull bear|stradivarius|mango|calzedonia|intimissimi|tezenis|foot locker|game stop|gamestop)\b/, 'exp-shopping'],
];

export const BUILTIN_INCOME_RULES: Rule[] = [
  [/\b(sell trade|vendita titoli|eseguita vendita|ordine di vendita|verkauf|sale of securities|crypto sale)\b/, 'inv-sell'],
  [/\b(stipendio|emolumenti|emolumento|noipa|retribuzione|salario|busta paga|accredito competenze|tredicesima|quattordicesima|ministero|dipartimento pubblica sicurezza|tesoreria)\b/, 'inc-salary'],
  [/\b(interessi|competenze di chiusura|cedola|cedole|dividendo|dividendi|interest)\b/, 'inc-interest'],
  [/\b(rimborso|storno|refund|reso|cashback|saveback|chargeback)\b/, 'inc-refund'],
  [/\b(apple distribution|app store|compenso|prestazione|parcella|diritti d autore|royalt\w*|paypal fattura|fattura n)\b/, 'inc-freelance'],
  [/\b(affitto ricevuto|canone attivo|locazione)\b/, 'inc-rent'],
];

export function builtinCategory(description: string, kind: CategoryKind): string | null {
  const text = normalizeText(description);
  for (const [re, cat] of kind === 'expense' ? BUILTIN_EXPENSE_RULES : BUILTIN_INCOME_RULES) if (re.test(text)) return cat;
  return null;
}

export type CategorySource = 'rule' | 'learned' | 'builtin' | 'fallback';

export interface Categorizer {
  categorize(description: string, kind: CategoryKind): { categoryId: string; source: CategorySource };
}

export function isFallback(categoryId: string | null): boolean {
  return categoryId === null || categoryId === FALLBACK_CATEGORY.expense || categoryId === FALLBACK_CATEGORY.income;
}

/** Costruisce un categorizzatore a partire da regole, storico e categorie esistenti (funzione pura). */
export function buildCategorizer(rules: CategoryRule[], history: Transaction[], categories: Category[]): Categorizer {
  const valid = new Map(categories.map((c) => [c.id, c]));
  const ruleMap = new Map<string, string>();
  for (const r of [...rules].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (valid.get(r.categoryId)?.kind === r.kind) ruleMap.set(`${r.kind}|${r.pattern}`, r.categoryId);
  }
  // storico: per ogni esercente, la categoria non generica più usata
  const counts = new Map<string, Map<string, number>>();
  for (const t of history) {
    if (t.type === 'transfer' || isFallback(t.categoryId) || t.pending) continue;
    const key = `${t.type}|${merchantKey(t.description)}`;
    const m = counts.get(key) ?? new Map<string, number>();
    m.set(t.categoryId!, (m.get(t.categoryId!) ?? 0) + 1);
    counts.set(key, m);
  }
  const learned = new Map<string, string>();
  for (const [key, m] of counts) learned.set(key, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);

  return {
    categorize(description, kind) {
      const mk = merchantKey(description);
      const ruled = ruleMap.get(`${kind}|${mk}`);
      if (ruled) return { categoryId: ruled, source: 'rule' };
      const hist = learned.get(`${kind}|${mk}`);
      if (hist && valid.get(hist)?.kind === kind) return { categoryId: hist, source: 'learned' };
      const builtin = builtinCategory(description, kind);
      if (builtin && valid.has(builtin)) return { categoryId: builtin, source: 'builtin' };
      return { categoryId: FALLBACK_CATEGORY[kind], source: 'fallback' };
    },
  };
}

export async function loadCategorizer(): Promise<Categorizer> {
  const [rules, history, categories] = await Promise.all([db.category_rules.toArray(), db.transactions.toArray(), db.categories.toArray()]);
  return buildCategorizer(rules, history, categories);
}

/** Assegna una categoria ai movimenti ancora in "Altre spese/entrate". Non tocca le scelte dell'utente. */
export async function recategorizeUncategorized(): Promise<number> {
  const c = await loadCategorizer();
  const targets = await db.transactions.filter((t) => t.type !== 'transfer' && isFallback(t.categoryId)).toArray();
  let changed = 0;
  await db.transaction('rw', db.transactions, async () => {
    for (const t of targets) {
      const kind = t.type as CategoryKind;
      const r = c.categorize(t.description, kind);
      if (r.source !== 'fallback' && r.categoryId !== t.categoryId) {
        await db.transactions.update(t.id, { categoryId: r.categoryId });
        changed++;
      }
    }
  });
  return changed;
}

/** Quanti movimenti dello stesso tipo hanno lo stesso esercente. */
export function similarTransactions(all: Transaction[], tx: Pick<Transaction, 'id' | 'description' | 'type'>): Transaction[] {
  const mk = merchantKey(tx.description);
  return all.filter((t) => t.id !== tx.id && t.type === tx.type && merchantKey(t.description) === mk);
}

/**
 * Ricorda la scelta: crea (o aggiorna) la regola per l'esercente e applica la categoria
 * a tutti i movimenti simili. Restituisce quanti movimenti sono stati aggiornati.
 */
export async function applyCategoryToMerchant(description: string, kind: CategoryKind, categoryId: string, source: 'user' | 'ai' = 'user'): Promise<number> {
  const pattern = merchantKey(description);
  if (!pattern) return 0;
  let updated = 0;
  await db.transaction('rw', db.category_rules, db.transactions, async () => {
    const existing = await db.category_rules.where('[pattern+kind]').equals([pattern, kind]).first();
    if (existing) await db.category_rules.update(existing.id, { categoryId, source, createdAt: new Date().toISOString() });
    else await db.category_rules.add({ id: uid(), pattern, kind, categoryId, source, createdAt: new Date().toISOString() });
    const same = await db.transactions.filter((t) => t.type === kind && t.categoryId !== categoryId && merchantKey(t.description) === pattern).toArray();
    for (const t of same) await db.transactions.update(t.id, { categoryId });
    updated = same.length;
  });
  return updated;
}

export async function deleteRule(id: string): Promise<void> {
  await db.category_rules.delete(id);
}
