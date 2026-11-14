/**
 * /api/oa/graph: links between the references of one document, from OpenAlex.
 *
 * The browser sends up to 50 references (DOI, OpenAlex id, or title + year + first author, never the document) and
 * gets back, for each one it could identify, the OpenAlex work id, its type, year, global citation count, primary
 * topic and the ids of the works it references. The browser intersects those lists to draw reference → reference
 * citations and shared-reference (bibliographic coupling) links, and groups the references by topic.
 *
 * Upstream cost is kept low: DOIs and ids are resolved in one batched OpenAlex call each (filter doi:A|B|C), only
 * title-only references need one search each (capped per request), and every answer is cached. The OpenAlex API
 * key stays on the server (Pages env OPENALEX_API_KEY); it is never echoed back.
 */
import {
  API_SAFETY_HEADERS,
  JSON_CSP,
  RateLimited,
  TimedOut,
  callJson,
  foldText,
  memoryCache,
  oaContext,
  parseOaQuery,
  titleSimilarity,
  withOpenAlexKey,
  type Ctx,
  type OaCache,
  type OaOptions,
  type OaQuery,
} from './openAccess.js';

export const GRAPH_MAX_ITEMS = 50;
/** Title searches are the expensive OpenAlex call: at most this many per request. */
export const GRAPH_MAX_SEARCHES = 20;
export const GRAPH_MAX_BODY = 64 * 1024;
/** Referenced-work ids kept per work (a few review articles list 1000+). */
const MAX_REFS = 400;
const TTL_WORK = 14 * 24 * 3600;
const TTL_MISS = 24 * 3600;
const SELECT = 'id,doi,display_name,title,publication_year,type,cited_by_count,referenced_works,primary_topic,authorships';
const OA_ID_RE = /^W\d{1,12}$/;

export interface GraphItem {
  /** Opaque client key (the reference's node id), echoed back. */
  key: string;
  doi?: string;
  openalexId?: string;
  title?: string;
  year?: number;
  author?: string;
}

export interface GraphTopicLevel {
  id: string;
  name: string;
}

export interface GraphWork {
  id: string;
  type?: string;
  year?: number;
  citedBy?: number;
  /** OpenAlex ids ("W123") of the works this one references. */
  refs: string[];
  topic?: GraphTopicLevel & { subfield?: GraphTopicLevel; field?: GraphTopicLevel };
}

export type GraphItemStatus = 'found' | 'not_found' | 'busy' | 'skipped';

export interface GraphResponse {
  works: Record<string, GraphWork>;
  status: Record<string, GraphItemStatus>;
  /** True when OpenAlex throttled or timed out for part of the batch: retry those keys later. */
  busy: boolean;
}

interface OpenAlexTopic {
  id?: string;
  display_name?: string;
  subfield?: { id?: string; display_name?: string } | null;
  field?: { id?: string; display_name?: string } | null;
}
interface OpenAlexGraphWork {
  id?: string;
  doi?: string | null;
  display_name?: string | null;
  title?: string | null;
  publication_year?: number | null;
  type?: string | null;
  cited_by_count?: number | null;
  referenced_works?: string[] | null;
  primary_topic?: OpenAlexTopic | null;
  authorships?: { author?: { display_name?: string } }[] | null;
}

