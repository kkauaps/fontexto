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

/** Prefetches metadata via POST /api/oa/batch (warms edge cache; one round-trip per ≤24 refs). */
export async function oaBatchLookup(queries: OaQueryPayload[], baseUrl = ''): Promise<OaResult[]> {
  const root = baseUrl.replace(/\/$/, '');
  const out: OaResult[] = [];
  for (let i = 0; i < queries.length; i += OA_BATCH_MAX) {
    const chunk = queries.slice(i, i + OA_BATCH_MAX);
    const res = await fetch(`${root}/api/oa/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({ queries: chunk }),
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