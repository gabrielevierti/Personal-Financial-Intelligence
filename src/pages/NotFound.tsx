import { Compass } from 'lucide-react';
import { EmptyState } from '../components/ui/States';

export function NotFound() {
  return (
    <EmptyState icon={<Compass size={22} />} title="Questa pagina non esiste" text="L'indirizzo non corrisponde a nessuna sezione di PFI.">
      <a className="btn btn-primary" href="#/dashboard">
        Torna alla dashboard
      </a>
    </EmptyState>
  );
}
