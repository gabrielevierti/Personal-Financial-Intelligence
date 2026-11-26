// Copia in public/pdfjs i font standard e le CMap di pdf.js, così la lettura dei PDF funziona offline
// senza scaricare nulla da CDN esterni.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
const src = 'node_modules/pdfjs-dist';
const dest = 'public/pdfjs';
mkdirSync(dest, { recursive: true });
for (const dir of ['standard_fonts', 'cmaps']) {
  if (!existsSync(`${src}/${dir}`)) throw new Error(`pdfjs-dist/${dir} non trovato: esegui npm install`);
  cpSync(`${src}/${dir}`, `${dest}/${dir}`, { recursive: true });
}
console.log('pdf.js: font e CMap copiati in public/pdfjs');
