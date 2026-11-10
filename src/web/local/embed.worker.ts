/// <reference lib="webworker" />
/**
 * Semantic search model, running 100% in the browser: paraphrase-multilingual-MiniLM-L12-v2 (8-bit ONNX) on
 * onnxruntime-web (wasm, single thread). The model files are self-hosted and cached by the browser (Cache Storage);
 * after the first download it works offline. Texts never leave this worker/device.
 */
import { Tokenizer } from '@huggingface/tokenizers';
import * as ort from 'onnxruntime-web/wasm';

const MODEL_DIR = '/models/minilm/';
const CACHE = 'fontexto-model-v1';
const MAX_TOKENS = 128;
const BATCH = 16;

interface Manifest {
  model: { parts: string[]; size: number };
  tokenizer: string;
  tokenizerConfig: string;
}

let session: ort.InferenceSession | undefined;
let tokenizer: Tokenizer | undefined;
let padId = 1;
let loading: Promise<void> | undefined;

const post = (m: unknown, transfer: Transferable[] = []) => self.postMessage(m, transfer);

async function cachedFetch(url: string, onBytes: (n: number) => void): Promise<Uint8Array> {
  let cache: Cache | undefined;
  try {
    cache = await caches.open(CACHE);
  } catch {
    cache = undefined;
  }
  let res = cache ? await cache.match(url) : undefined;
  if (!res) {
    const net = await fetch(url);
    if (!net.ok) throw new Error(`Falha ao baixar ${url} (${net.status})`);
    if (cache) await cache.put(url, net.clone()).catch(() => undefined);
    res = net;
  }
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    n += value.length;
    onBytes(value.length);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

async function load(): Promise<void> {
  const mres = await fetch(`${MODEL_DIR}manifest.json`);
  if (!mres.ok) throw new Error('Modelo semântico não incluído nesta versão.');
  const manifest = (await mres.json()) as Manifest;
  const total = manifest.model.size + 17_100_000;
  let loaded = 0;
  const tick = (n: number) => {
    loaded += n;
    post({ type: 'progress', stage: 'download', loaded: Math.min(loaded, total), total });
  };
  const tokJson = JSON.parse(new TextDecoder().decode(await cachedFetch(MODEL_DIR + manifest.tokenizer, tick)));
  const tokCfg = JSON.parse(new TextDecoder().decode(await cachedFetch(MODEL_DIR + manifest.tokenizerConfig, tick)));
  tokenizer = new Tokenizer(tokJson, tokCfg);
  padId = tokenizer.encode('<pad>', { add_special_tokens: false }).ids[0] ?? 1;
  const bytes = new Uint8Array(manifest.model.size);
  let off = 0;
  for (const part of manifest.model.parts) {
    const b = await cachedFetch(MODEL_DIR + part, tick);
    bytes.set(b, off);
    off += b.length;
  }
  post({ type: 'progress', stage: 'init', loaded: total, total });
  ort.env.wasm.wasmPaths = '/ort/';
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
}

function encode(text: string): number[] {
  const ids = tokenizer!.encode(text).ids as number[];
  if (ids.length <= MAX_TOKENS) return ids;
  const cut = ids.slice(0, MAX_TOKENS);
  cut[MAX_TOKENS - 1] = ids[ids.length - 1]; // keep </s>
  return cut;
}

async function embed(texts: string[], onDone: (n: number) => void): Promise<Float32Array[]> {
  const enc = texts.map(encode);
  const order = enc.map((_, i) => i).sort((a, b) => enc[a].length - enc[b].length);
  const out: Float32Array[] = new Array(texts.length);
  const needsTypes = session!.inputNames.includes('token_type_ids');
  for (let i = 0; i < order.length; i += BATCH) {
    const idxs = order.slice(i, i + BATCH);
    const len = Math.max(...idxs.map((j) => enc[j].length));
    const ids = new BigInt64Array(idxs.length * len).fill(BigInt(padId));
    const mask = new BigInt64Array(idxs.length * len);
    idxs.forEach((j, r) => enc[j].forEach((t, c) => {
      ids[r * len + c] = BigInt(t);
      mask[r * len + c] = 1n;
    }));
    const feeds: Record<string, ort.Tensor> = {
      input_ids: new ort.Tensor('int64', ids, [idxs.length, len]),
      attention_mask: new ort.Tensor('int64', mask, [idxs.length, len]),
    };
    if (needsTypes) feeds.token_type_ids = new ort.Tensor('int64', new BigInt64Array(idxs.length * len), [idxs.length, len]);
    const res = await session!.run(feeds);
    const hidden = res[session!.outputNames[0]];
    const data = hidden.data as Float32Array;
    const dim = hidden.dims[2];
    idxs.forEach((j, r) => {
      const v = new Float32Array(dim);
      let cnt = 0;
      for (let c = 0; c < len; c++) {
        if (mask[r * len + c] === 0n) continue;
        cnt++;
        const base = (r * len + c) * dim;
        for (let d = 0; d < dim; d++) v[d] += data[base + d];
      }
      let norm = 0;
      for (let d = 0; d < dim; d++) {
        v[d] /= cnt || 1;
        norm += v[d] * v[d];
      }
      norm = Math.sqrt(norm) || 1;
      for (let d = 0; d < dim; d++) v[d] /= norm;
      out[j] = v;
    });
    onDone(idxs.length);
  }
  return out;
}

self.onmessage = async (e: MessageEvent<{ id: number; type: 'load' | 'embed'; texts?: string[] }>) => {
  const { id, type } = e.data;
  try {
    if (type === 'load') {
      loading ??= load();
      await loading;
      post({ id, ok: true });
    } else {
      loading ??= load();
      await loading;
      let done = 0;
      const vecs = await embed(e.data.texts ?? [], (n) => {
        done += n;
        post({ type: 'embedded', id, done });
      });
      post({ id, ok: true, vecs }, vecs.map((v) => v.buffer));
    }
  } catch (err) {
    loading = undefined;
    post({ id, ok: false, error: (err as Error).message });
  }
};
