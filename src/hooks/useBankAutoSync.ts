import { useEffect, useRef } from 'react';
import { BridgeClient } from '../services/bank/client';
import { getAutoSync, getBridgeUrl, needsAutoSync, syncAll } from '../services/bank/sync';
import { useToast } from './useToast';

/** All'apertura (e poi ogni 30 minuti, se la pagina è visibile) sincronizza i conti collegati se sono passate più di 6 ore. */
export function useBankAutoSync(): void {
  const toast = useToast();
  const running = useRef(false);
  useEffect(() => {
    const run = async () => {
      if (running.current || document.visibilityState === 'hidden' || !navigator.onLine) return;
      running.current = true;
      try {
        if (!(await getAutoSync()) || !(await needsAutoSync())) return;
        const client = new BridgeClient(await getBridgeUrl());
        try {
          await client.health();
        } catch {
          return; // bridge spento: nessun avviso, si riprova più tardi
        }
        const results = await syncAll(client);
        const added = results.reduce((s, r) => s + r.added, 0);
        const expired = results.find((r) => r.error && /consenso|ricollega/i.test(r.error));
        if (added > 0) toast.success(`Sincronizzazione bancaria: ${added} nuovi movimenti.`);
        if (expired) toast.error(expired.error!);
      } catch {
        /* errori silenziosi: lo stato è visibile in Collegamenti bancari */
      } finally {
        running.current = false;
      }
    };
    void run();
    const id = window.setInterval(run, 30 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [toast]);
}
