import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pagesHeadersFile } from './src/server/securityHeaders';

const apiPort = Number(process.env.CITATION_GRAPH_PORT ?? 5174);

/** Self-hosts what pdf.js loads at run time (standard fonts, wasm decoders, cmaps) and writes the Pages `_headers` file. */
const PART_BYTES = 16 * 1024 * 1024; // Cloudflare Pages: 25 MiB per file

/** Self-hosts tesseract.js worker, wasm and por+eng traineddata (lazy OCR; not in the JS bundle). */
function copyTesseract(out: string) {
  const tessdata = path.resolve('models/tessdata');
  if (!existsSync(path.join(tessdata, 'eng.traineddata.gz')) || !existsSync(path.join(tessdata, 'por.traineddata.gz'))) {
    execFileSync(process.execPath, ['scripts/fetch-tessdata.mjs'], { stdio: 'inherit' });
  }
  const dest = path.join(out, 'tesseract');
  mkdirSync(path.join(dest, 'tessdata'), { recursive: true });
  cpSync(path.resolve('node_modules/tesseract.js/dist/worker.min.js'), path.join(dest, 'worker.min.js'));
  const core = path.resolve('node_modules/tesseract.js-core');
  for (const f of ['tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm']) {
    cpSync(path.join(core, f), path.join(dest, f));
  }
  for (const f of ['eng.traineddata.gz', 'por.traineddata.gz']) cpSync(path.join(tessdata, f), path.join(dest, 'tessdata', f));
}



/** Browser edition: onnxruntime wasm + the semantic model, split in parts that fit the Pages file limit. */
function copyWebModel(out: string) {
  const ort = path.resolve('node_modules/onnxruntime-web/dist');
  mkdirSync(path.join(out, 'ort'), { recursive: true });
  for (const f of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) cpSync(path.join(ort, f), path.join(out, 'ort', f));
  const src = path.resolve('models/minilm');
  const onnx = path.join(src, 'onnx/model_quantized.onnx');
  if (!existsSync(onnx)) {
    console.warn('[fontexto] models/minilm ausente (npm run fetch-model): a versão web sai SEM a busca semântica.');
    return;
  }
  const dst = path.join(out, 'models/minilm');
  mkdirSync(dst, { recursive: true });
  const buf = readFileSync(onnx);
  const parts: string[] = [];
  for (let o = 0, i = 0; o < buf.length; o += PART_BYTES, i++) {
    const name = `model.q8.onnx.part${String(i).padStart(2, '0')}`;
    writeFileSync(path.join(dst, name), buf.subarray(o, o + PART_BYTES));
    parts.push(name);
  }
  cpSync(path.join(src, 'tokenizer.json'), path.join(dst, 'tokenizer.json'));
  cpSync(path.join(src, 'tokenizer_config.json'), path.join(dst, 'tokenizer_config.json'));
  const manifest = {
    name: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2 (q8)',
    model: { parts, size: buf.length, sha256: createHash('sha256').update(buf).digest('hex') },
    tokenizer: 'tokenizer.json',
    tokenizerConfig: 'tokenizer_config.json',
  };
  writeFileSync(path.join(dst, 'manifest.json'), JSON.stringify(manifest, null, 1));
  for (const f of [...parts, 'tokenizer.json']) if (statSync(path.join(dst, f)).size >= 25 * 1024 * 1024) throw new Error(`${f} passa de 25 MiB (limite do Pages)`);
}

/** The server/exe edition has no browser backend: stub its entry points so the workers, onnx runtime and model code are not bundled. */
const stubBrowserBackend = (): Plugin => ({
  name: 'fontexto-stub-browser-backend',
  enforce: 'pre',
  resolveId(id) {
    if (/\/local\/(client|semanticClient)$/.test(id)) return '\0fontexto-stub:' + id.split('/').pop();
  },
  load(id) {
    if (!id.startsWith('\0fontexto-stub:')) return;
    return id.endsWith('semanticClient')
      ? 'export const modelAvailable = async () => false; export const runSemantic = async () => { throw new Error("indisponível"); };'
      : 'export const call = async () => { throw new Error("indisponível nesta edição"); };';
  },
});

const selfHostedAssets = (web: boolean): Plugin => ({
  name: 'fontexto-self-hosted-assets',
  apply: 'build',
  closeBundle() {
    const out = path.resolve(web ? 'dist/site' : 'dist/web');
    if (web) {
      copyWebModel(out);
      copyTesseract(out);
    }
    const pdfjs = path.resolve('node_modules/pdfjs-dist');
    for (const dir of ['standard_fonts', 'wasm', 'cmaps', 'iccs']) cpSync(path.join(pdfjs, dir), path.join(out, 'pdfjs', dir), { recursive: true });
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, '_headers'), pagesHeadersFile());
  },
});

export default defineConfig(({ mode, isSsrBuild }) => {
  const web = mode === 'web';
  // `vite build --mode web --ssr prerender.tsx`: build-time landing prerender for the public site (Node only).
  if (isSsrBuild) {
    return {
      root: 'src/web',
      define: { __EDITION__: JSON.stringify('web') },
      plugins: [react()],
      publicDir: false,
      build: { outDir: '../../dist/prerender', emptyOutDir: true, ssr: true },
    };
  }
  return {
  root: 'src/web',
  define: { __EDITION__: JSON.stringify(web ? 'web' : 'local') },
  plugins: [...(web ? [] : [stubBrowserBackend()]), react(), selfHostedAssets(web)],
  worker: { format: 'es' as const },
  build: {
    outDir: web ? '../../dist/site' : '../../dist/web',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2500,
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: { '/api/': `http://127.0.0.1:${apiPort}` },
  },
  test: {
    root: '.',
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
  },
};
});
