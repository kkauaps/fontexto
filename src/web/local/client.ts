/** Main-thread side of the browser backend: a promise-based RPC to the backend Web Worker. */
import { createWorker } from '../trustedWorker';
import backendWorkerUrl from './backend.worker.ts?worker&url';

export interface Progress {
  stage: string;
  done: number;
  total: number;
  name?: string;
}

let worker: Worker | undefined;
let seq = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; onProgress?: (p: Progress) => void }>();

function start(): Worker {
  if (worker) return worker;
  worker = createWorker(backendWorkerUrl, 'fontexto-backend');
  worker.onmessage = (e: MessageEvent) => {
    const m = e.data as { id: number; ok?: boolean; result?: unknown; error?: string; progress?: Progress };
    const p = pending.get(m.id);
    if (!p) return;
    if (m.progress) return p.onProgress?.(m.progress);
    pending.delete(m.id);
    if (m.ok) p.resolve(m.result);
    else p.reject(new Error(m.error ?? 'Erro desconhecido'));
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(`Falha no processador local: ${e.message}`));
    pending.clear();
    worker = undefined;
  };
  return worker;
}

export function call<T>(method: string, args: unknown[] = [], onProgress?: (p: Progress) => void): Promise<T> {
  const w = start();
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    w.postMessage({ id, method, args });
  });
}
