import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { db } from '../../database/db';
import { useDataSet } from '../../hooks/useData';
import { AiClient, AiUnavailableError, getAiSettings, type AiSettings } from '../../services/ai/client';
import { buildContext } from '../../services/ai/assistant';
import { buildInsights } from '../../services/ai/insights';
import { AI_TIMEOUT_MS, buildSectionMessages, type ContextBlock } from '../../services/ai/context';
import type { AiConversation, AiMessage } from '../../types';
import { uid } from '../../utils/id';

export type AiStatus = 'checking' | 'online' | 'offline' | 'nomodel';

interface PageContext {
  section: string;
  label: string;
  blocks: () => ContextBlock[];
  /** true = il contesto finanziario personale non serve (es. analisi di un'azienda). */
  skipPersonal?: boolean;
}

interface AiApi {
  open: boolean;
  setOpen: (v: boolean) => void;
  status: AiStatus;
  settings: AiSettings | null;
  conversation: AiConversation | null;
  streaming: string | null;
  busy: boolean;
  error: string | null;
  section: string;
  sectionLabel: string;
  ask: (prompt: string, focus?: string) => Promise<void>;
  stop: () => void;
  newConversation: () => void;
  loadConversation: (c: AiConversation) => void;
  registerPage: (ctx: PageContext | null) => void;
  refreshStatus: () => void;
}

const Ctx = createContext<AiApi | null>(null);

export function AiProvider({ route, children }: { route: string; children: ReactNode }) {
  const ds = useDataSet();
  const dsRef = useRef(ds);
  dsRef.current = ds;
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [status, setStatus] = useState<AiStatus>('checking');
  const [conversation, setConversation] = useState<AiConversation | null>(null);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<PageContext | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refreshStatus = useCallback(async () => {
    const s = await getAiSettings();
    setSettings(s);
    setStatus('checking');
    try {
      const models = await new AiClient(s).listModels();
      setStatus(models.some((m) => m === s.model || m.startsWith(`${s.model}:`)) || s.provider !== 'ollama' ? 'online' : 'nomodel');
    } catch {
      setStatus('offline');
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    const t = window.setInterval(() => void refreshStatus(), 120_000);
    return () => window.clearInterval(t);
  }, [refreshStatus]);

  const section = page?.section ?? route;
  const sectionLabel = page?.label ?? route;

  const persist = useCallback(async (c: AiConversation) => {
    await db.ai_conversations.put(c);
  }, []);

  const ask = useCallback(
    async (prompt: string, focus?: string) => {
      const text = prompt.trim();
      if (!text) return;
      setOpen(true);
      setError(null);
      const s = await getAiSettings();
      setSettings(s);
      const now = new Date().toISOString();
      const userMsg: AiMessage = { role: 'user', content: text, at: now };
      const base: AiConversation =
        conversation && conversation.section.split(':')[0] === section.split(':')[0]
          ? conversation
          : { id: uid(), section, title: text.slice(0, 80), messages: [], createdAt: now, updatedAt: now, model: s.model };
      const conv: AiConversation = { ...base, messages: [...base.messages, userMsg], updatedAt: now };
      setConversation(conv);

      const blocks: ContextBlock[] = [];
      try {
        if (page) blocks.push(...page.blocks());
        const d = dsRef.current;
        if (d && !page?.skipPersonal) blocks.push({ title: 'SITUAZIONE FINANZIARIA PERSONALE', body: buildContext(d, buildInsights(d)) });
      } catch {
        /* contesto parziale: si prosegue con quello disponibile */
      }
      const messages = buildSectionMessages(section, blocks, conv.messages.map((m) => ({ role: m.role, content: m.content })), focus);
      const ac = new AbortController();
      abortRef.current = ac;
      let timedOut = false;
      const timer = window.setTimeout(() => {
        timedOut = true;
        ac.abort();
      }, AI_TIMEOUT_MS);
      setStreaming('');
      try {
        const out = await new AiClient(s).chat(messages, { signal: ac.signal, onToken: (t) => setStreaming(t) });
        const done: AiConversation = { ...conv, messages: [...conv.messages, { role: 'assistant', content: out || '(nessuna risposta)', at: new Date().toISOString() }], updatedAt: new Date().toISOString() };
        setConversation(done);
        await persist(done);
        setStatus('online');
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') setError(timedOut ? `Il modello non ha risposto entro ${AI_TIMEOUT_MS / 1000} secondi.` : 'Risposta interrotta.');
        else if (e instanceof AiUnavailableError) {
          setStatus('offline');
          setError(e.message);
        } else setError((e as Error).message);
        await persist(conv);
      } finally {
        window.clearTimeout(timer);
        abortRef.current = null;
        setStreaming(null);
      }
    },
    [conversation, page, persist, section, settings],
  );

  const openPanel = useCallback(
    (v: boolean) => {
      setOpen(v);
      // le impostazioni del modello possono essere cambiate nel frattempo
      if (v) void refreshStatus();
    },
    [refreshStatus],
  );

  const api = useMemo<AiApi>(
    () => ({
      open,
      setOpen: openPanel,
      status,
      settings,
      conversation,
      streaming,
      busy: streaming !== null,
      error,
      section,
      sectionLabel,
      ask,
      stop: () => abortRef.current?.abort(),
      newConversation: () => {
        setConversation(null);
        setError(null);
      },
      loadConversation: (c) => {
        setConversation(c);
        setOpen(true);
      },
      registerPage: setPage,
      refreshStatus: () => void refreshStatus(),
    }),
    [open, openPanel, status, settings, conversation, streaming, error, section, sectionLabel, ask, refreshStatus],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useAi(): AiApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAi fuori da AiProvider');
  return c;
}

/** Registra il contesto della pagina corrente per il pannello AI. */
export function useAiPage(ctx: PageContext | null, deps: unknown[]): void {
  const ai = useContext(Ctx);
  const register = ai?.registerPage;
  useEffect(() => {
    register?.(ctx);
    return () => register?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register, ...deps]);
}
