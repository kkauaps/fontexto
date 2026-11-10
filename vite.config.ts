import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pagesHeadersFile } from './src/server/securityHeaders';

const apiPort = Number(process.env.CITATION_GRAPH_PORT ?? 5174);

/** Self-hosts what pdf.js loads at run time (standard fonts, wasm decoders, cmaps) and writes the Pages `_headers` file. */
const selfHostedAssets = (): Plugin => ({
  name: 'fontexto-self-hosted-assets',
  apply: 'build',
  closeBundle() {
    const out = path.resolve('dist/web');
    const pdfjs = path.resolve('node_modules/pdfjs-dist');
    for (const dir of ['standard_fonts', 'wasm', 'cmaps', 'iccs']) cpSync(path.join(pdfjs, dir), path.join(out, 'pdfjs', dir), { recursive: true });
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, '_headers'), pagesHeadersFile());
  },
});

export default defineConfig({
  root: 'src/web',
  plugins: [react(), selfHostedAssets()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2500,
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: { '/api': `http://127.0.0.1:${apiPort}` },
  },
  test: {
    root: '.',
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
  },
});
