import type { Provenance as P } from '../../services/research/types';

const STATUS: Record<P['status'], string> = { ufficiale: 'fonte ufficiale', fornitore: 'fornitore di dati', calcolato: 'calcolato da PFI', ipotesi: 'ipotesi' };

export function provText(p: P): string {
  return [p.source, p.period, p.currency && `valuta ${p.currency}`, p.unit, STATUS[p.status], p.delay, `scaricato il ${new Date(p.fetchedAt).toLocaleString('it-IT')}`].filter(Boolean).join(' · ');
}

/** Etichetta della fonte di un dato: sempre visibile, con il dettaglio al passaggio del mouse. */
export function SourceTag({ prov, compact }: { prov: P; compact?: boolean }) {
  return (
    <span className={`source-tag src-${prov.status}`} title={provText(prov)}>
      {compact ? prov.source.split(' (')[0] : provText(prov)}
    </span>
  );
}
