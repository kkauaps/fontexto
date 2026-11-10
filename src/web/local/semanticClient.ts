/** Main-thread driver of the optional semantic search (browser edition). */
import { createWorker } from '../trustedWorker';
import embedWorkerUrl from './embed.worker.ts?worker&url';
import { call } from './client';

export interface SemanticProgress {
  phase: 'download' | 'init' | 'analyze' | 'apply';
  /** 0..1 */
  fraction: number;
  detail?: string;
}

let worker: Worker | undefined;
let seq = 0;

function w(): Worker {
  return (worker ??= createWorker(embedWorkerUrl, 'fontexto-embed'));
}

function request<T>(msg: Record<string, unknown>, onMsg?: (m: any) => void): Promise<T> {
  const id = ++seq;
  const worker = w();
  return new Promise<T>((resolve, reject) => {
    const h = (e: MessageEvent) => {
      const m = e.data;
      if (m.type) return onMsg?.(m);
      if (m.id !== id) return;
      worker.removeEventListener('message', h);
      if (m.ok) resolve(m as T);
      else reject(new Error(m.error));
    };
    worker.addEventListener('message', h);
    worker.postMessage({ id, ...msg });
  });
}

/** True when this deployment ships the model (checked once). */
export async function modelAvailable(): Promise<boolean> {
  try {
    const r = await fetch('/models/minilm/manifest.json');
    return r.ok && (r.headers.get('content-type') ?? '').includes('json');
  } catch {
    return false;
  }
}

/** Downloads the model (first time only), embeds what the project still needs and re-ranks the citations. */
export async function runSemantic(projectId: string, onProgress: (p: SemanticProgress) => void) {
  onProgress({ phase: 'download', fraction: 0 });
  await request({ type: 'load' }, (m) => {
    if (m.type === 'progress') onProgress({ phase: m.stage === 'init' ? 'init' : 'download', fraction: m.loaded / m.total, detail: `${(m.loaded / 1e6).toFixed(0)} de ${(m.total / 1e6).toFixed(0)} MB` });
  });
  const todo = await call<{ claims: string[]; passages: string[]; total: number; cached: number }>('semanticTodo', [projectId]);
  const all = [...todo.claims, ...todo.passages];
  onProgress({ phase: 'analyze', fraction: all.length ? 0 : 1, detail: `${all.length} trechos` });
  let vecs: Float32Array[] = [];
  if (all.length) {
    const res = await request<{ vecs: Float32Array[] }>({ type: 'embed', texts: all }, (m) => {
      if (m.type === 'embedded') onProgress({ phase: 'analyze', fraction: m.done / all.length, detail: `${m.done} de ${all.length} trechos` });
    });
    vecs = res.vecs;
  }
  onProgress({ phase: 'apply', fraction: 1 });
  const claims = todo.claims.map((text, i) => ({ text, vec: vecs[i] }));
  const passages = todo.passages.map((text, i) => ({ text, vec: vecs[todo.claims.length + i] }));
  return call('semanticStore', [projectId, claims, passages]);
}

export const semanticStatus = (projectId: string) => call<{ active: boolean; cachedTexts: number }>('semanticStatus', [projectId]);
export const clearSemantic = (projectId: string) => call<void>('clearSemantic', [projectId]);
