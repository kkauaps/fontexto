/**
 * Browser-side pacing and retries for /api/oa/* (shared with headless eval scripts).
 */
import { OA_BATCH_MAX } from './oaBatch';
import type { OaResult } from './openAccess';
import type { PublicationNode } from './model';

export const OA_DEFAULT_CONCURRENCY = 5;
/** Keeps a single user under generous per-IP limits while allowing a 300-ref document. */
export const OA_MIN_GAP_MS = 900;

export function makePacer(gapMs: number, now = () => Date.now(), sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))) {
  let next = 0;
  return async () => {
    const t = now();
    const at = Math.max(t, next);
    next = at + gapMs;
    if (at > t) await sleep(at - t);
  };
}

const RETRY_RE = /^(?:429|5\d\d)\b/;

/** Retries on 429/5xx; optional extra waits honour Retry-After embedded in the message. */
export async function withRetry<T>(
  run: () => Promise<T>,
  waits: number[] = [2000, 6000, 15_000],
  sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (attempt >= waits.length || !RETRY_RE.test(msg)) throw e;
      const ra = Number(/retry-after[:\s]+(\d+)/i.exec(msg)?.[1]);
      const wait = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 60_000) : waits[attempt];
      await sleep(wait);
    }
  }
}

export function arxivFromPub(pub: Pick<PublicationNode, 'url'>): string | undefined {
  const u = pub.url ?? '';
  const m = /arxiv\.org\/(?:abs|pdf)\/([^\s?#]+?)(?:\.pdf)?(?:v\d+)?$/i.exec(u);
  return m?.[1]?.replace(/v\d+$/i, '').toLowerCase();
}

export function oaQueryFromPub(pub: PublicationNode) {
  const thesis = /thesis|dissertation/i.test(pub.entryType ?? '');
  const arxiv = arxivFromPub(pub);
  return { doi: pub.doi, title: pub.title, year: pub.year, author: pub.authors[0]?.family, ...(arxiv ? { arxiv } : {}), ...(thesis ? { kind: 'thesis' as const } : {}) };
}

export function oaEligible(pub: Pick<PublicationNode, 'doi' | 'title' | 'url'>) {
  return Boolean(pub.doi || arxivFromPub(pub) || (pub.title && pub.title.length >= 8));
}

/** Production-era pacing (main @ c3a55e4): 3 workers, 1100 ms gap, shallow retries. */
export const OA_PROD_CONCURRENCY = 3;
export const OA_PROD_GAP_MS = 1100;
export const OA_PROD_RETRY_WAITS = [2000, 6000] as const;

export type OaQueryPayload = ReturnType<typeof oaQueryFromPub>;

/** The metadata prefetch is only an optimisation: it never holds the per-reference search longer than this. */
export const OA_BATCH_BUDGET_MS = 60_000;
/** One reference (lookup + PDF download, retries included) never takes longer than this. */
export const OA_ITEM_TIMEOUT_MS = 150_000;
/** One HTTP request to /api/oa/pdf is abandoned just before the edge itself would give up (~100 s), never earlier. */
export const OA_REQUEST_TIMEOUT_MS = 95_000;
/** The whole search always ends: no new reference starts after this budget (grows with the list). */
export const oaTotalBudgetMs = (n: number) => Math.min(15 * 60_000, 120_000 + n * 2_000);

export class OaDeadline extends Error {
  constructor(message = 'timeout') {
    super(message);
  }
}

/** An AbortSignal that fires after `ms` or when `parent` aborts (no AbortSignal.any/timeout: older Safari lacks them). */
export function timeoutSignal(ms: number, parent?: AbortSignal): AbortSignal {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new OaDeadline()), ms);
  ac.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  if (parent) {
    if (parent.aborted) ac.abort(parent.reason);
    else parent.addEventListener('abort', () => ac.abort(parent.reason), { once: true });
  }
  return ac.signal;
}

/** Resolves or rejects with `run`, or rejects with OaDeadline after `ms` even if `run` ignores its signal. */
export function withDeadline<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ac.abort(new OaDeadline());
      reject(new OaDeadline());
    }, ms);
  });
  return Promise.race([run(ac.signal), timeout]).finally(() => clearTimeout(timer));
}

export interface OaQueueOptions<P, R> {
  concurrency: number;
  run: (item: P, signal: AbortSignal) => Promise<R>;
  onStart?: (item: P) => void;
  onDone: (item: P, r: R) => void;
  onError: (item: P, e: Error) => void;
  itemTimeoutMs?: number;
  totalBudgetMs?: number;
  now?: () => number;
}

/**
 * Works through the queue with a few workers. Every item ends (done or error) within itemTimeoutMs, and items not
 * started before the total budget runs out end as OaDeadline errors, so the caller always finishes with partial results.
 */
export async function runOaQueue<P, R>(items: P[], o: OaQueueOptions<P, R>): Promise<void> {
  const now = o.now ?? Date.now;
  const itemMs = o.itemTimeoutMs ?? OA_ITEM_TIMEOUT_MS;
  const stopAt = now() + (o.totalBudgetMs ?? oaTotalBudgetMs(items.length));
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const item = items[i++];
      if (now() >= stopAt) {
        o.onError(item, new OaDeadline());
        continue;
      }
      o.onStart?.(item);
      try {
        o.onDone(item, await withDeadline((signal) => o.run(item, signal), Math.min(itemMs, Math.max(1, stopAt - now() + itemMs))));
      } catch (e) {
        o.onError(item, e instanceof Error ? e : new Error(String(e)));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(0, Math.min(o.concurrency, items.length)) }, worker));
}

/** Prefetches metadata via POST /api/oa/batch (warms edge cache; one round-trip per ≤24 refs), within a time budget. */
export async function oaBatchLookup(queries: OaQueryPayload[], baseUrl = '', budgetMs = OA_BATCH_BUDGET_MS): Promise<OaResult[]> {
  const root = baseUrl.replace(/\/$/, '');
  const out: OaResult[] = [];
  const stopAt = Date.now() + budgetMs;
  for (let i = 0; i < queries.length; i += OA_BATCH_MAX) {
    const left = stopAt - Date.now();
    if (left <= 0) break;
    const chunk = queries.slice(i, i + OA_BATCH_MAX);
    const res = await fetch(`${root}/api/oa/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({ queries: chunk }),
      signal: timeoutSignal(left),
    });
    if (res.status === 429 || res.status >= 500) {
      const ra = res.headers.get('retry-after');
      throw new Error(ra ? `${res.status} retry-after: ${ra}` : `${res.status} ${res.statusText}`);
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const body = (await res.json()) as { results?: OaResult[] };
    out.push(...(body.results ?? []));
  }
  return out;
}