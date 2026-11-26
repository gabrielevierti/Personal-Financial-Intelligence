import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="panel error-state" role="alert">
        <div className="empty">
          <div className="empty-icon" style={{ color: 'var(--danger)', background: 'rgba(227,109,97,.12)' }}>
            <AlertTriangle size={22} />
          </div>
          <h3>Questa sezione non è riuscita a caricarsi</h3>
          <p>{this.state.error.message}</p>
          <p>I tuoi dati non sono stati modificati. Ricarica la pagina; se il problema persiste esporta un backup dalle Impostazioni.</p>
          <div className="actions">
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              Ricarica la pagina
            </button>
          </div>
        </div>
      </div>
    );
  }
}
