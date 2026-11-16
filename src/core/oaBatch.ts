import { API_SAFETY_HEADERS, JSON_CSP, lookupOpenAccess, parseOaQuery, type OaOptions, type OaQuery, type OaResult } from './openAccess';

export const OA_BATCH_MAX = 24;
/** Lookups run a few at a time; none starts after the deadline, so the answer comes well under the edge's ~100 s. */
export const OA_BATCH_CONCURRENCY = 4;
export const OA_BATCH_DEADLINE_MS = 25_000;

export function parseOaBatchBody(body: unknown): OaQuery[] | undefined {
  const raw = (body as { queries?: unknown })?.queries;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > OA_BATCH_MAX) return undefined;
  const out: OaQuery[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const p = new URLSearchParams();
    for (const f of ['doi', 'title', 'author', 'arxiv', 'kind'] as const) {
      if (typeof o[f] === 'string') p.set(f, o[f] as string);
    }
    if (typeof o.year === 'number' || typeof o.year === 'string') p.set('year', String(o.year));
    const q = parseOaQuery(p);
    if (q) out.push(q);
  }
  return out.length ? out : undefined;
}

export async function handleOaBatchRequest(body: unknown, f: typeof fetch, opts: OaOptions = {}, deadlineMs = OA_BATCH_DEADLINE_MS): Promise<Response> {
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...API_SAFETY_HEADERS, ...JSON_CSP },
    });
  const queries = parseOaBatchBody(body);
  if (!queries) return json({ error: 'Envie { "queries": [ { "doi" | "title" ... }, ... ] } (máx. 24).' }, 400);
  const results: (OaResult | undefined)[] = new Array(queries.length);
  // No new lookup starts after the deadline, but started ones are awaited: a lookup left running after the response
  // would be joined by a later /api/oa/pdf request (in-flight coalescing) and fail there as a cross-request promise.
  const stopAt = Date.now() + deadlineMs;
  let i = 0;
  const worker = async () => {
    while (i < queries.length && Date.now() < stopAt) {
      const k = i++;
      results[k] = await lookupOpenAccess(queries[k], f, opts).catch(() => undefined);
    }
  };
  await Promise.all(Array.from({ length: Math.min(OA_BATCH_CONCURRENCY, queries.length) }, worker));
  const ready = results.filter((r): r is OaResult => Boolean(r));
  return json({ results: ready, ...(ready.length < queries.length ? { partial: true } : {}) });
}