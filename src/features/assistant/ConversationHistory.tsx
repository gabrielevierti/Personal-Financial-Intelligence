import { useLiveQuery } from 'dexie-react-hooks';
import { History, Trash2 } from 'lucide-react';
import { db } from '../../database/db';
import { useAi } from '../../components/ai/AiProvider';

/** Cronologia delle conversazioni del pannello AI, salvate solo in locale. */
export function ConversationHistory() {
  const ai = useAi();
  const convs = useLiveQuery(() => db.ai_conversations.orderBy('updatedAt').reverse().limit(50).toArray(), []);
  return (
    <section className="panel" style={{ marginBottom: 16 }} data-testid="ai-history">
      <div className="panel-head">
        <h2>
          <History size={16} style={{ verticalAlign: -3, marginRight: 8 }} />
          Conversazioni
        </h2>
        {convs && convs.length > 0 && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              await db.ai_conversations.clear();
              ai.newConversation();
            }}
          >
            Cancella cronologia
          </button>
        )}
      </div>
      {!convs?.length ? (
        <p className="small muted">Nessuna conversazione. Apri il pannello AI dall'header (o dal pulsante ✦ su un widget) da qualunque pagina.</p>
      ) : (
        <ul className="plain-list">
          {convs.map((c) => (
            <li key={c.id} className="row-between small">
              <button className="link-btn" onClick={() => ai.loadConversation(c)}>
                {c.title}
              </button>
              <span className="xs muted">
                {c.section} · {c.messages.length} messaggi · {new Date(c.updatedAt).toLocaleString('it-IT')}
              </span>
              <button className="btn btn-ghost icon-btn" aria-label={`Elimina la conversazione ${c.title}`} onClick={() => void db.ai_conversations.delete(c.id)}>
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
