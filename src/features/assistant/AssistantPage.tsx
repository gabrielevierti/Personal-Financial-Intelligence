import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Bot, CalendarClock, Cpu, RefreshCw, Send, Sparkles, Square, Tags, TrendingUp } from 'lucide-react';
import { db } from '../../database/db';
import { useDataSet } from '../../hooks/useData';
import { errorMessage, useToast } from '../../hooks/useToast';
import { AiClient, DEFAULT_AI, RECOMMENDED_MODELS, saveAiSettings, type AiProvider, type AiSettings, type ChatMessage } from '../../services/ai/client';
import { buildInsights } from '../../services/ai/insights';
import { buildContext, buildMessages, categorizeWithAi, SUGGESTED_QUESTIONS, uncategorizedMerchants, type AiCategorySuggestion } from '../../services/ai/assistant';
import { applyCategoryToMerchant } from '../../services/categorize';
import { formatDate, formatMonth } from '../../utils/date';
import { formatMoney } from '../../utils/money';
import { Modal } from '../../components/ui/Modal';
import { Callout, EmptyState, PageSkeleton, ProgressBar } from '../../components/ui/States';
import { RichText } from '../../components/ai/RichText';
import { ConversationHistory } from './ConversationHistory';

type Status = { state: 'checking' } | { state: 'ok'; models: string[] } | { state: 'error'; message: string };

