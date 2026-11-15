/**
 * Open-access lookup for "só o documento": given what the reference list says about a work (DOI, or title + year +
 * first author), find the work in OpenAlex (or Crossref) and list the free, legal copies that open catalogues know
 * about: OpenAlex, Unpaywall, Semantic Scholar, Europe PMC, CORE (only with an API key) and arXiv.
 *
 * Only legal open-access sources are queried: publisher OA, institutional/subject repositories and preprint
 * servers. Shadow libraries are deliberately not supported.
 *
 * Runs on the server side (Cloudflare Pages Function, or the local server of the desktop edition) because those
 * PDF hosts do not allow cross-origin downloads. Only the reference's DOI/title/year/author/arXiv id leave the browser,
 * never the document. Candidate URLs come from those catalogues, never from the request, so this is not an open
 * proxy. Nothing is logged.
 */

export interface OaQuery {
  doi?: string;
  title?: string;
  year?: number;
  author?: string;
  /** arXiv id (e.g. "1809.10486"), when the reference cites a preprint. */
  arxiv?: string;
  /** "thesis": title searches look among dissertations, with a wider year window (defence vs. deposit year). */
  kind?: 'thesis';
}

export type OaStatus = 'oa' | 'closed' | 'not_found';
/** Which version of the work a copy is. "unknown" when the catalogue does not say. */
export type OaVersion = 'published' | 'accepted' | 'preprint' | 'unknown';
/** Who hosts the copy. Preference order: publisher > repository > preprint server. */
export type OaHost = 'publisher' | 'repository' | 'preprint';
export type OaSourceName = 'OpenAlex' | 'Crossref' | 'Unpaywall' | 'Semantic Scholar' | 'Europe PMC' | 'CORE' | 'arXiv';
export type OaSourceStatus = 'found' | 'none' | 'error' | 'timeout' | 'rate_limited' | 'skipped';

export interface OaCandidate {
  url: string;
  /** Human label of where the copy lives ("PLOS Medicine", "Europe PMC", "arXiv", a repository host). */
  source: string;
  host: OaHost;
  version: OaVersion;
  license?: string;
  /** Catalogues that pointed to this copy. */
  via: OaSourceName[];
}

export interface OaResult {
  status: OaStatus;
  title?: string;
  doi?: string;
  year?: number;
  openalexId?: string;
  /** Page where the work can be read/bought (DOI link, publisher). */
  landingUrl?: string;
  /** Free PDF candidates, best first (publisher > repository > preprint; published > accepted > preprint). */
  pdfUrls: OaCandidate[];
  /** Free copies readable online that are not a direct PDF link (HTML full text, repository record). */
  readUrls?: OaCandidate[];
  /** First authors as the catalogues list them (for the "ask the author" message). */
  authors?: string[];
  /** Corresponding author's e-mail, only when it is printed in public metadata (affiliation strings). */
  contactEmail?: string;
  contactName?: string;
  /** What each catalogue answered (diagnostics; no query data). */
  sources?: { name: OaSourceName; status: OaSourceStatus; detail?: string }[];
  cached?: boolean;
}

/** Optional settings (environment variables on the Pages project / local server). */
export interface OaEnv {
  /** CORE API v3 key (https://core.ac.uk/services/api). Without it CORE is skipped. */
  CORE_API_KEY?: string;
  /** Semantic Scholar API key (optional, higher rate limit). */
  S2_API_KEY?: string;
  /**
   * OpenAlex API key (free at openalex.org/settings/api). Without it every keyless request from the same IP shares
   * $0.10/day, i.e. about 100 title searches, and the proxy falls back to Crossref for the rest of the day.
   */
  OPENALEX_API_KEY?: string;
}

/** Tiny async key/value cache: in-memory by default, the Cache API on Cloudflare. */
export interface OaCache {
  get(key: string): Promise<OaResult | undefined>;
  put(key: string, value: OaResult, ttlSeconds: number): Promise<void>;
}

export interface OaOptions {
  env?: OaEnv;
  cache?: OaCache;
  /** Per-request timeout for each catalogue call (ms). */
  timeoutMs?: number;
  /** Clock, for tests. */
  now?: () => number;
}

type Fetch = typeof fetch;
/** Polite contact required by OpenAlex, Unpaywall and Crossref. */
export const OA_CONTACT = 'contact@xoryn.com.br';
const UA = `Fontexto/1.0 (+https://fontexto.com; mailto:${OA_CONTACT})`;
const withMail = (url: string) => `${url}${url.includes('?') ? '&' : '?'}mailto=${encodeURIComponent(OA_CONTACT)}`;
export const withOpenAlexKey = (ctx: { env: OaEnv }, url: string) => {
  const u = withMail(url);
  return ctx.env.OPENALEX_API_KEY ? `${u}&api_key=${encodeURIComponent(ctx.env.OPENALEX_API_KEY)}` : u;
};
export const MAX_PDF_BYTES = 40 * 1024 * 1024;
export const MAX_PDF_REDIRECTS = 5;
export const DEFAULT_TIMEOUT_MS = 8_000;
export const PDF_FETCH_TIMEOUT_MS = 20_000;
// no whitespace, '?', '#', '%' or '\\', and no '..' segment: the DOI is put in catalogue URL paths as is
const DOI_RE = /^10\.\d{4,9}\/(?!(?:.*\/)?\.\.(?:\/|$))[^\s?#%\\]{1,200}$/;
const TTL_FOUND = 30 * 24 * 3600;
const TTL_MISS = 5 * 24 * 3600;
const TTL_ERROR = 60;

// Unicode-aware: Cyrillic, Greek, CJK... must survive (a-z only turned every Russian or Chinese title into "").
const fold = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const HAN = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u;
/** Words of 3+ letters; CJK runs (no spaces between words) become character bigrams. */
const tokens = (s: string) => {
  const out = new Set<string>();
  for (const w of fold(s).split(' ')) {
    if (HAN.test(w)) for (let i = 0; i + 1 < w.length; i++) out.add(w.slice(i, i + 2));
    else if (w.length > 2) out.add(w);
  }
  return out;
};
/** Drops trailing access-date / URL tails common in ABNT and similar styles. */
export function normalizeBibliographicTitle(title: string): string {
  let t = title.replace(/\s+/g, ' ').trim();
  t = t.replace(/\s+(Dispon[ií]vel em|Acesso em|Available at|Accessed|Retrieved).*/i, '');
  t = t.replace(/\s+DOI:.*$/i, '');
  return t.trim();
}

/** Same stem or a long shared prefix, so Latinate pairs like "lumen"/"lumen" and "fictional"/"ficticio" count. */
export function tokensClose(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5) return false;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  const norm = (t: string) => t.replace(/h/g, '');
  const x = norm(a);
  const y = norm(b);
  if (x === y) return true;
  if (x.length >= 5 && y.length >= 5 && (x.startsWith(y) || y.startsWith(x) || x.slice(0, 5) === y.slice(0, 5))) return true;
  return false;
}

function tokenOverlap(a: string, b: string, minLen = 0): { inter: number; x: Set<string>; y: Set<string> } {
  const keep = (t: string) => t.length >= minLen;
  const x = new Set([...tokens(a)].filter(keep));
  const y = new Set([...tokens(b)].filter(keep));
  const yList = [...y];
  const used = new Set<number>();
  let inter = 0;
  for (const t of x) {
    const i = yList.findIndex((u, k) => !used.has(k) && tokensClose(t, u));
    if (i >= 0) {
      used.add(i);
      inter++;
    }
  }
  return { inter, x, y };
}

