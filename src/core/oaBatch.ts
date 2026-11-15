import { API_SAFETY_HEADERS, JSON_CSP, lookupOpenAccess, parseOaQuery, type OaOptions, type OaQuery, type OaResult } from './openAccess';

export const OA_BATCH_MAX = 24;

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

export async function handleOaBatchRequest(body: unknown, f: typeof fetch, opts: OaOptions = {}): Promise<Response> {
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...API_SAFETY_HEADERS, ...JSON_CSP },
    });
  const queries = parseOaBatchBody(body);
  if (!queries) return json({ error: 'Envie { "queries": [ { "doi" | "title" ... }, ... ] } (máx. 24).' }, 400);
  const results: OaResult[] = [];
  for (const q of queries) results.push(await lookupOpenAccess(q, f, opts));
  return json({ results });
}