export function AssistantPage() {
  const ds = useDataSet();
  const toast = useToast();
  const stored = useLiveQuery(async () => ((await db.settings.get('ai'))?.value as Partial<AiSettings> | undefined) ?? {}, []);
  const settings: AiSettings = useMemo(() => ({ ...DEFAULT_AI, ...(stored ?? {}) }), [stored]);
  const client = useMemo(() => new AiClient(settings), [settings]);
  const [status, setStatus] = useState<Status>({ state: 'checking' });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [aiCats, setAiCats] = useState<{ running: boolean; done: number; total: number; suggestions: AiCategorySuggestion[] | null }>({ running: false, done: 0, total: 0, suggestions: null });
  const bottom = useRef<HTMLDivElement>(null);

  const check = useCallback(async () => {
    setStatus({ state: 'checking' });
    try {
      setStatus({ state: 'ok', models: await client.listModels() });
    } catch (e) {
      setStatus({ state: 'error', message: errorMessage(e) });
    }
  }, [client]);

  useEffect(() => {
    if (stored !== undefined) void check();
  }, [check, stored]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages]);

  const insights = useMemo(() => (ds ? buildInsights(ds) : null), [ds]);
  const context = useMemo(() => (ds && insights ? buildContext(ds, insights) : ''), [ds, insights]);
  const uncategorized = useMemo(() => (ds ? uncategorizedMerchants(ds.transactions) : []), [ds]);

  if (!ds || !insights || stored === undefined) return <PageSkeleton />;
  const cur = insights.currency;
  const f = insights.forecast;
  const ready = status.state === 'ok' && status.models.includes(settings.model);
  const modelMissing = status.state === 'ok' && !status.models.includes(settings.model);

  const ask = async (question: string) => {
    if (!question.trim() || streaming) return;
    const history: ChatMessage[] = [...messages, { role: 'user', content: question.trim() }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setDraft('');
    setStreaming(true);
    abort.current = new AbortController();
    try {
      await client.chat(buildMessages(context, history), {
        signal: abort.current.signal,
        onToken: (full) => setMessages([...history, { role: 'assistant', content: full }]),
      });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setMessages(history);
        toast.error(e);
      }
    } finally {
      setStreaming(false);
      abort.current = null;
    }
  };

  const runAiCategorization = async () => {
    setAiCats({ running: true, done: 0, total: uncategorized.length, suggestions: null });
    try {
      const suggestions = await categorizeWithAi(client, uncategorized.slice(0, 200), ds.categories, {
        onProgress: (done, total) => setAiCats((s) => ({ ...s, done, total })),
      });
      setAiCats({ running: false, done: 0, total: 0, suggestions });
      if (!suggestions.length) toast.info('Il modello non ha proposto categorie con sufficiente sicurezza.');
    } catch (e) {
      setAiCats({ running: false, done: 0, total: 0, suggestions: null });
      toast.error(e);
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>AI Assistant</h1>
          <p>Cronologia delle conversazioni e analisi approfondite. Per domande veloci usa il pannello AI dall'header: segue la pagina in cui sei. Il modello gira sul tuo computer.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => setShowSettings(true)}>
            <Cpu size={15} /> Modello: {settings.model}
          </button>
        </div>
      </div>

      <ConversationHistory />

      <section className="panel" style={{ marginBottom: 16 }} data-testid="ai-status">
        <div className="spread" style={{ flexWrap: 'wrap' }}>
          <div className="row">
            <span className={`status-dot ${ready ? 'ok' : status.state === 'checking' ? '' : 'warn'}`} aria-hidden="true" />
            <div>
              <div className="item-title">
                {status.state === 'checking' ? 'Verifica del modello locale…' : ready ? `Pronto · ${settings.model}` : modelMissing ? `Modello ${settings.model} non installato` : 'Modello locale non raggiungibile'}
              </div>
              <div className="small muted">
                {settings.provider === 'ollama' ? 'Ollama' : 'Server compatibile OpenAI'} su {settings.baseUrl}
                {status.state === 'error' && ` · ${status.message}`}
                {modelMissing && status.models.length > 0 && ` · installati: ${status.models.slice(0, 4).join(', ')}`}
              </div>
            </div>
          </div>
          <button className="btn btn-sm" onClick={check}>
            <RefreshCw size={13} /> Ricontrolla
          </button>
        </div>
        {!ready && status.state !== 'checking' && (
          <ol className="small setup-steps">
            <li>
              Installa <strong>Ollama</strong> da ollama.com e aprilo (resta nella barra dei menu).
            </li>
            <li>
              Nel Terminale scarica il modello: <code>ollama pull {settings.model}</code>
            </li>
            <li>Premi Ricontrolla. Le analisi qui sotto funzionano anche senza modello.</li>
          </ol>
        )}
      </section>

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <section className="panel" data-testid="forecast">
          <div className="panel-head">
            <h2>
              <TrendingUp size={15} className="head-icon" /> Previsione di {formatMonth(f.month, true)}
            </h2>
            <span className="hint">
              giorno {f.dayOfMonth}/{f.daysInMonth}
            </span>
          </div>
          <dl className="kv">
            <dt>Uscite finora</dt>
            <dd>{formatMoney(f.expenseSoFar, cur)}</dd>
            <dt>Ricorrenti ancora attese</dt>
            <dd>{formatMoney(f.expectedRecurringExpense, cur)}</dd>
            <dt>Spese variabili stimate</dt>
            <dd>{formatMoney(f.expectedVariableExpense, cur)}</dd>
            <dt>
              <strong>Uscite a fine mese</strong>
            </dt>
            <dd>
              <strong>{formatMoney(f.projectedExpense, cur)}</strong>
            </dd>
            <dt>Entrate previste</dt>
            <dd>{formatMoney(f.projectedIncome, cur)}</dd>
            <dt>
              <strong>Risparmio previsto</strong>
            </dt>
            <dd className={f.projectedNet >= 0 ? 'pos' : 'neg'}>
              <strong>{formatMoney(f.projectedNet, cur, { sign: true })}</strong>
            </dd>
          </dl>
          <p className="xs muted" style={{ marginTop: 10 }}>
            Media degli ultimi 3 mesi: entrate {formatMoney(insights.avgMonthlyIncome, cur)}, uscite {formatMoney(insights.avgMonthlyExpense, cur)}. Patrimonio stimato a fine anno: <strong>{formatMoney(insights.netWorthEndOfYear, cur)}</strong>.
          </p>
        </section>

        <section className="panel" data-testid="recurring">
          <div className="panel-head">
            <h2>
              <CalendarClock size={15} className="head-icon" /> Ricorrenti
            </h2>
            <span className="hint">{insights.recurring.length} rilevati</span>
          </div>
          {insights.recurring.length === 0 ? (
            <p className="small muted">Servono almeno 3 mesi di movimenti per riconoscere abbonamenti e pagamenti fissi.</p>
          ) : (
            <div className="mini-list">
              {insights.recurring.slice(0, 8).map((r) => (
                <div key={`${r.kind}${r.merchant}`} className="mini-row">
                  <span className="mini-name" title={r.description}>
                    {r.merchant}
                    <span className="xs muted"> · {r.chargedThisMonth ? 'già addebitato' : `atteso il ${formatDate(r.nextExpected)}`}</span>
                  </span>
                  <span className={`num ${r.kind === 'income' ? 'pos' : ''}`}>{formatMoney(r.kind === 'income' ? r.amount : -r.amount, cur)}</span>
                </div>
              ))}
            </div>
          )}
          {insights.subscriptionsMonthly > 0 && (
            <p className="xs muted" style={{ marginTop: 10 }}>
              Abbonamenti: {formatMoney(insights.subscriptionsMonthly, cur)} al mese, {formatMoney(insights.subscriptionsMonthly * 12, cur)} l'anno.
            </p>
          )}
        </section>

        <section className="panel" data-testid="ai-categorize">
          <div className="panel-head">
            <h2>
              <Tags size={15} className="head-icon" /> Categorie con l'AI
            </h2>
          </div>
          <p className="small muted" style={{ marginBottom: 12 }}>
            {uncategorized.length === 0
              ? 'Tutti i movimenti hanno una categoria.'
              : `${uncategorized.length} esercenti sono ancora in "Altre spese/entrate". Il modello propone una categoria per ciascuno: decidi tu cosa applicare.`}
          </p>
          {aiCats.running ? (
            <div className="stack" style={{ gap: 6 }}>
              <ProgressBar value={aiCats.total ? aiCats.done / aiCats.total : 0} label="Categorizzazione in corso" />
              <span className="xs muted">
                {aiCats.done} di {aiCats.total}…
              </span>
            </div>
          ) : (
            <button className="btn" disabled={!ready || uncategorized.length === 0} onClick={runAiCategorization}>
              <Sparkles size={14} /> Proponi categorie
            </button>
          )}
        </section>
      </div>

      <section className="panel chat" data-testid="chat">
        <div className="panel-head">
          <h2>
            <Bot size={15} className="head-icon" /> Chiedi all'assistente
          </h2>
          {messages.length > 0 && (
            <button className="btn btn-sm btn-ghost" onClick={() => setMessages([])} disabled={streaming}>
              Nuova conversazione
            </button>
          )}
        </div>
        {messages.length === 0 ? (
          <EmptyState compact icon={<Bot size={20} />} title="Fai una domanda sulle tue finanze" text="L'assistente vede un riepilogo dei tuoi conti, delle spese e delle previsioni calcolate qui sopra.">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button key={q} className="btn btn-sm" disabled={!ready} onClick={() => ask(q)}>
                {q}
              </button>
            ))}
          </EmptyState>
        ) : (
          <div className="messages" aria-live="polite">
            {messages.map((m, i) => (
              <div key={i} className={`msg msg-${m.role}`}>
                {m.role === 'assistant' ? m.content ? <RichText text={m.content} /> : <span className="typing" aria-label="Sto scrivendo" /> : <p>{m.content}</p>}
              </div>
            ))}
            <div ref={bottom} />
          </div>
        )}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(draft);
          }}
        >
          <label className="sr-only" htmlFor="ai-q">
            Domanda
          </label>
          <input id="ai-q" className="input" placeholder={ready ? 'Es. come posso spendere meno al ristorante?' : 'Configura il modello locale per chattare'} value={draft} onChange={(e) => setDraft(e.target.value)} disabled={!ready} />
          {streaming ? (
            <button type="button" className="btn" onClick={() => abort.current?.abort()}>
              <Square size={14} /> Ferma
            </button>
          ) : (
            <button type="submit" className="btn btn-primary" disabled={!ready || !draft.trim()}>
              <Send size={14} /> Invia
            </button>
          )}
        </form>
        <details className="context">
          <summary className="xs muted">Cosa vede il modello</summary>
          <pre>{context}</pre>
        </details>
      </section>

      {showSettings && <AiSettingsModal settings={settings} models={status.state === 'ok' ? status.models : []} onClose={() => setShowSettings(false)} />}
      {aiCats.suggestions && aiCats.suggestions.length > 0 && (
        <AiCategoryReview
          suggestions={aiCats.suggestions}
          onClose={() => setAiCats((s) => ({ ...s, suggestions: null }))}
          onApply={async (chosen) => {
            let n = 0;
            for (const s of chosen) n += (await applyCategoryToMerchant(s.example, s.kind, s.categoryId, 'ai')) + 0;
            toast.success(`Categorie applicate a ${chosen.length} esercenti (${n} movimenti aggiornati). Verranno usate anche per i movimenti futuri.`);
            setAiCats((s) => ({ ...s, suggestions: null }));
          }}
        />
      )}
    </div>
  );
}