/**
 * Token overlap between two titles. A long title that fully contains a shorter one (bilingual catalog
 * records that prepend an English translation) scores as a match, not a miss.
 */
export function titleSimilarity(a: string, b: string): number {
  const { inter, x, y } = tokenOverlap(a, b);
  if (!x.size || !y.size) return 0;
  const jaccardMax = inter / Math.max(x.size, y.size);
  const containment = inter / Math.min(x.size, y.size);
  if (Math.min(x.size, y.size) >= 4 && containment >= 0.8) return Math.max(jaccardMax, 0.75 + 0.25 * containment);
  return jaccardMax;
}

const ARXIV_NEW_RE = /^\d{4}\.\d{4,5}$/;
const ARXIV_OLD_RE = /^[a-z]{1,32}(?:-[a-z]{1,32}){0,4}\/\d{7}$/;

/** Normalises an arXiv id from a query param, a URL, or "arXiv:...." */
export function parseArxivId(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  let s = raw.trim().slice(0, 120).toLowerCase();
  if (!s) return undefined;
  const abs = s.indexOf('arxiv.org/abs/');
  const pdf = s.indexOf('arxiv.org/pdf/');
  if (abs >= 0) s = s.slice(abs + 14);
  else if (pdf >= 0) s = s.slice(pdf + 14);
  else if (s.startsWith('arxiv:')) s = s.slice(6).trimStart();
  if (s.endsWith('.pdf')) s = s.slice(0, -4);
  const v = s.search(/v\d+$/);
  if (v > 0) s = s.slice(0, v);
  return ARXIV_NEW_RE.test(s) || ARXIV_OLD_RE.test(s) ? s : undefined;
}

