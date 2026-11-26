import { useEffect, useRef, useState } from 'react';
import { History, MessageSquarePlus, RefreshCw, Send, Sparkles, Square, X } from 'lucide-react';
import { QUICK_SUGGESTIONS } from '../../services/ai/context';
import { useAi, type AiStatus } from './AiProvider';
import { RichText } from './RichText';

const STATUS_LABEL: Record<AiStatus, string> = {
  checking: 'Verifica in corso',
  online: 'Modello locale attivo',
  offline: 'Servizio locale non raggiungibile',
  nomodel: 'Modello non installato',
};

export function AiStatusDot({ status }: { status: AiStatus }) {
  return <span className={`ai-dot ai-dot-${status}`} aria-hidden="true" />;
}

/** Pulsante dell'header: apre il pannello e mostra lo stato del servizio locale. */
export function AiHeaderButton() {
  const ai = useAi();
  return (
    <button
      className={`btn ai-header-btn${ai.open ? ' is-active' : ''}`}
      onClick={() => ai.setOpen(!ai.open)}
      aria-expanded={ai.open}
      aria-controls="ai-panel"
      title={`${STATUS_LABEL[ai.status]}${ai.settings ? ` · ${ai.settings.model}` : ''}`}
      data-testid="ai-toggle"
    >
      <Sparkles size={15} />
      <span className="hide-mobile">AI</span>
      <AiStatusDot status={ai.status} />
    </button>
  );
}

/** Pulsante "Chiedi all'AI" per un singolo widget o KPI: passa al modello il dato su cui si chiede. */
export function AiButton({ prompt, focus, label = 'Chiedi all\'AI' }: { prompt: string; focus: string; label?: string }) {
  const ai = useAi();
  return (
    <button
      type="button"
      className="ai-mini"
      onClick={(e) => {
        e.stopPropagation();
        void ai.ask(prompt, focus);
      }}
      disabled={ai.busy}
      aria-label={`${label}: ${prompt}`}
      title={label}
    >
      <Sparkles size={13} />
    </button>
  );
}

export function AiPanel() {
  const ai = useAi();
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const messages = ai.conversation?.messages ?? [];
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, ai.streaming]);
  useEffect(() => {
    if (!ai.open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && ai.setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ai]);
  if (!ai.open) return null;
  const suggestions = QUICK_SUGGESTIONS[ai.section.split(':')[0]] ?? QUICK_SUGGESTIONS.dashboard;
  const send = () => {
    const t = input;
    setInput('');
    void ai.ask(t);
  };
  return (
    <aside id="ai-panel" className="ai-panel" aria-label="Assistente AI" data-testid="ai-panel">
      <div className="ai-panel-head">
        <div>
          <div className="ai-panel-title">
            <Sparkles size={15} /> Assistente
          </div>
          <div className="xs muted row" style={{ gap: 6 }}>
            <AiStatusDot status={ai.status} />
            {STATUS_LABEL[ai.status]}
            {ai.settings && <span className="num">· {ai.settings.model}</span>}
          </div>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <button className="btn btn-ghost icon-btn" onClick={ai.refreshStatus} aria-label="Verifica di nuovo il servizio" title="Verifica il servizio">
            <RefreshCw size={15} />
          </button>
          <a className="btn btn-ghost icon-btn" href="#/assistant" aria-label="Cronologia delle conversazioni" title="Cronologia">
            <History size={15} />
          </a>
          <button className="btn btn-ghost icon-btn" onClick={ai.newConversation} disabled={ai.busy} aria-label="Nuova conversazione" title="Nuova conversazione">
            <MessageSquarePlus size={15} />
          </button>
          <button className="btn btn-ghost icon-btn" onClick={() => ai.setOpen(false)} aria-label="Chiudi il pannello">
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="ai-panel-context xs muted">
        Contesto: <strong>{ai.sectionLabel}</strong>. I numeri li calcola PFI; il modello li spiega. Tutto resta sul tuo computer.
      </div>
      <div className="ai-panel-body">
        {ai.status === 'offline' && (
          <div className="callout warning small">
            Il servizio AI locale non risponde. Avvia Ollama (<code>ollama serve</code>) e scarica il modello (<code>ollama pull {ai.settings?.model ?? 'qwen2.5:3b'}</code>), poi premi Verifica.
          </div>
        )}
        {ai.status === 'nomodel' && <div className="callout warning small">Ollama è attivo ma il modello {ai.settings?.model} non è installato: <code>ollama pull {ai.settings?.model}</code></div>}
        {messages.length === 0 && (
          <div className="ai-suggestions">
            <p className="small muted">Domande rapide per questa sezione</p>
            {suggestions.map((q) => (
              <button key={q} className="chip" onClick={() => void ai.ask(q)} disabled={ai.busy}>
                {q}
              </button>
            ))}
          </div>
        )}
        <div className="chat">
          <div className="messages">
            {messages.map((m, i) => (
              <div key={i} className={`msg msg-${m.role}`}>
                {m.role === 'assistant' ? <RichText text={m.content} /> : m.content}
              </div>
            ))}
            {ai.streaming !== null && (
              <div className="msg msg-assistant" aria-live="polite">
                {ai.streaming ? <RichText text={ai.streaming} /> : <span className="muted">Sto pensando…</span>}
              </div>
            )}
            {ai.error && <div className="callout danger small">{ai.error}</div>}
            <div ref={endRef} />
          </div>
        </div>
      </div>
      <form
        className="ai-panel-input"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <label htmlFor="ai-q" className="sr-only">
          Domanda
        </label>
        <textarea
          id="ai-q"
          className="textarea"
          rows={2}
          placeholder="Chiedi qualcosa su questa pagina…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {ai.busy ? (
          <button type="button" className="btn" onClick={ai.stop} aria-label="Interrompi">
            <Square size={15} />
          </button>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={!input.trim()} aria-label="Invia">
            <Send size={15} />
          </button>
        )}
      </form>
    </aside>
  );
}