const shortId = (u: string | undefined | null) => (u ?? '').replace(/^https?:\/\/openalex\.org\//i, '').replace(/^https?:\/\/openalex\.org\/[a-z]+\//i, '');
const level = (x: { id?: string; display_name?: string } | null | undefined): GraphTopicLevel | undefined =>
  x?.id && x.display_name ? { id: shortId(x.id).replace(/^.*\//, '') || x.id, name: String(x.display_name).slice(0, 80) } : undefined;

/** Keeps only what the graph needs, with ids shortened ("https://openalex.org/W1" → "W1"). */
export function toGraphWork(w: OpenAlexGraphWork): GraphWork | undefined {
  const id = shortId(w.id);
  if (!OA_ID_RE.test(id)) return undefined;
  const refs = (w.referenced_works ?? []).map(shortId).filter((r) => OA_ID_RE.test(r)).slice(0, MAX_REFS);
  const t = w.primary_topic;
  const topic = level(t);
  return {
    id,
    type: w.type ? String(w.type).slice(0, 40) : undefined,
    year: typeof w.publication_year === 'number' ? w.publication_year : undefined,
    citedBy: typeof w.cited_by_count === 'number' ? w.cited_by_count : undefined,
    refs,
    topic: topic ? { ...topic, subfield: level(t?.subfield), field: level(t?.field) } : undefined,
  };
}

/** Validates the request body. Unknown fields are dropped; DOIs and titles are normalized like /api/oa/lookup. */
export function parseGraphItems(body: unknown): GraphItem[] | undefined {
  const raw = (body as { items?: unknown })?.items;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > GRAPH_MAX_ITEMS) return undefined;
  const out: GraphItem[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const key = typeof o.key === 'string' ? o.key.slice(0, 80) : '';
    if (!key || seen.has(key)) continue;
    const p = new URLSearchParams();
    for (const f of ['doi', 'title', 'author'] as const) if (typeof o[f] === 'string') p.set(f, o[f] as string);
    if (typeof o.year === 'number' || typeof o.year === 'string') p.set('year', String(o.year));
    const q = parseOaQuery(p);
    const oid = typeof o.openalexId === 'string' && OA_ID_RE.test(o.openalexId) ? o.openalexId : undefined;
    if (!q && !oid) continue;
    seen.add(key);
    out.push({ key, openalexId: oid, doi: q?.doi, title: q?.title, year: q?.year, author: q?.author });
  }
  return out.length ? out : undefined;
}

type CacheEntry = { w?: GraphWork };
const cacheKey = (it: GraphItem) => (it.openalexId ? `g1|id|${it.openalexId}` : it.doi ? `g1|doi|${it.doi}` : `g1|t|${foldText(it.title ?? '')}|${it.year ?? ''}|${foldText(it.author ?? '')}`);

let defaultGraphCache: OaCache = memoryCache(2000);
export function resetGraphCache() {
  defaultGraphCache = memoryCache(2000);
}

async function batch(ctx: Ctx, filter: string, values: string[]): Promise<OpenAlexGraphWork[]> {
  if (!values.length) return [];
  const url = withOpenAlexKey(ctx, `https://api.openalex.org/works?filter=${filter}:${values.map(encodeURIComponent).join('|')}&select=${SELECT}&per-page=${GRAPH_MAX_ITEMS}`);
  const res = await callJson<{ results?: OpenAlexGraphWork[] }>(ctx, 'OpenAlex', url, undefined, 'OpenAlex:get');
  return res?.results ?? [];
}

async function searchOne(ctx: Ctx, q: OaQuery): Promise<OpenAlexGraphWork | undefined> {
  if (!q.title) return undefined;
  const filter = q.year ? `&filter=publication_year:${q.year - 1}-${q.year + 1}` : '';
  const url = withOpenAlexKey(ctx, `https://api.openalex.org/works?search=${encodeURIComponent(q.title)}${filter}&select=${SELECT}&per-page=6`);
  const res = await callJson<{ results?: OpenAlexGraphWork[] }>(ctx, 'OpenAlex', url, undefined, 'OpenAlex:search');
  const author = q.author ? (foldText(q.author).split(' ').pop() ?? '') : '';
  let best: { w: OpenAlexGraphWork; s: number } | undefined;
  for (const w of res?.results ?? []) {
    let s = titleSimilarity(q.title, w.title ?? w.display_name ?? '');
    if (author && (w.authorships ?? []).some((a) => foldText(a.author?.display_name ?? '').split(' ').includes(author))) s += 0.1;
    if (q.year && w.publication_year === q.year) s += 0.05;
    if (!best || s > best.s) best = { w, s };
  }
  return best && best.s >= 0.8 ? best.w : undefined;
}

const isBusy = (e: unknown) => e instanceof RateLimited || e instanceof TimedOut;

/** Resolves a batch of references to OpenAlex works (cached). */
export async function resolveGraphItems(items: GraphItem[], f: typeof fetch = fetch, opts: OaOptions = {}): Promise<GraphResponse> {
  const ctx = oaContext(f, opts);
  const cache = (opts.cache ?? defaultGraphCache) as unknown as { get(k: string): Promise<CacheEntry | undefined>; put(k: string, v: CacheEntry, ttl: number): Promise<void> };
  const works: Record<string, GraphWork> = {};
  const status: Record<string, GraphItemStatus> = {};
  let busy = false;
  const todo: GraphItem[] = [];
  for (const it of items) {
    const hit = await cache.get(cacheKey(it));
    if (!hit) todo.push(it);
    else if (hit.w) ((works[it.key] = hit.w), (status[it.key] = 'found'));
    else status[it.key] = 'not_found';
  }
  const found = new Map<string, GraphWork>(); // item key -> work
  const settle = async (it: GraphItem, w: GraphWork | undefined) => {
    status[it.key] = w ? 'found' : 'not_found';
    if (w) works[it.key] = w;
    await cache.put(cacheKey(it), { w }, w ? TTL_WORK : TTL_MISS);
  };

  // 1) OpenAlex ids, 2) DOIs: one batched call each ('|' and ',' would break the OR filter: those go by title)
  const byId = todo.filter((it) => it.openalexId);
  const byDoi = todo.filter((it) => !it.openalexId && it.doi && !/[|,]/.test(it.doi));
  for (const [filter, group, val] of [
    ['openalex', byId, (it: GraphItem) => it.openalexId as string],
    ['doi', byDoi, (it: GraphItem) => it.doi as string],
  ] as const) {
    if (!group.length) continue;
    try {
      const rows = await batch(ctx, filter, group.map(val));
      const index = new Map<string, GraphWork>();
      for (const r of rows) {
        const w = toGraphWork(r);
        if (!w) continue;
        index.set(filter === 'doi' ? (r.doi ?? '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase() : w.id, w);
      }
      for (const it of group) {
        const w = index.get(val(it).toLowerCase()) ?? index.get(val(it));
        if (w) {
          found.set(it.key, w);
          await settle(it, w);
        }
      }
    } catch (e) {
      if (!isBusy(e)) throw e;
      busy = true;
      for (const it of group) status[it.key] = 'busy';
    }
  }

  // 3) the rest by title (a DOI unknown to OpenAlex may still be found by its title)
  const rest = todo.filter((it) => !found.has(it.key) && status[it.key] !== 'busy');
  const searchable = rest.filter((it) => it.title);
  for (const it of rest) if (!it.title) await settle(it, undefined);
  let searches = 0;
  const queue = [...searchable];
  const worker = async () => {
    for (let it = queue.shift(); it; it = queue.shift()) {
      if (searches >= GRAPH_MAX_SEARCHES) {
        status[it.key] = 'skipped';
        continue;
      }
      searches++;
      try {
        const w = await searchOne(ctx, { title: it.title, year: it.year, author: it.author });
        await settle(it, w ? toGraphWork(w) : undefined);
      } catch (e) {
        if (!isBusy(e)) status[it.key] = 'not_found';
        else ((busy = true), (status[it.key] = 'busy'));
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { works, status, busy };
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...API_SAFETY_HEADERS, ...JSON_CSP } });

/** Full POST handling, shared by the Pages Function and the local server. */
export async function handleGraphRequest(request: Request, f: typeof fetch = fetch, opts: OaOptions = {}): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) return json({ error: 'JSON only' }, 415);
  const text = await request.text();
  if (text.length > GRAPH_MAX_BODY) return json({ error: 'Too many references' }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'Bad JSON' }, 400);
  }
  const items = parseGraphItems(body);
  if (!items) return json({ error: `Send 1 to ${GRAPH_MAX_ITEMS} references with a DOI, an OpenAlex id or a title.` }, 400);
  try {
    return json(await resolveGraphItems(items, f, opts));
  } catch {
    return json({ error: 'Catalogue unavailable' }, 502);
  }
}