/** Validates and normalises a query coming from the network. */
export function parseOaQuery(params: URLSearchParams): OaQuery | undefined {
  const doi = params.get('doi')?.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').toLowerCase();
  const titleRaw = params.get('title')?.replace(/\s+/g, ' ').trim().slice(0, 300);
  const title = titleRaw ? normalizeBibliographicTitle(titleRaw) : undefined;
  const year = Number(params.get('year')) || undefined;
  const author = params.get('author')?.trim().slice(0, 80);
  const kind = params.get('kind') === 'thesis' ? ('thesis' as const) : undefined;
  const arxiv = parseArxivId(params.get('arxiv'));
  const extra = { ...(kind ? { kind } : {}), ...(arxiv ? { arxiv } : {}) };
  if (doi && DOI_RE.test(doi)) return { doi, title, year, author, ...extra };
  if (arxiv) return { arxiv, title, year: year && year > 1500 && year < 2100 ? year : undefined, author, ...(kind ? { kind } : {}) };
  if (title && title.length >= 8) return { title, year: year && year > 1500 && year < 2100 ? year : undefined, author, ...extra };
  return undefined;
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Rate limits, timeouts, cache                                                                                   */
/* ------------------------------------------------------------------------------------------------------------ */

/** Per-catalogue cool-down after a 429 (honours Retry-After, capped), shared by requests of this isolate/process. */
const cooldownUntil = new Map<string, number>();
/** Minimum spacing between calls to catalogues that ask for it (arXiv: one request every 3 s). */
const MIN_GAP: Partial<Record<OaSourceName, number>> = { arXiv: 3000, 'Semantic Scholar': 1000 };
const lastCall = new Map<OaSourceName, number>();
/** Last non-OK HTTP status per upstream bucket (for diagnostics only). */
const lastHttp = new Map<string, number>();
/** Catalogues that are often slower than the rest get a longer timeout (multiplier). */
const SLOW: Partial<Record<OaSourceName, number>> = { 'Europe PMC': 1.5 };

/** For tests: forget cool-downs, spacing and the default in-memory cache. */
export function resetOaState() {
  cooldownUntil.clear();
  lastCall.clear();
  lastHttp.clear();
  defaultCache = memoryCache();
  inflightLookups.clear();
}

export class RateLimited extends Error {}
export class TimedOut extends Error {}

export interface Ctx {
  f: Fetch;
  env: OaEnv;
  timeoutMs: number;
  now: () => number;
}

async function call(ctx: Ctx, name: OaSourceName, url: string, headers: Record<string, string> = {}, bucket: string = name): Promise<Response | undefined> {
  const now = ctx.now();
  if ((cooldownUntil.get(bucket) ?? 0) > now) throw new RateLimited();
  const gap = MIN_GAP[name];
  if (gap) {
    const wait = (lastCall.get(name) ?? 0) + gap - now;
    // Queue up to 8 s so Semantic Scholar's 1 rps spacing is honoured instead of skipped as rate_limited.
    if (wait > 8000) throw new RateLimited();
    lastCall.set(name, Math.max(now, (lastCall.get(name) ?? 0) + gap));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  const ac = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort();
  }, ctx.timeoutMs * (SLOW[name] ?? 1));
  try {
    // call fetch unbound: on Workers, fetch invoked as a method of another object throws "Illegal invocation"
    const f = ctx.f;
    const r = await f(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: ac.signal });
    if (r.status === 429) {
      const ra = Number(r.headers.get('retry-after'));
      cooldownUntil.set(bucket, ctx.now() + Math.min(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 60_000, 10 * 60_000));
      void r.body?.cancel();
      throw new RateLimited();
    }
    if (!r.ok) {
      lastHttp.set(bucket, r.status);
      void r.body?.cancel();
      return undefined;
    }
    lastHttp.delete(bucket);
    return r;
  } catch (e) {
    if (e instanceof RateLimited) throw e;
    if (timedOut) throw new TimedOut();
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function callJson<T>(ctx: Ctx, name: OaSourceName, url: string, headers?: Record<string, string>, bucket?: string): Promise<T | undefined> {
  const r = await call(ctx, name, url, headers, bucket);
  if (!r) return undefined;
  try {
    return (await r.json()) as T;
  } catch {
    return undefined;
  }
}

/** In-memory LRU with TTL (used directly by the local server, and as L1 in front of the Cache API). */
export function memoryCache(max = 500, now: () => number = Date.now): OaCache {
  const m = new Map<string, { v: OaResult; exp: number }>();
  return {
    async get(k) {
      const e = m.get(k);
      if (!e) return undefined;
      if (e.exp < now()) {
        m.delete(k);
        return undefined;
      }
      m.delete(k);
      m.set(k, e);
      return structuredClone(e.v);
    },
    async put(k, v, ttl) {
      m.set(k, { v: structuredClone(v), exp: now() + ttl * 1000 });
      while (m.size > max) m.delete(m.keys().next().value as string);
    },
  };
}

/** Cloudflare Cache API adapter (edge cache, per data centre). */
/** The two methods of the Cache API used here (structural, so the Node build does not need DOM types). */
export interface EdgeCacheStore {
  match(req: Request): Promise<Response | undefined>;
  put(req: Request, res: Response): Promise<void>;
}
export function edgeCache(cache: EdgeCacheStore, l1: OaCache = memoryCache()): OaCache {
  const req = (k: string) => new Request(`https://oa-cache.fontexto.invalid/${encodeURIComponent(k)}`);
  return {
    async get(k) {
      const hit = await l1.get(k);
      if (hit) return hit;
      try {
        const r = await cache.match(req(k));
        if (!r) return undefined;
        const v = (await r.json()) as OaResult;
        await l1.put(k, v, 3600);
        return v;
      } catch {
        return undefined;
      }
    },
    async put(k, v, ttl) {
      await l1.put(k, v, Math.min(ttl, 3600));
      try {
        await cache.put(req(k), new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` } }));
      } catch {
        /* cache unavailable */
      }
    },
  };
}

let defaultCache = memoryCache();
const inflightLookups = new Map<string, Promise<OaResult>>();
/** Shared catalogue context (timeouts, keys, clock) for other /api/oa/* handlers. */
export const oaContext = (f: Fetch, opts: OaOptions = {}): Ctx => ({ f, env: opts.env ?? {}, timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, now: opts.now ?? Date.now });
export const foldText = (s: string) => fold(s);
// v5: longer edge TTLs, coalescing, contact@xoryn.com.br polite pool
export const oaCacheKey = (q: OaQuery) =>
  q.doi ? `v5|doi|${q.doi}` : q.arxiv ? `v5|arxiv|${q.arxiv}` : `v5|t|${fold(q.title ?? '')}|${q.year ?? ''}|${fold(q.author ?? '')}${q.kind ? `|${q.kind}` : ''}`;

/** OpenAlex `filter=` for a title search: ±1 year, or for theses type:dissertation with ±2 years. */
export function openAlexTitleFilter(q: OaQuery, extra: string[] = []): string {
  const parts: string[] = [...extra];
  if (q.kind === 'thesis') parts.push('type:dissertation');
  const w = q.kind === 'thesis' ? 2 : 1;
  if (q.year) parts.push(`publication_year:${q.year - w}-${q.year + w}`);
  return parts.length ? `&filter=${parts.join(',')}` : '';
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Candidates: classification, dedupe, ranking                                                                    */
/* ------------------------------------------------------------------------------------------------------------ */

const PREPRINT_HOSTS = /(^|\.)(arxiv\.org|biorxiv\.org|medrxiv\.org|chemrxiv\.org|ssrn\.com|researchsquare\.com|preprints\.org|osf\.io|psyarxiv\.com|socarxiv\.org|engrxiv\.org|eartharxiv\.org|techrxiv\.org|authorea\.com|scielo\.org\/preprints|preprints\.scielo\.org|zenodo\.org\/records\/preprint)$/i;
const REPOSITORY_HOSTS = /(^|\.)(europepmc\.org|ncbi\.nlm\.nih\.gov|core\.ac\.uk|semanticscholar\.org|hal\.science|hal\.archives-ouvertes\.fr|zenodo\.org|figshare\.com|repositorio|repository|eprints|dspace|handle\.net)/i;

export function versionOf(raw: string | null | undefined): OaVersion {
  const v = (raw ?? '').toLowerCase();
  if (v.startsWith('published')) return 'published';
  if (v.startsWith('accepted')) return 'accepted';
  if (v.startsWith('submitted') || v === 'preprint') return 'preprint';
  return 'unknown';
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/** Host type from the URL when the catalogue does not say (preprint servers and well-known repositories). */
export function hostFromUrl(url: string, fallback: OaHost = 'repository'): OaHost {
  const h = hostnameOf(url);
  if (PREPRINT_HOSTS.test(h) || /preprints\.scielo\.org/.test(h)) return 'preprint';
  if (REPOSITORY_HOSTS.test(h)) return 'repository';
  return fallback;
}

export function hostLabel(url: string): string {
  const h = hostnameOf(url);
  if (!h) return 'repository';
  if (/europepmc/.test(h)) return 'Europe PMC';
  if (/ncbi\.nlm\.nih\.gov/.test(h)) return 'PubMed Central';
  if (/arxiv/.test(h)) return 'arXiv';
  if (/biorxiv|medrxiv/.test(h)) return 'bioRxiv/medRxiv';
  if (/scielo/.test(h)) return 'SciELO';
  if (/core\.ac\.uk/.test(h)) return 'CORE';
  return h;
}

const arxivId = (u: string | null | undefined) => (u ? /arxiv\.org\/(?:abs|pdf)\/([^?#\s]+?)(?:\.pdf)?(?:v\d+)?$/i.exec(u)?.[1] : undefined);
const arxivPdf = (u: string | null | undefined) => {
  const id = arxivId(u);
  return id ? `https://arxiv.org/pdf/${id}` : undefined;
};
const pmcOf = (u: string | null | undefined) => (u ? /(?:ncbi\.nlm\.nih\.gov\/(?:pmc\/)?articles\/|europepmc\.org\/(?:articles?|abstract\/PMC)\/?)(?:PMC)?(\d+)/i.exec(u)?.[1] : undefined);
const europePmcPdf = (pmc: string) => `https://europepmc.org/articles/PMC${pmc.replace(/^PMC/i, '')}?pdf=render`;

/** Dedupe key: the same copy reached through different URLs counts once (arXiv id, PMC id, host + path). */
export function candidateKey(url: string): string {
  const ax = arxivId(url);
  if (ax) return `arxiv:${ax.toLowerCase()}`;
  const pmc = pmcOf(url);
  if (pmc) return `pmc:${pmc}`;
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '').toLowerCase()}${u.search}`;
  } catch {
    return url;
  }
}

const HOST_RANK: Record<OaHost, number> = { publisher: 0, repository: 1, preprint: 2 };
const VERSION_RANK: Record<OaVersion, number> = { published: 0, accepted: 1, unknown: 2, preprint: 3 };
export const rankCandidates = (list: OaCandidate[]) =>
  list
    .map((c, i) => ({ c, i }))
    .sort((a, b) => HOST_RANK[a.c.host] - HOST_RANK[b.c.host] || VERSION_RANK[a.c.version] - VERSION_RANK[b.c.version] || a.i - b.i)
    .map((x) => x.c);

class CandidateSet {
  private byKey = new Map<string, OaCandidate>();
  /** Hits per catalogue (duplicates included: a catalogue that confirms a copy did find it). */
  hits = new Map<OaSourceName, number>();
  add(c: { url: string | null | undefined; source?: string; host?: OaHost; version?: OaVersion; license?: string | null; via: OaSourceName }) {
    if (!c.url || !/^https?:\/\//i.test(c.url)) return;
    this.hits.set(c.via, (this.hits.get(c.via) ?? 0) + 1);
    let url = c.url.replace(/^http:\/\//i, 'https://');
    const ax = arxivPdf(url);
    if (ax) url = ax;
    const key = candidateKey(url);
    const host: OaHost = ax ? 'preprint' : (c.host ?? hostFromUrl(url));
    const version: OaVersion = c.version && c.version !== 'unknown' ? c.version : host === 'preprint' ? 'preprint' : 'unknown';
    const prev = this.byKey.get(key);
    if (!prev) {
      this.byKey.set(key, { url, source: c.source ?? hostLabel(url), host, version, license: c.license ?? undefined, via: [c.via] });
      return;
    }
    if (!prev.via.includes(c.via)) prev.via.push(c.via);
    if (prev.version === 'unknown' && version !== 'unknown') prev.version = version;
    if (!prev.license && c.license) prev.license = c.license;
    // a catalogue that knows the copy is the publisher's wins over a URL guess
    if (c.host === 'publisher' && prev.host === 'repository') prev.host = 'publisher';
  }
  list() {
    return rankCandidates([...this.byKey.values()]);
  }
  get size() {
    return this.byKey.size;
  }
  hitsOf(name: OaSourceName) {
    return this.hits.get(name) ?? 0;
  }
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Catalogues                                                                                                     */
/* ------------------------------------------------------------------------------------------------------------ */

interface OaLocation {
  pdf_url?: string | null;
  landing_page_url?: string | null;
  is_oa?: boolean;
  version?: string | null;
  license?: string | null;
  source?: { display_name?: string | null; type?: string | null } | null;
}
interface OpenAlexWork {
  id: string;
  doi?: string | null;
  title?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  ids?: { pmcid?: string; doi?: string };
  open_access?: { is_oa?: boolean; oa_url?: string | null };
  best_oa_location?: OaLocation | null;
  primary_location?: OaLocation | null;
  locations?: OaLocation[];
  authorships?: { author?: { display_name?: string }; is_corresponding?: boolean; raw_affiliation_strings?: string[] }[];
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
/** An e-mail printed in an affiliation string ("… Greece. someone@uni.example"), if any. */
export function emailIn(texts: (string | null | undefined)[]): string | undefined {
  for (const t of texts) {
    const m = t ? EMAIL_RE.exec(t) : null;
    if (m) return m[0].replace(/\.+$/, '').toLowerCase();
  }
  return undefined;
}

function crossrefToWork(m: {
  DOI?: string;
  title?: string[];
  'original-title'?: string[];
  URL?: string;
  issued?: { 'date-parts'?: number[][] };
  author?: { given?: string; family?: string }[];
  link?: { URL?: string; 'content-type'?: string }[];
  license?: { URL?: string }[];
}): OpenAlexWork {
  const title = [...(m.title ?? []), ...(m['original-title'] ?? [])].filter(Boolean).join(' ') || undefined;
  const year = m.issued?.['date-parts']?.[0]?.[0];
  const doi = m.DOI?.toLowerCase();
  // Crossref "link" entries are often text-mining links behind a licence: only trust them for CC-licensed works
  const cc = (m.license ?? []).map((l) => l.URL ?? '').find((u) => /creativecommons\.org/i.test(u));
  const pdfs: OaLocation[] = cc
    ? (m.link ?? []).filter((l) => /pdf/i.test(`${l['content-type'] ?? ''} ${l.URL ?? ''}`)).map((l) => ({ pdf_url: l.URL ?? null, landing_page_url: m.URL ?? null, is_oa: true, version: 'publishedVersion', license: cc, source: { type: 'journal' } }))
    : [];
  return {
    id: '',
    doi: doi ? `https://doi.org/${doi}` : null,
    title,
    display_name: title,
    publication_year: year ?? null,
    authorships: (m.author ?? []).map((a) => ({ author: { display_name: [a.given, a.family].filter(Boolean).join(' ') } })),
    primary_location: { landing_page_url: m.URL ?? null },
    best_oa_location: pdfs[0] ?? null,
    locations: pdfs,
  };
}

export function scoreBibliographicMatch(
  q: Pick<OaQuery, 'title' | 'year' | 'author'>,
  title: string,
  authors: string[],
  year?: number | null,
): number {
  const qt = normalizeBibliographicTitle(q.title ?? '');
  if (!qt) return 0;
  const nt = normalizeBibliographicTitle(title);
  let s = titleSimilarity(qt, nt);
  const author = q.author ? (fold(q.author).split(' ').pop() ?? '') : '';
  const authorMatch = Boolean(author && authors.some((a) => fold(a).split(' ').includes(author)));
  if (authorMatch) s += 0.12;
  let yearClose = false;
  if (q.year && year != null) {
    const delta = Math.abs(year - q.year);
    if (delta === 0) {
      s += 0.06;
      yearClose = true;
    } else if (delta === 1) {
      s += 0.02;
      yearClose = true;
    } else if (delta > 1) s -= Math.min(0.45, 0.1 + delta * 0.02);
  }
  // Catalogues often store only a translation. If the first author and year agree and enough
  // Latinate title tokens line up, treat it as the same work (still below a raw 1.0 exact title).
  if (authorMatch && yearClose) {
    const { inter, x } = tokenOverlap(qt, nt, 4);
    if (x.size >= 4 && inter >= 3 && inter / x.size >= 0.4) s = Math.max(s, 0.82);
  }
  return s;
}

function bestMatch<T>(items: T[], q: OaQuery, titleOf: (w: T) => string, authorsOf: (w: T) => string[], yearOf: (w: T) => number | null | undefined, min = 0.8, prefer?: (w: T) => number): T | undefined {
  if (!q.title) return undefined;
  const author = q.author ? (fold(q.author).split(' ').pop() ?? '') : '';
  const good: { w: T; s: number }[] = [];
  for (const w of items) {
    const s = scoreBibliographicMatch(q, titleOf(w), authorsOf(w), yearOf(w));
    if (author && s < 0.88 && !authorsOf(w).some((a) => fold(a).split(' ').includes(author))) continue;
    if (s >= min) good.push({ w, s });
  }
  good.sort((a, b) => b.s - a.s || (prefer?.(b.w) ?? 0) - (prefer?.(a.w) ?? 0));
  return good[0]?.w;
}

async function findWorkCrossref(ctx: Ctx, q: OaQuery): Promise<OpenAlexWork | undefined> {
  if (q.doi) {
    const w = await callJson<{ message?: Parameters<typeof crossrefToWork>[0] }>(ctx, 'Crossref', withMail(`https://api.crossref.org/works/${q.doi}`));
    if (w?.message) return crossrefToWork(w.message);
    return undefined;
  }
  if (!q.title) return undefined;
  const biblio = [q.author, q.title, q.year].filter(Boolean).join(' ');
  const params = new URLSearchParams({ 'query.bibliographic': biblio, rows: '15' });
  if (q.author) params.set('query.author', q.author);
  if (q.year) params.set('filter', `from-pub-date:${q.year - 1},until-pub-date:${q.year + 1}`);
  const res = await callJson<{ message?: { items?: Parameters<typeof crossrefToWork>[0][] } }>(ctx, 'Crossref', withMail(`https://api.crossref.org/works?${params.toString()}`));
  const works = (res?.message?.items ?? []).map(crossrefToWork);
  return bestMatch(works, q, workTitle, workAuthors, (w) => w.publication_year, 0.8, workPrefer);
}

async function findWorkOpenAlex(ctx: Ctx, q: OaQuery): Promise<OpenAlexWork | undefined> {
  if (q.doi) {
    // singleton lookups are free: they get their own cool-down, so an exhausted search budget does not block them
    const w = await callJson<OpenAlexWork>(ctx, 'OpenAlex', withOpenAlexKey(ctx, `https://api.openalex.org/works/doi:${encodeURIComponent(q.doi)}`), undefined, 'OpenAlex:get');
    if (w) {
      const found = (w.doi ?? '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase();
      if (!found || found === q.doi) return w;
    }
    return undefined;
  }
  if (!q.title) return undefined;
  const found = await searchOpenAlexTitle(ctx, q);
  if (!found) return undefined;
  // Title search often hits a language-variant record with no DOI; a sibling record has the DOI and OA PDF.
  if (workDoi(found)) return found;
  const resolved = await searchOpenAlexTitle(ctx, { ...q, title: workTitle(found) }, ['has_doi:true']);
  return resolved ?? found;
}

const workTitle = (w: OpenAlexWork) => w.display_name ?? w.title ?? '';
const workAuthors = (w: OpenAlexWork) => (w.authorships ?? []).map((a) => a.author?.display_name ?? '');
const workDoi = (w: OpenAlexWork) => (w.doi ?? w.ids?.doi ?? '').replace(/^https?:\/\/doi\.org\//i, '').trim();
const workPrefer = (w: OpenAlexWork) => (workDoi(w) ? 2 : 0) + (w.best_oa_location?.pdf_url ? 1 : 0);

async function searchOpenAlexTitle(ctx: Ctx, q: OaQuery, extra: string[] = []): Promise<OpenAlexWork | undefined> {
  if (!q.title) return undefined;
  const filter = openAlexTitleFilter(q, extra);
  const query = [q.title, q.author].filter(Boolean).join(' ');
  const res = await callJson<{ results: OpenAlexWork[] }>(ctx, 'OpenAlex', withOpenAlexKey(ctx, `https://api.openalex.org/works?search=${encodeURIComponent(query)}${filter}&per-page=15`), undefined, 'OpenAlex:search');
  return bestMatch(res?.results ?? [], q, workTitle, workAuthors, (w) => w.publication_year, 0.8, workPrefer);
}

function openAlexCandidates(w: OpenAlexWork, set: CandidateSet, via: OaSourceName) {
  for (const l of [w.best_oa_location, ...(w.locations ?? [])]) {
    if (!l || l.is_oa === false) continue;
    const declared: OaHost | undefined = l.source?.type === 'journal' || l.source?.type === 'conference' || l.source?.type === 'book series' ? 'publisher' : l.source?.type === 'repository' ? undefined : undefined;
    const label = l.source?.display_name ?? undefined;
    const pmc = pmcOf(l.pdf_url) ?? pmcOf(l.landing_page_url);
    if (pmc) set.add({ url: europePmcPdf(pmc), source: 'Europe PMC', host: 'repository', version: versionOf(l.version), license: l.license, via });
    const ax = arxivPdf(l.landing_page_url) ?? arxivPdf(l.pdf_url);
    if (ax) set.add({ url: ax, source: 'arXiv', host: 'preprint', version: 'preprint', license: l.license, via });
    if (l.pdf_url && !pmc && !ax) set.add({ url: l.pdf_url, source: label ?? hostLabel(l.pdf_url), host: declared, version: versionOf(l.version), license: l.license, via });
  }
  const pmc = w.ids?.pmcid ? pmcOf(w.ids.pmcid) ?? /PMC(\d+)/i.exec(w.ids.pmcid)?.[1] : undefined;
  if (pmc) set.add({ url: europePmcPdf(pmc), source: 'Europe PMC', host: 'repository', version: 'unknown', via });
}

/** OA pages without a PDF link (publisher HTML full text, repository records). */
function openAlexReadLinks(w: OpenAlexWork, set: CandidateSet, via: OaSourceName) {
  for (const l of [w.best_oa_location, ...(w.locations ?? [])]) {
    if (!l || !l.is_oa || l.pdf_url || !l.landing_page_url) continue;
    const declared: OaHost | undefined = l.source?.type === 'journal' || l.source?.type === 'conference' ? 'publisher' : undefined;
    set.add({ url: l.landing_page_url, source: l.source?.display_name ?? hostLabel(l.landing_page_url), host: declared, version: versionOf(l.version), license: l.license, via });
  }
}

interface UnpaywallLoc {
  url_for_pdf?: string | null;
  url?: string | null;
  url_for_landing_page?: string | null;
  host_type?: string | null;
  version?: string | null;
  license?: string | null;
  repository_institution?: string | null;
}
async function fromUnpaywall(ctx: Ctx, doi: string, pdfs: CandidateSet, reads: CandidateSet): Promise<boolean> {
  const upw = await callJson<{ is_oa?: boolean; best_oa_location?: UnpaywallLoc | null; oa_locations?: UnpaywallLoc[]; journal_name?: string | null }>(
    ctx,
    'Unpaywall',
    `https://api.unpaywall.org/v2/${doi}?email=${encodeURIComponent(OA_CONTACT)}`,
  );
  if (!upw) return false;
  const before = pdfs.hitsOf('Unpaywall') + reads.hitsOf('Unpaywall');
  for (const l of [upw.best_oa_location, ...(upw.oa_locations ?? [])]) {
    if (!l) continue;
    const host: OaHost | undefined = l.host_type === 'publisher' ? 'publisher' : undefined;
    const label = host === 'publisher' ? (upw.journal_name ?? undefined) : (l.repository_institution ?? undefined);
    const base = { host, version: versionOf(l.version), license: l.license, via: 'Unpaywall' as const };
    const ax = arxivPdf(l.url) ?? arxivPdf(l.url_for_pdf);
    if (ax) {
      pdfs.add({ ...base, url: ax, source: 'arXiv', host: 'preprint', version: 'preprint' });
      continue;
    }
    const pmc = pmcOf(l.url_for_pdf) ?? pmcOf(l.url);
    if (pmc) {
      pdfs.add({ ...base, url: europePmcPdf(pmc), source: 'Europe PMC', host: 'repository' });
      continue;
    }
    if (l.url_for_pdf) pdfs.add({ ...base, url: l.url_for_pdf, source: label ?? hostLabel(l.url_for_pdf) });
    else if (l.url) reads.add({ ...base, url: l.url_for_landing_page ?? l.url, source: label ?? hostLabel(l.url) });
  }
  return pdfs.hitsOf('Unpaywall') + reads.hitsOf('Unpaywall') > before;
}

async function fromSemanticScholar(ctx: Ctx, doi: string | undefined, title: string | undefined, pdfs: CandidateSet, arxiv?: string): Promise<boolean> {
  const headers = ctx.env.S2_API_KEY ? { 'x-api-key': ctx.env.S2_API_KEY } : undefined;
  type S2 = { title?: string; openAccessPdf?: { url?: string; status?: string; license?: string | null } | null; externalIds?: { ArXiv?: string; PubMedCentral?: string } };
  let s2: S2 | undefined;
  if (doi) s2 = await callJson<S2>(ctx, 'Semantic Scholar', `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=openAccessPdf,externalIds`, headers);
  if (!s2 && arxiv) s2 = await callJson<S2>(ctx, 'Semantic Scholar', `https://api.semanticscholar.org/graph/v1/paper/ARXIV:${encodeURIComponent(arxiv)}?fields=openAccessPdf,externalIds`, headers);
  if (!s2 && title) {
    const m = await callJson<{ data?: S2[] }>(ctx, 'Semantic Scholar', `https://api.semanticscholar.org/graph/v1/paper/search/match?query=${encodeURIComponent(title)}&fields=title,openAccessPdf,externalIds`, headers);
    s2 = m?.data?.find((p) => titleSimilarity(title, p.title ?? '') >= 0.85);
  }
  if (!s2) return false;
  const before = pdfs.hitsOf('Semantic Scholar');
  if (s2.externalIds?.ArXiv) pdfs.add({ url: `https://arxiv.org/pdf/${s2.externalIds.ArXiv}`, source: 'arXiv', host: 'preprint', version: 'preprint', via: 'Semantic Scholar' });
  if (s2.externalIds?.PubMedCentral) pdfs.add({ url: europePmcPdf(s2.externalIds.PubMedCentral), source: 'Europe PMC', host: 'repository', via: 'Semantic Scholar' });
  const oa = s2.openAccessPdf;
  if (oa?.url && oa.status !== 'CLOSED') {
    const st = (oa.status ?? '').toUpperCase();
    const host: OaHost | undefined = st === 'GOLD' || st === 'HYBRID' || st === 'BRONZE' || st === 'DIAMOND' ? 'publisher' : undefined;
    pdfs.add({ url: oa.url, host, version: host === 'publisher' ? 'published' : 'unknown', license: oa.license, via: 'Semantic Scholar' });
  } else if (oa?.url && arxivId(oa.url)) {
    pdfs.add({ url: oa.url, source: 'arXiv', host: 'preprint', version: 'preprint', via: 'Semantic Scholar' });
  }
  return pdfs.hitsOf('Semantic Scholar') > before;
}

interface EpmcResult {
  title?: string;
  source?: string;
  pmcid?: string;
  doi?: string;
  pubYear?: string;
  isOpenAccess?: string;
  inEPMC?: string;
  hasPDF?: string;
  license?: string;
  fullTextUrlList?: { fullTextUrl?: { availabilityCode?: string; documentStyle?: string; site?: string; url?: string }[] };
  authorList?: { author?: { fullName?: string; authorAffiliationDetailsList?: { authorAffiliation?: { affiliation?: string }[] } }[] };
}
async function fromEuropePmc(ctx: Ctx, doi: string | undefined, q: OaQuery, pdfs: CandidateSet, reads: CandidateSet): Promise<{ found: boolean; email?: string; name?: string }> {
  const query = doi ? `DOI:"${doi}"` : q.title ? `TITLE:"${q.title.replace(/["\\]/g, ' ')}"${q.year ? ` AND PUB_YEAR:${q.year}` : ''}` : '';
  if (!query) return { found: false };
  const res = await callJson<{ resultList?: { result?: EpmcResult[] } }>(ctx, 'Europe PMC', `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&resultType=core&pageSize=3`);
  const items = res?.resultList?.result ?? [];
  const r = doi ? items.find((x) => (x.doi ?? '').toLowerCase() === doi) ?? items[0] : items.find((x) => titleSimilarity(q.title ?? '', x.title ?? '') >= 0.85);
  if (!r) return { found: false };
  const before = pdfs.hitsOf('Europe PMC') + reads.hitsOf('Europe PMC');
  const preprint = r.source === 'PPR';
  const host: OaHost = preprint ? 'preprint' : 'repository';
  const version: OaVersion = preprint ? 'preprint' : 'unknown';
  const lic = r.license ?? undefined;
  if (r.pmcid && (r.isOpenAccess === 'Y' || (r.inEPMC === 'Y' && r.hasPDF === 'Y'))) pdfs.add({ url: europePmcPdf(r.pmcid), source: 'Europe PMC', host, version, license: lic, via: 'Europe PMC' });
  for (const u of r.fullTextUrlList?.fullTextUrl ?? []) {
    if (u.availabilityCode !== 'OA' && u.availabilityCode !== 'F') continue;
    if (!u.url) continue;
    const label = u.site === 'Europe_PMC' ? 'Europe PMC' : undefined;
    if (u.documentStyle === 'pdf') pdfs.add({ url: u.url, source: label, host: label ? host : undefined, version, license: lic, via: 'Europe PMC' });
    else if (u.documentStyle === 'html') reads.add({ url: u.url, source: label, host: label ? host : undefined, version, license: lic, via: 'Europe PMC' });
  }
  const authors = r.authorList?.author ?? [];
  for (const a of authors) {
    const email = emailIn((a.authorAffiliationDetailsList?.authorAffiliation ?? []).map((x) => x.affiliation));
    if (email) return { found: pdfs.hitsOf('Europe PMC') + reads.hitsOf('Europe PMC') > before, email, name: a.fullName };
  }
  return { found: pdfs.hitsOf('Europe PMC') + reads.hitsOf('Europe PMC') > before };
}

async function fromCore(ctx: Ctx, doi: string, pdfs: CandidateSet): Promise<OaSourceStatus> {
  if (!ctx.env.CORE_API_KEY) return 'skipped';
  const res = await callJson<{ results?: { downloadUrl?: string | null; sourceFulltextUrls?: string[] | null; doi?: string | null }[] }>(
    ctx,
    'CORE',
    `https://api.core.ac.uk/v3/search/works?q=${encodeURIComponent(`doi:"${doi}"`)}&limit=3`,
    { Authorization: `Bearer ${ctx.env.CORE_API_KEY}` },
  );
  const before = pdfs.hitsOf('CORE');
  for (const r of res?.results ?? []) {
    if (r.doi && r.doi.toLowerCase() !== doi) continue;
    if (r.downloadUrl) pdfs.add({ url: r.downloadUrl, source: 'CORE', host: hostFromUrl(r.downloadUrl), version: 'unknown', via: 'CORE' });
  }
  return pdfs.hitsOf('CORE') > before ? 'found' : 'none';
}

/**
 * arXiv e-print whose title matches (>= 0.85 token overlap). Short titles ("Deep learning") match too many papers,
 * so they also need the first author's family name in the entry.
 */
/** Legal arXiv PDF for a known e-print id (no catalogue call). */
function fromArxivById(id: string, pdfs: CandidateSet): boolean {
  const clean = parseArxivId(id);
  if (!clean) return false;
  pdfs.add({ url: `https://arxiv.org/pdf/${clean}`, source: 'arXiv', host: 'preprint', version: 'preprint', via: 'arXiv' });
  return true;
}

async function fromArxiv(ctx: Ctx, title: string, pdfs: CandidateSet, author?: string): Promise<boolean> {
  const words = fold(title).split(' ').filter((w) => w.length > 3).slice(0, 10);
  const family = author ? (fold(author).split(' ').pop() ?? '') : '';
  if (words.length < 2 || (words.length < 4 && !family)) return false;
  const r = await call(ctx, 'arXiv', `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(words.map((w) => `ti:${w}`).join(' AND '))}&max_results=5`);
  if (!r) return false;
  const xml = await r.text();
  for (const e of xml.split('<entry>').slice(1)) {
    const id = /<id>\s*https?:\/\/arxiv\.org\/abs\/([^<\s]+?)(?:v\d+)?\s*<\/id>/.exec(e)?.[1];
    const t = /<title>([\s\S]*?)<\/title>/.exec(e)?.[1] ?? '';
    const names = [...e.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) => fold(m[1]));
    if (family && names.length && !names.some((n) => n.split(' ').includes(family))) continue;
    if (id && titleSimilarity(title, t) >= 0.85) {
      pdfs.add({ url: `https://arxiv.org/pdf/${id}`, source: 'arXiv', host: 'preprint', version: 'preprint', via: 'arXiv' });
      return true;
    }
  }
  return false;
}

function sourceDetail(name: OaSourceName, status: OaSourceStatus): string | undefined {
  if (status === 'rate_limited') return 'http_429';
  if (status === 'timeout') return 'timeout';
  const code = lastHttp.get(name) ?? lastHttp.get(`${name}:search`) ?? lastHttp.get(`${name}:get`);
  if (code && status === 'error') return `http_${code}`;
  if (code && status === 'none') return `http_${code}`;
  return undefined;
}

/** Runs one catalogue and records how it went. */
async function step(statuses: Map<OaSourceName, OaSourceStatus>, name: OaSourceName, run: () => Promise<boolean | OaSourceStatus>) {
  try {
    const out = await run();
    const status = typeof out === 'string' ? out : out ? 'found' : (statuses.get(name) === 'found' ? 'found' : 'none');
    statuses.set(name, status);
  } catch (e) {
    statuses.set(name, e instanceof RateLimited ? 'rate_limited' : e instanceof TimedOut ? 'timeout' : 'error');
  }
}

/** Looks the work up and gathers its free legal copies (cached, coalesced per isolate). */
export async function lookupOpenAccess(q: OaQuery, f: Fetch = fetch, opts: OaOptions = {}): Promise<OaResult> {
  const cache = opts.cache ?? defaultCache;
  const key = oaCacheKey(q);
  const hit = await cache.get(key);
  if (hit) return { ...hit, cached: true };
  let work = inflightLookups.get(key);
  if (!work) {
    work = lookupOpenAccessWork(q, f, opts, cache, key);
    inflightLookups.set(key, work);
    void work.finally(() => inflightLookups.delete(key));
  }
  return { ...(await work) };
}

async function lookupOpenAccessWork(q: OaQuery, f: Fetch, opts: OaOptions, cache: OaCache, key: string): Promise<OaResult> {
  const ctx: Ctx = { f, env: opts.env ?? {}, timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, now: opts.now ?? Date.now };
  const statuses = new Map<OaSourceName, OaSourceStatus>();
  const pdfs = new CandidateSet();
  const reads = new CandidateSet();

  // 1) identify the work: without an OpenAlex key, prefer Crossref for title searches (shared keyless budget).
  let w: OpenAlexWork | undefined;
  let via: OaSourceName = 'OpenAlex';
  const noAlexKey = !ctx.env.OPENALEX_API_KEY;
  if (noAlexKey && q.title && !q.doi) {
    via = 'Crossref';
    await step(statuses, 'Crossref', async () => Boolean((w = await findWorkCrossref(ctx, q))));
    if (!w) await step(statuses, 'OpenAlex', async () => Boolean((w = await findWorkOpenAlex(ctx, q))));
  } else {
    await step(statuses, 'OpenAlex', async () => Boolean((w = await findWorkOpenAlex(ctx, q))));
    if (!w && (q.doi || q.title)) {
      via = 'Crossref';
      await step(statuses, 'Crossref', async () => Boolean((w = await findWorkCrossref(ctx, q))));
    }
  }
  const foundDoi = (w?.doi ?? '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase();
  if (q.doi && w && foundDoi && foundDoi !== q.doi) w = undefined;
  const work = w as OpenAlexWork | undefined;
  if (work) {
    openAlexCandidates(work, pdfs, via);
    openAlexReadLinks(work, reads, via);
  }
  const doi = (work?.doi ?? '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase() || q.doi;
  const title = work?.title ?? work?.display_name ?? q.title ?? undefined;

  // Known arXiv id: add the legal preprint PDF without a catalogue call (helps when a book-chapter DOI is closed).
  if (q.arxiv && fromArxivById(q.arxiv, pdfs)) statuses.set('arXiv', 'found');

  // 2) the catalogues of free copies, in parallel (each with its own timeout)
  let epmcEmail: { email?: string; name?: string } = {};
  await Promise.all([
    doi ? step(statuses, 'Unpaywall', () => fromUnpaywall(ctx, doi, pdfs, reads)) : (statuses.set('Unpaywall', 'skipped'), undefined),
    step(statuses, 'Semantic Scholar', () => fromSemanticScholar(ctx, doi, doi ? undefined : title, pdfs, q.arxiv)),
    step(statuses, 'Europe PMC', async () => {
      const r = await fromEuropePmc(ctx, doi, { ...q, title }, pdfs, reads);
      epmcEmail = r;
      return r.found;
    }),
    doi ? step(statuses, 'CORE', () => fromCore(ctx, doi, pdfs)) : (statuses.set('CORE', 'skipped'), undefined),
  ]);
  // 3) arXiv by title, last (strict rate limit), only when nothing else gave a PDF
  const firstAuthor = q.author ?? work?.authorships?.[0]?.author?.display_name;
  if (!statuses.has('arXiv')) {
    if (!pdfs.size && title) await step(statuses, 'arXiv', () => fromArxiv(ctx, title, pdfs, firstAuthor));
    else statuses.set('arXiv', pdfs.list().some((c) => c.host === 'preprint' && /arxiv/.test(c.url)) ? 'found' : 'skipped');
  }

  const sources = [...statuses].map(([name, status]) => ({ name, status, ...(sourceDetail(name, status) ? { detail: sourceDetail(name, status) } : {}) }));
  const pdfList = pdfs.list();
  const pdfKeys = new Set(pdfList.map((c) => candidateKey(c.url)));
  const readList = reads.list().filter((c) => !pdfKeys.has(candidateKey(c.url)) && !(doi && /doi\.org\//i.test(c.url) && c.host !== 'publisher'));
  const corresponding = work?.authorships?.find((a) => a.is_corresponding && emailIn(a.raw_affiliation_strings ?? []));
  const anyWithEmail = corresponding ?? work?.authorships?.find((a) => emailIn(a.raw_affiliation_strings ?? []));
  const contactEmail = anyWithEmail ? emailIn(anyWithEmail.raw_affiliation_strings ?? []) : epmcEmail.email;
  const contactName = anyWithEmail ? anyWithEmail.author?.display_name : epmcEmail.email ? epmcEmail.name : undefined;
  const authors = (work?.authorships ?? []).map((a) => a.author?.display_name).filter((n): n is string => Boolean(n)).slice(0, 3);

  let result: OaResult;
  if (!work && !pdfList.length && !readList.length) result = { status: 'not_found', doi: q.doi, title: q.title, year: q.year, pdfUrls: [], sources };
  else
    result = {
      status: pdfList.length || readList.length ? 'oa' : 'closed',
      title,
      doi: doi || undefined,
      year: work?.publication_year ?? q.year ?? undefined,
      openalexId: work?.id ? work.id.replace('https://openalex.org/', '') || undefined : undefined,
      landingUrl: doi ? `https://doi.org/${doi}` : httpUrlOrUndefined(work?.primary_location?.landing_page_url),
      pdfUrls: pdfList.slice(0, 8),
      readUrls: readList.slice(0, 4),
      authors: authors.length ? authors : undefined,
      contactEmail,
      contactName: contactEmail ? contactName : undefined,
      sources,
    };
  // don't cache answers spoiled by a catalogue being down or throttled, unless something was found anyway
  const degraded = sources.some((s) => s.status === 'error' || s.status === 'timeout' || s.status === 'rate_limited');
  if (!degraded || result.pdfUrls.length) {
    const ttl = degraded ? TTL_ERROR : result.status === 'not_found' || result.status === 'closed' ? TTL_MISS : TTL_FOUND;
    await cache.put(key, result, ttl);
  }
  return result;
}

/** Catalogue data is untrusted: only http(s) links reach the UI (never javascript:, data:, ...). */
export function httpUrlOrUndefined(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Public http(s) URL only (no IP literals of private ranges, no credentials, no odd ports). */
export function isFetchableUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== '443' && u.port !== '80') return false;
  const h = u.hostname;
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.')) return false;
  if (/^\[|^\d+\.\d+\.\d+\.\d+$/.test(h)) return isPublicIpv4(h) ? true : false;
  return true;
}

function isPublicIpv4(host: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10 || a === 127 || a === 0) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a >= 224) return false;
  return true;
}

/** Last two host labels ("idp.nature.com" -> "nature.com"): cookies only travel within that site. */
function siteOf(url: string): string {
  return new URL(url).hostname.split('.').slice(-2).join('.');
}

const CITATION_PDF_RE = /<meta[^>]+name=["']citation_pdf_url["'][^>]+content=["']([^"']+)["']/i;
const CITATION_PDF_RE2 = /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']citation_pdf_url["']/i;

/** One HTML landing fetch: parse `citation_pdf_url` or a direct .pdf link (SciELO, DOAJ, publishers). */
export async function pdfUrlFromLanding(landing: string, f: Fetch = fetch): Promise<string | undefined> {
  if (!isFetchableUrl(landing)) return undefined;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PDF_FETCH_TIMEOUT_MS);
  try {
    const r = await f(landing, {
      redirect: 'follow',
      signal: ac.signal,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.5' },
    });
    if (!r.ok) return undefined;
    const type = (r.headers.get('content-type') ?? '').toLowerCase();
    if (/pdf|octet-stream/.test(type)) {
      const direct = r.url !== landing ? r.url : landing;
      return isFetchableUrl(direct) ? direct : landing;
    }
    if (!/html|xml/.test(type)) return undefined;
    const html = await r.text();
    const meta = CITATION_PDF_RE.exec(html)?.[1] ?? CITATION_PDF_RE2.exec(html)?.[1];
    if (meta) {
      try {
        const abs = new URL(meta, landing).toString();
        if (isFetchableUrl(abs)) return abs;
      } catch {
        /* ignore */
      }
    }
    const m = /href=["']([^"']+\.pdf[^"']*)["']/i.exec(html);
    if (m) {
      try {
        const abs = new URL(m[1], landing).toString();
        if (isFetchableUrl(abs)) return abs;
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* network / timeout */
  } finally {
    clearTimeout(timer);
  }
  return undefined;
}

/**
 * First candidate that really serves a PDF: follows redirects by hand (each hop re-checked against
 * isFetchableUrl), keeps the session cookies a publisher sets while bouncing through its own cookie check
 * (same site only, never the user's), and validates the "%PDF-" magic before accepting the body.
 */
export async function openPdfResponse<C extends { url: string; source: string }>(candidates: C[], f: Fetch = fetch): Promise<{ stream: ReadableStream<Uint8Array>; source: string; url: string; candidate: C } | undefined> {
  const tryList = [...candidates.slice(0, 8)];
  for (const c of tryList) {
    let url = c.url;
    const jar = new Map<string, Map<string, string>>();
    let sawHtml = false;
    for (let hop = 0; hop < MAX_PDF_REDIRECTS && isFetchableUrl(url); hop++) {
      let r: Response;
      const site = siteOf(url);
      const cookies = [...(jar.get(site) ?? new Map<string, string>())].map(([k, v]) => `${k}=${v}`).join('; ');
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), PDF_FETCH_TIMEOUT_MS);
      try {
        r = await f(url, { redirect: 'manual', signal: ac.signal, headers: { 'User-Agent': UA, Accept: 'application/pdf,*/*;q=0.5', ...(cookies ? { Cookie: cookies } : {}) } });
      } catch {
        clearTimeout(timer);
        break;
      } finally {
        clearTimeout(timer);
      }
      const setCookies = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
      for (const sc of setCookies) {
        const m = /^\s*([^=;\s]+)=([^;]*)/.exec(sc);
        if (!m) continue;
        const bucket = jar.get(site) ?? new Map<string, string>();
        bucket.set(m[1], m[2]);
        jar.set(site, bucket);
      }
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
        void r.body?.cancel();
        url = new URL(r.headers.get('location') as string, url).toString();
        continue;
      }
      if (!r.ok || !r.body) break;
      const len = Number(r.headers.get('content-length') ?? 0);
      const type = (r.headers.get('content-type') ?? '').toLowerCase();
      const typedHtml = /html|json|xml/.test(type) && !/pdf|octet-stream/.test(type);
      if (typedHtml) {
        void r.body?.cancel();
        sawHtml = true;
        break;
      }
      if (len > MAX_PDF_BYTES) {
        void r.body?.cancel();
        break;
      }
      const stream = await checkedPdfStream(r.body!);
      if (stream) return { stream, source: c.source, url, candidate: c };
      break;
    }
    if (sawHtml && isFetchableUrl(url)) {
      const fromMeta = await pdfUrlFromLanding(url, f);
      if (fromMeta && fromMeta !== url) {
        const extra = { ...c, url: fromMeta } as C;
        const nested = await openPdfResponse([extra], f);
        if (nested) return nested;
      }
    }
  }
  return undefined;
}

/**
 * Stream of the PDF body: checks the first bytes are "%PDF-" and cuts it at MAX_PDF_BYTES. Rejects (errors the
 * stream) otherwise. Streaming keeps the edge function cheap: bytes are passed through, not buffered.
 */
export async function checkedPdfStream(body: ReadableStream<Uint8Array>): Promise<ReadableStream<Uint8Array> | undefined> {
  const reader = body.getReader();
  let head = new Uint8Array(0);
  while (head.length < 5) {
    const { value, done } = await reader.read();
    if (done) break;
    const next = new Uint8Array(head.length + value.length);
    next.set(head);
    next.set(value, head.length);
    head = next;
  }
  if (String.fromCharCode(...head.subarray(0, 5)) !== '%PDF-') {
    void reader.cancel();
    return undefined;
  }
  let total = head.length;
  return new ReadableStream<Uint8Array>({
    start(ctrl) {
      ctrl.enqueue(head);
    },
    async pull(ctrl) {
      const { value, done } = await reader.read();
      if (done) return ctrl.close();
      total += value.length;
      if (total > MAX_PDF_BYTES) {
        void reader.cancel();
        return ctrl.error(new Error('PDF grande demais'));
      }
      ctrl.enqueue(value);
    },
    cancel() {
      void reader.cancel();
    },
  });
}

/** arXiv e-print whose title matches (>= 0.85 token overlap), via the arXiv API (last resort of the PDF proxy). */
export async function arxivByTitle(title: string, f: Fetch = fetch, author?: string): Promise<string | undefined> {
  const set = new CandidateSet();
  try {
    await fromArxiv({ f, env: {}, timeoutMs: DEFAULT_TIMEOUT_MS, now: Date.now }, title, set, author);
  } catch {
    /* unavailable or throttled */
  }
  return set.list()[0]?.url;
}

/** Pages `_headers` rules do not apply to Functions responses: the API sets its own (no sniffing, never rendered as a page). */
export const API_SAFETY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
} as const;
/** JSON is data only. (Not on the PDF: Chrome refuses to show a PDF under a sandbox CSP.) */
export const JSON_CSP = { 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; sandbox" } as const;

/** Full request handling, shared by the Pages Function and the local server. */
export async function handleOaRequest(url: URL, f: Fetch = fetch, opts: OaOptions = {}): Promise<Response> {
  const q = parseOaQuery(url.searchParams);
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...API_SAFETY_HEADERS, ...JSON_CSP } });
  if (!q) return json({ error: 'Informe um DOI ou um título.' }, 400);
  const result = await lookupOpenAccess(q, f, opts);
  if (url.pathname.endsWith('/pdf')) {
    let opened = result.pdfUrls.length ? await openPdfResponse(result.pdfUrls, f) : undefined;
    if (!opened && result.landingUrl && isFetchableUrl(result.landingUrl)) {
      const fromLanding = await pdfUrlFromLanding(result.landingUrl, f);
      if (fromLanding) {
        const c: OaCandidate = { url: fromLanding, source: hostLabel(fromLanding), host: hostFromUrl(fromLanding), version: 'unknown', via: [] };
        result.pdfUrls.push(c);
        opened = await openPdfResponse([c], f);
      }
    }
    if (!opened && result.readUrls?.length) {
      opened = await openPdfResponse(result.readUrls, f);
    }
    // last resort: the arXiv version found by title (publisher PDFs often sit behind cookies/logins)
    const title = result.title ?? q.title;
    if (!opened && title && !result.pdfUrls.some((c) => c.source === 'arXiv')) {
      const ax = await arxivByTitle(title, f, q.author ?? result.authors?.[0]);
      if (ax) {
        const c: OaCandidate = { url: ax, source: 'arXiv', host: 'preprint', version: 'preprint', via: ['arXiv'] };
        result.pdfUrls.push(c);
        opened = await openPdfResponse([c], f);
      }
    }
    if (!opened) return json({ error: 'Nenhum PDF gratuito pôde ser baixado.', result }, 404);
    return new Response(opened.stream, {
      headers: {
        'Content-Type': 'application/pdf',
        'Cache-Control': 'no-store',
        ...API_SAFETY_HEADERS,
        'X-Fontexto-Source': encodeURIComponent(opened.source),
        'X-Fontexto-Url': encodeURIComponent(opened.url),
        'X-Fontexto-Host': opened.candidate.host,
        'X-Fontexto-Version': opened.candidate.version,
      },
    });
  }
  return json(result);
}
