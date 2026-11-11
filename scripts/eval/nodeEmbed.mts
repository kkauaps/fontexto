// Node-side embedder for experiments (same models/tokenizers as the browser build), with an on-disk cache.
import { pipeline, env } from '@huggingface/transformers';
import fs from 'node:fs';
import crypto from 'node:crypto';

export type ModelName = 'e5' | 'minilm';
const PREFIX: Record<ModelName, { q: string; p: string }> = { e5: { q: 'query: ', p: 'passage: ' }, minilm: { q: '', p: '' } };

export async function makeEmbedder(model: ModelName) {
  env.allowRemoteModels = false;
  env.localModelPath = `${process.env.MODELS_DIR ?? 'models-eval'}/`;
  const pipe: any = await pipeline('feature-extraction', model, { dtype: 'q8' });
  const cacheFile = `${process.env.MODELS_DIR ?? 'models-eval'}/cache-${model}.json`;
  const cache: Record<string, number[]> = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
  const key = (s: string) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
  async function embed(texts: string[], kind: 'q' | 'p'): Promise<number[][]> {
    const full = texts.map((t) => PREFIX[model][kind] + t);
    const todo = [...new Set(full.filter((t) => !cache[key(t)]))];
    for (let i = 0; i < todo.length; i += 16) {
      const batch = todo.slice(i, i + 16);
      const out = await pipe(batch, { pooling: 'mean', normalize: true });
      const dim = out.dims[1];
      for (let j = 0; j < batch.length; j++) cache[key(batch[j])] = Array.from(out.data.slice(j * dim, (j + 1) * dim) as Float32Array).map((x) => Math.round(x * 1e5) / 1e5);
      if ((i / 16) % 20 === 0) process.stderr.write(`\r${model} ${i}/${todo.length}`);
    }
    if (todo.length) fs.writeFileSync(cacheFile, JSON.stringify(cache));
    return full.map((t) => cache[key(t)]);
  }
  return { embed };
}
export const cosine = (a: number[], b: number[]) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
