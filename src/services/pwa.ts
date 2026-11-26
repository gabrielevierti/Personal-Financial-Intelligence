/** Registra il service worker solo in produzione (in sviluppo interferirebbe con l'HMR di Vite). */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((e) => console.warn('Service worker non registrato', e));
  });
}
