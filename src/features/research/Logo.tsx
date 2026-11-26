import { useEffect, useState } from 'react';
import { bridgeGet, TTL } from '../../services/research/bridge';

/** Logo scaricato tramite il bridge e mostrato come data URL: il browser non contatta domini esterni. */
export function CompanyLogo({ url, name }: { url?: string; name: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    bridgeGet<{ dataUrl: string }>(`/research/logo?url=${encodeURIComponent(url)}`, 'Logo', TTL.week)
      .then((r) => alive && setSrc(r.data.dataUrl))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [url]);
  return src ? <img className="co-logo" src={src} alt="" /> : <span className="co-logo co-initials" aria-hidden="true">{name.slice(0, 2).toUpperCase()}</span>;
}
