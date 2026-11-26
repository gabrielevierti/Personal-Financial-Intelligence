import { useFinanceModel } from '../../hooks/useFinanceModel';
import { AiButton } from '../../components/ai/AiPanel';
import { useAiPage } from '../../components/ai/AiProvider';
import { PageSkeleton } from '../../components/ui/States';
import { insightFocus } from '../dashboard/Dashboard2';

const PRIO_LABEL = { alta: 'Priorità alta', media: 'Priorità media', bassa: 'Priorità bassa' } as const;

export function InsightsPage() {
  const model = useFinanceModel();
  useAiPage(model ? { section: 'insights', label: 'Financial Insights', blocks: () => [{ title: 'INSIGHT', body: model.insights.map(insightFocus).join('\n\n') || 'nessuno' }] } : null, [model]);
  if (!model) return <PageSkeleton />;
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Financial Insights</h1>
          <p>Segnali calcolati dall'app con regole fisse sui tuoi dati, ordinati per priorità. Ognuno indica il motivo, i dati da cui nasce e un suggerimento. {model.period.label && `Periodo: ${model.period.label}.`}</p>
        </div>
      </div>
      {model.insights.length === 0 ? (
        <div className="panel"><p className="small muted">Nessun segnale da evidenziare con i dati attuali.</p></div>
      ) : (
        <div className="stack">
          {model.insights.map((i) => (
            <article key={i.id} className={`panel insight-card prio-${i.priority}`} data-testid={`insight-${i.id}`}>
              <div className="panel-head">
                <div>
                  <span className={`prio-badge prio-${i.priority}`}>{PRIO_LABEL[i.priority]}</span>
                  <h2 style={{ marginTop: 4 }}>{i.title}</h2>
                </div>
                <AiButton prompt={`Spiegami questo insight e come agire: ${i.title}`} focus={insightFocus(i)} />
              </div>
              <dl className="kv">
                <dt>Motivo</dt>
                <dd>{i.reason}</dd>
                {i.data.length > 0 && (
                  <>
                    <dt>Dati</dt>
                    <dd>
                      <ul className="plain-list">{i.data.map((d) => <li key={d} className="num">{d}</li>)}</ul>
                    </dd>
                  </>
                )}
                <dt>Suggerimento</dt>
                <dd>{i.suggestion}</dd>
              </dl>
              {i.href && <a className="btn btn-sm" href={i.href} style={{ marginTop: 10 }}>Approfondisci</a>}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
