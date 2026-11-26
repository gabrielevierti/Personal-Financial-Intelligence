/**
 * Estrazione del testo posizionato da un PDF con pdf.js, interamente nel browser.
 * Il modulo pdf.js è iniettabile per poter usare la build "legacy" nei test Node.
 */
import { itemsToTable, type PdfTable, type PdfTextItem } from './pdfLayout';

interface PdfJsTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}
interface PdfJsPage {
  getTextContent(): Promise<{ items: Array<PdfJsTextItem | { type: string }> }>;
  cleanup?: () => void;
}
interface PdfJsDocument {
  numPages: number;
  getPage(n: number): Promise<PdfJsPage>;
}
export interface PdfJsLike {
  getDocument(params: Record<string, unknown>): { promise: Promise<PdfJsDocument>; destroy(): Promise<void> };
}

/** Percorsi locali di font standard e CMap (con barra finale). */
export interface PdfAssets {
  standardFontDataUrl: string;
  cMapUrl: string;
}

export const MAX_PDF_PAGES = 200;

export async function extractPdfItems(pdfjs: PdfJsLike, data: Uint8Array, assets?: PdfAssets): Promise<{ items: PdfTextItem[]; pages: number }> {
  let doc: PdfJsDocument;
  const task = pdfjs.getDocument({
    data,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    ...(assets ? { standardFontDataUrl: assets.standardFontDataUrl, cMapUrl: assets.cMapUrl, cMapPacked: true } : {}),
  });
  try {
    doc = await task.promise;
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'PasswordException') throw new Error('Il PDF è protetto da password. Aprilo e salvane una copia senza password, poi riprova.');
    await task.destroy().catch(() => undefined);
    if (name === 'InvalidPDFException') throw new Error('Il file non è un PDF valido o è danneggiato.');
    throw e;
  }
  try {
    if (doc.numPages > MAX_PDF_PAGES) throw new Error(`Il PDF ha ${doc.numPages} pagine: il massimo è ${MAX_PDF_PAGES}.`);
    const items: PdfTextItem[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      for (const raw of content.items) {
        if (!('str' in raw)) continue;
        const t = raw.transform;
        const h = Math.abs(t[3]) || Math.hypot(t[2], t[3]) || raw.height || 8;
        items.push({ text: raw.str, x: t[4], y: t[5], w: raw.width, h, page: n });
      }
      page.cleanup?.();
    }
    return { items, pages: doc.numPages };
  } finally {
    await task.destroy();
  }
}

export async function pdfToTable(pdfjs: PdfJsLike, data: Uint8Array, assets?: PdfAssets): Promise<PdfTable> {
  const { items } = await extractPdfItems(pdfjs, data, assets);
  if (items.filter((i) => i.text.trim()).length === 0) {
    throw new Error('Il PDF non contiene testo selezionabile (probabilmente è una scansione). Serve un PDF generato dalla banca, non una foto o una scansione.');
  }
  return itemsToTable(items);
}

/** Carica pdf.js (build moderna) con il worker servito localmente. */
export async function loadBrowserPdfJs(): Promise<PdfJsLike> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs as unknown as PdfJsLike;
}

export function browserPdfAssets(): PdfAssets {
  const base = new URL('./pdfjs/', document.baseURI).href;
  return { standardFontDataUrl: `${base}standard_fonts/`, cMapUrl: `${base}cmaps/` };
}
