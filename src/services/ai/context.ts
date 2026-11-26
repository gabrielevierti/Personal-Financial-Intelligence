/**
 * Contesto per l'AI globale: prompt per sezione, iniezione controllata, limite di dimensione.
 * L'app calcola tutti i numeri; il modello li spiega e basta.
 */
import type { ChatMessage } from './client';

/** Limite del contesto inviato al modello (caratteri, ≈ 4 caratteri per token). */
export const MAX_CONTEXT_CHARS = 14000;
export const AI_TIMEOUT_MS = 120_000;

export const BASE_RULES = `Sei l'assistente di PFI, un'app di finanza personale che gira in locale sul computer dell'utente.
Rispondi in italiano, in modo chiaro e concreto, con frasi brevi ed elenchi puntati quando servono.
Regole obbligatorie:
- Usa SOLO i dati del contesto. Non inventare importi, date, movimenti, prezzi o dati di aziende.
- I numeri del contesto sono calcolati dall'app e sono corretti: riportali così come sono, non rifare i conti e non crearne di nuovi.
- Se mancano dati per rispondere, dillo e indica quali dati servirebbero.
- Distingui sempre fatti (dati del contesto), interpretazioni e ipotesi.
- Non sei un consulente finanziario abilitato: non dare raccomandazioni personalizzate di acquisto o vendita, non promettere rendimenti.`;

export const SECTION_PROMPTS: Record<string, string> = {
  dashboard: 'Sezione: dashboard. Aiuta a capire la situazione complessiva: patrimonio, liquidità, flussi del periodo, previsione di fine mese e insight.',
  accounts: 'Sezione: conti. Spiega saldi e differenze tra i conti.',
  transactions: 'Sezione: movimenti. Aiuta a leggere le spese, le categorie e i movimenti ricorrenti.',
  budgets: 'Sezione: budget. Aiuta a impostare e rispettare i budget per categoria.',
  goals: 'Sezione: obiettivi. Aiuta a pianificare gli obiettivi di risparmio e il fondo di emergenza.',
  investments: 'Sezione: patrimonio e investimenti. Descrivi composizione e concentrazione, senza consigli di acquisto.',
  performance: 'Sezione: performance. Spiega rendimenti e plus/minusvalenze calcolati dall\'app.',
  research: 'Sezione: analisi aziendale. Commenta solo i dati dell\'azienda presenti nel contesto, con fonte e data. Separa la qualità dell\'azienda dall\'attrattività del prezzo.',
  compare: 'Sezione: confronto aziende. Confronta le aziende solo sui dati presenti; segnala periodi o valute diversi.',
  market: 'Sezione: mercati. Descrivi l\'andamento dei titoli presenti; i prezzi possono essere ritardati.',
  simulations: 'Sezione: simulazioni. Spiega l\'impatto dell\'investimento simulato sulla situazione personale usando i numeri calcolati.',
  insights: 'Sezione: financial insights. Spiega e ordina per importanza gli insight calcolati.',
};

/** Tronca il contesto mantenendo l'inizio (le informazioni più importanti vanno messe per prime). */
export function limitContext(text: string, max = MAX_CONTEXT_CHARS): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: `${text.slice(0, max)}\n[…contesto troncato per limiti di dimensione]`, truncated: true };
}

export interface ContextBlock {
  title: string;
  body: string;
}

export function buildSectionMessages(section: string, blocks: ContextBlock[], history: ChatMessage[], focus?: string): ChatMessage[] {
  const sectionKey = section.split(':')[0];
  // il focus del widget va prima: in caso di troncamento resta
  const ordered = focus ? [{ title: 'ELEMENTO SU CUI L\'UTENTE HA CHIESTO SPIEGAZIONI', body: focus }, ...blocks] : blocks;
  const ctx = limitContext(ordered.map((b) => `${b.title}\n${b.body}`).join('\n\n'));
  const system = `${BASE_RULES}\n${SECTION_PROMPTS[sectionKey] ?? ''}\n\nCONTESTO (calcolato da PFI)\n${ctx.text}`;
  return [{ role: 'system', content: system }, ...history.slice(-10)];
}

export const QUICK_SUGGESTIONS: Record<string, string[]> = {
  dashboard: ['Riassumi la mia situazione in 5 punti', 'Perché le uscite di questo mese sono diverse dalla media?', 'Come arrivo a fine mese?', 'Qual è l\'insight più importante?'],
  transactions: ['Quali spese ricorrenti posso ridurre?', 'Dove ho speso di più questo mese?'],
  budgets: ['Proponimi un budget mensile per categoria', 'Quali budget rischio di superare?'],
  goals: ['Quanto devo mettere da parte ogni mese?', 'Il mio fondo di emergenza è adeguato?'],
  investments: ['Com\'è distribuito il mio patrimonio?', 'Ho posizioni troppo concentrate?'],
  research: ['Riassumi i punti di forza e di debolezza', 'Il debito è sostenibile?', 'Quali ipotesi pesano di più sul fair value?'],
  compare: ['Quale azienda ha i margini migliori?', 'Quale è più indebitata?'],
  simulations: ['Che impatto ha questo investimento sul fondo di emergenza?'],
  insights: ['Da quale insight dovrei partire?'],
};
