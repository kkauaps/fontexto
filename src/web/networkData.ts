/**
 * Browser side of /api/oa/graph: sends the references (DOI / OpenAlex id / title + year + first author, never the
 * document) in batches, paced under the site's limit on /api/oa/* (20 requests per 10 s per IP), retries what the
 * catalogue throttled, and keeps the answers per project in localStorage so the graph survives a reload.
 */
import type { CitationGraph, PublicationNode } from '../core/model';
import type { GraphItem, GraphResponse, GraphWork } from '../core/openAlexGraph';

const KEY = (projectId: string) => `fontexto:net:v1:${projectId}`;
const BATCH_IDS = 50;
const BATCH_TITLES = 15;
/** Gap between request starts: ~1.4 requests/s, far below 20 per 10 s even with the PDF search running. */
const GAP_MS = 700;

export interface StoredConnections {
  works: Record<string, GraphWork>;
  /** Keys OpenAlex did not identify (not retried automatically). */
  missing: string[];
  at: number;
}

export function loadConnections(projectId: string): StoredConnections | undefined {
  try {
    const raw = localStorage.getItem(KEY(projectId));
    if (!raw) return undefined;
    const v = JSON.parse(raw) as StoredConnections;
    return v && typeof v.works === 'object' ? v : undefined;
  } catch {
    return undefined;
  }
}

export function saveConnections(projectId: string, v: StoredConnections) {
  try {
    localStorage.setItem(KEY(projectId), JSON.stringify(v));
  } catch {
    /* quota or private mode: keep it for this session only */
  }
}

export function graphItems(graph: CitationGraph, openalexIds: Record<string, string | undefined> = {}): GraphItem[] {
  const out: GraphItem[] = [];
  for (const n of Object.values(graph.nodes)) {
    if (n.kind !== 'publication') continue;
    const p = n as PublicationNode;
    const item: GraphItem = { key: p.id };
    if (openalexIds[p.id]) item.openalexId = openalexIds[p.id];
    if (p.doi) item.doi = p.doi;
    if (p.title && p.title.length >= 8) item.title = p.title.slice(0, 300);
    if (p.year) item.year = p.year;
    const a = p.authors[0];
    if (a?.family) item.author = a.family.slice(0, 80);
    if (item.openalexId || item.doi || item.title) out.push(item);
  }
  return out;
}

export interface Progress {
  done: number;
  total: number;
  found: number;
  busy: number;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(new DOMException('aborted', 'AbortError'))), { once: true });
  });

async function post(items: GraphItem[], signal?: AbortSignal): Promise<GraphResponse | 'busy'> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch('/api/oa/graph', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }), credentials: 'omit', signal });
    if (res.status === 429 || res.status === 503) {
      const ra = Number(res.headers.get('retry-after'));
      await sleep(Math.min(30_000, Number.isFinite(ra) && ra > 0 ? ra * 1000 : 10_000 * (attempt + 1)), signal);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as GraphResponse;
  }
  return 'busy';
}

/**
 * Resolves every item (skipping those already known), batched and paced. Returns the merged store; throws only on
 * abort. Throttled batches are retried once at the end; whatever is still throttled is reported as `busy`.
 */
export async function fetchConnections(items: GraphItem[], known: StoredConnections | undefined, onProgress: (p: Progress, partial: StoredConnections) => void, signal?: AbortSignal): Promise<{ store: StoredConnections; busy: number; failed: boolean }> {
  const store: StoredConnections = { works: { ...(known?.works ?? {}) }, missing: [], at: Date.now() };
  const todo = items.filter((it) => !store.works[it.key]);
  const progress: Progress = { done: items.length - todo.length, total: items.length, found: Object.keys(store.works).length, busy: 0 };
  onProgress({ ...progress }, store);
  let failed = false;
  const run = async (list: GraphItem[]): Promise<GraphItem[]> => {
    const strong = list.filter((it) => it.doi || it.openalexId);
    const weak = list.filter((it) => !it.doi && !it.openalexId);
    const batches: GraphItem[][] = [];
    for (let i = 0; i < strong.length; i += BATCH_IDS) batches.push(strong.slice(i, i + BATCH_IDS));
    for (let i = 0; i < weak.length; i += BATCH_TITLES) batches.push(weak.slice(i, i + BATCH_TITLES));
    const again: GraphItem[] = [];
    let last = 0;
    for (const b of batches) {
      const wait = last + GAP_MS - Date.now();
      if (wait > 0) await sleep(wait, signal);
      last = Date.now();
      let r: GraphResponse | 'busy';
      try {
        r = await post(b, signal);
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        failed = true;
        r = 'busy';
      }
      for (const it of b) {
        const st = r === 'busy' ? 'busy' : r.status[it.key];
        if (r !== 'busy' && r.works[it.key]) {
          store.works[it.key] = r.works[it.key];
          progress.found++;
          progress.done++;
        } else if (st === 'busy' || st === 'skipped') again.push(it);
        else {
          store.missing.push(it.key);
          progress.done++;
        }
      }
      onProgress({ ...progress, busy: again.length }, store);
    }
    return again;
  };
  let rest = await run(todo);
  if (rest.length) {
    await sleep(8000, signal);
    rest = await run(rest);
  }
  progress.busy = rest.length;
  onProgress({ ...progress }, store);
  return { store, busy: rest.length, failed: failed && progress.found === 0 };
}
