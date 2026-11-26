/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

/** Genera dist/sw.js con l'elenco completo dei file da precaricare per l'uso offline. */
function serviceWorker(): Plugin {
  return {
    name: 'pfi-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = new Set<string>(['./', './index.html']);
      for (const name of Object.keys(bundle)) if (!name.endsWith('.map')) files.add(`./${name}`);
      const walk = (dir: string): string[] =>
        readdirSync(dir).flatMap((f) => {
          const p = join(dir, f);
          return statSync(p).isDirectory() ? walk(p) : [p];
        });
      for (const p of walk('public')) files.add(`./${relative('public', p).replace(/\\/g, '/')}`);
      const list = [...files].sort();
      const version = createHash('sha256').update(list.join('|')).update(String(Object.keys(bundle).length)).digest('hex').slice(0, 12);
      const source = readFileSync('scripts/sw-template.js', 'utf8').replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(list, null, 2));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
