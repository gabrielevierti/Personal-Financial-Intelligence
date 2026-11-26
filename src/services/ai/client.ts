/**
 * Client per un modello linguistico che gira sul computer dell'utente (Ollama o un server compatibile
 * OpenAI come LM Studio / llama.cpp). Nessun dato esce dal dispositivo: le richieste vanno solo a 127.0.0.1.
 */
import { db } from '../../database/db';

export type AiProvider = 'ollama' | 'openai';

export interface AiSettings {
  provider: AiProvider;
  baseUrl: string;
  model: string;
}

export const DEFAULT_AI: AiSettings = { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:3b' };

export const RECOMMENDED_MODELS: Array<{ id: string; note: string }> = [
  { id: 'qwen2.5:3b', note: 'consigliato: buon italiano, veloce su Apple Silicon (circa 2 GB)' },
  { id: 'qwen2.5:1.5b', note: 'il più veloce, meno preciso (circa 1 GB)' },
  { id: 'qwen3:4b', note: 'ragionamento migliore, più lento (circa 2,5 GB)' },
];

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class AiUnavailableError extends Error {
  constructor(settings: AiSettings) {
    super(
      settings.provider === 'ollama'
        ? `Ollama non risponde su ${settings.baseUrl}. Avvia l'app Ollama (o "ollama serve") e riprova.`
        : `Il server del modello non risponde su ${settings.baseUrl}. Avvialo e riprova.`,
    );
    this.name = 'AiUnavailableError';
  }
}

export async function getAiSettings(): Promise<AiSettings> {
  const v = (await db.settings.get('ai'))?.value as Partial<AiSettings> | undefined;
  return { ...DEFAULT_AI, ...(v ?? {}) };
}

export async function saveAiSettings(s: AiSettings): Promise<void> {
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(s.baseUrl.trim())) throw new Error('Per la privacy sono ammessi solo indirizzi locali (127.0.0.1 o localhost).');
  await db.settings.put({ key: 'ai', value: { ...s, baseUrl: s.baseUrl.trim().replace(/\/$/, '') } });
}

/** Rimuove eventuali blocchi di ragionamento (<think>…</think>) dei modelli che li emettono. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trimStart();
}

export class AiClient {
  constructor(
    public readonly settings: AiSettings,
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  private url(path: string) {
    return `${this.settings.baseUrl.replace(/\/$/, '')}${path}`;
  }

  private async call(path: string, init?: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.url(path), init);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e;
      throw new AiUnavailableError(this.settings);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let msg = text;
      try {
        msg = JSON.parse(text).error?.message ?? JSON.parse(text).error ?? text;
      } catch {
        /* testo semplice */
      }
      if (res.status === 404 && /model/i.test(String(msg))) throw new Error(`Modello "${this.settings.model}" non installato. Esegui: ollama pull ${this.settings.model}`);
      if (res.status === 403) throw new Error('Il server del modello ha rifiutato la richiesta (CORS). Con Ollama apri PFI da localhost o 127.0.0.1, oppure imposta OLLAMA_ORIGINS.');
      throw new Error(`Errore del modello (${res.status}): ${String(msg).slice(0, 200)}`);
    }
    return res;
  }

  async listModels(): Promise<string[]> {
    if (this.settings.provider === 'ollama') {
      const r = await (await this.call('/api/tags')).json();
      return (r.models ?? []).map((m: { name: string }) => m.name);
    }
    const r = await (await this.call('/v1/models')).json();
    return (r.data ?? []).map((m: { id: string }) => m.id);
  }

  /**
   * Chat in streaming. `onToken` riceve il testo accumulato (senza blocchi di ragionamento).
   * `json` chiede una risposta JSON (con schema, per Ollama).
   */
  async chat(messages: ChatMessage[], opts: { onToken?: (full: string) => void; signal?: AbortSignal; json?: object; temperature?: number } = {}): Promise<string> {
    const { onToken, signal, json, temperature = 0.3 } = opts;
    const ollama = this.settings.provider === 'ollama';
    const body = ollama
      ? { model: this.settings.model, messages, stream: true, options: { temperature, num_ctx: 8192 }, ...(json ? { format: json } : {}) }
      : { model: this.settings.model, messages, stream: true, temperature, ...(json ? { response_format: { type: 'json_object' } } : {}) };
    const res = await this.call(ollama ? '/api/chat' : '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    const reader = res.body?.getReader();
    if (!reader) throw new Error('Risposta del modello non leggibile.');
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    const handleLine = (line: string) => {
      const l = line.trim();
      if (!l) return;
      if (ollama) {
        const j = JSON.parse(l);
        if (j.error) throw new Error(j.error);
        full += j.message?.content ?? '';
      } else {
        if (!l.startsWith('data:')) return;
        const data = l.slice(5).trim();
        if (data === '[DONE]') return;
        full += JSON.parse(data).choices?.[0]?.delta?.content ?? '';
      }
      onToken?.(stripThinking(full));
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) handleLine(line);
    }
    if (buffer.trim()) handleLine(buffer);
    return stripThinking(full);
  }
}

/** Estrae il primo oggetto JSON valido da una risposta (i modelli piccoli a volte aggiungono testo). */
export function parseJsonLoose<T>(text: string): T | null {
  const clean = stripThinking(text).replace(/```(json)?/g, '');
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(clean.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