function AiSettingsModal({ settings, models, onClose }: { settings: AiSettings; models: string[]; onClose: () => void }) {
  const toast = useToast();
  const [s, setS] = useState(settings);
  const options = Array.from(new Set([...models, ...RECOMMENDED_MODELS.map((m) => m.id), s.model]));
  return (
    <Modal
      title="Modello locale"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Annulla
          </button>
          <button
            className="btn btn-primary"
            onClick={async () => {
              try {
                await saveAiSettings(s);
                toast.success('Impostazioni del modello salvate.');
                onClose();
              } catch (e) {
                toast.error(e);
              }
            }}
          >
            Salva
          </button>
        </>
      }
    >
      <div className="form">
        <div className="form-row">
          <div className="field">
            <label htmlFor="ai-prov">Server</label>
            <select
              id="ai-prov"
              className="select"
              value={s.provider}
              onChange={(e) => {
                const provider = e.target.value as AiProvider;
                setS({ ...s, provider, baseUrl: provider === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:1234' });
              }}
            >
              <option value="ollama">Ollama</option>
              <option value="openai">Compatibile OpenAI (LM Studio, llama.cpp)</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="ai-url">Indirizzo</label>
            <input id="ai-url" className="input" value={s.baseUrl} onChange={(e) => setS({ ...s, baseUrl: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="ai-model">Modello</label>
          <select id="ai-model" className="select" value={s.model} onChange={(e) => setS({ ...s, model: e.target.value })}>
            {options.map((m) => (
              <option key={m} value={m}>
                {m}
                {models.includes(m) ? ' · installato' : ''}
              </option>
            ))}
          </select>
          <span className="help">{RECOMMENDED_MODELS.find((m) => m.id === s.model)?.note ?? 'Modelli consigliati: qwen2.5:3b (equilibrio), qwen2.5:1.5b (velocità), qwen3:4b (qualità).'}</span>
        </div>
        <Callout>Sono ammessi solo indirizzi locali: le richieste al modello non escono dal tuo computer.</Callout>
      </div>
    </Modal>
  );
}

function AiCategoryReview({ suggestions, onClose, onApply }: { suggestions: AiCategorySuggestion[]; onClose: () => void; onApply: (chosen: AiCategorySuggestion[]) => Promise<void> }) {
  const ds = useDataSet();
  const [rows, setRows] = useState(suggestions.map((s) => ({ ...s, accept: true })));
  const [busy, setBusy] = useState(false);
  if (!ds) return null;
  const accepted = rows.filter((r) => r.accept);
  return (
    <Modal
      title="Categorie proposte dall'AI"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Annulla
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || accepted.length === 0}
            onClick={async () => {
              setBusy(true);
              await onApply(accepted);
              setBusy(false);
            }}
          >
            Applica {accepted.length} categorie
          </button>
        </>
      }
    >
      <p className="small muted" style={{ marginBottom: 12 }}>
        Controlla le proposte: puoi cambiare la categoria o escludere un esercente. Quelle applicate diventano regole e valgono anche per i movimenti futuri.
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <span className="sr-only">Applica</span>
              </th>
              <th>Esercente</th>
              <th className="right">Movimenti</th>
              <th>Categoria</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.kind}${r.merchant}`}>
                <td>
                  <input type="checkbox" checked={r.accept} aria-label={`Applica a ${r.merchant}`} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, accept: e.target.checked } : x)))} />
                </td>
                <td>
                  <div className="item-title">{r.merchant}</div>
                  <div className="xs muted cell-desc">{r.example}</div>
                </td>
                <td className="right num">{r.count}</td>
                <td>
                  <select className="select" style={{ height: 30, fontSize: 13 }} value={r.categoryId} aria-label={`Categoria per ${r.merchant}`} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, categoryId: e.target.value } : x)))}>
                    {ds.categories
                      .filter((c) => c.kind === r.kind)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
