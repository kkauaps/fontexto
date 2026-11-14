/**
 * Open-access lookup for "só o documento": given what the reference list says about a work (DOI, or title + year +
 * first author), find the work in OpenAlex (or Crossref) and list the free, legal copies that open catalogues know
 * about: OpenAlex, Unpaywall, Semantic Scholar, Europe PMC, CORE (only with an API key) and arXiv.
 *
 * Only legal open-access sources are queried: publisher OA, institutional/subject repositories and preprint
 * servers. Shadow libraries are deliberately not supported.
 *
 * Runs on the server side (Cloudflare Pages Function, or the local server of the desktop edition) because those
 * PDF hosts do not allow cross-origin downloads. Only the reference's DOI/title/year/author leave the browser,
 * never the document. Candidate URLs come from those catalogues, never from the request, so this is not an open
 * proxy. Nothing is logged.
 */

export interface OaQuery {
  doi?: string;
  title?: string;
  year?: number;
  author?: string;
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
  sources?: { name: OaSourceName; status: OaSourceStatus }[];
  cached?: boolean;
}

/** Optional settings (environment variables on the Pages project / local server). */
export interface OaEnv {
  /** CORE API v3 key (https://core.ac.uk/services/api). Without it CORE is skipped. */
  CORE_API_KEY?: string;
  /** Semantic Scholar API key (optional, higher rate limit). */
  S2_API_KEY?: string;
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
export const OA_CONTACT = 'oa@fontexto.com';
const UA = `Fontexto/1.0 (+https://fontexto.com; mailto:${OA_CONTACT})`;
const withMail = (url: string) => `${url}${url.includes('?') ? '&' : '?'}mailto=${encodeURIComponent(OA_CONTACT)}`;
export const MAX_PDF_BYTES = 40 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 6000;
const DOI_RE = /^10\.\d{4,9}\/\S{1,200}$/;
const TTL_FOUND = 7 * 24 * 3600;
const TTL_MISS = 12 * 3600;

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const tokens = (s: string) => new Set(fold(s).split(' ').filter((w) => w.length > 2));
export function titleSimilarity(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const t of x) if (y.has(t)) inter++;
  return inter / Math.max(x.size, y.size);
}

/** Validates and normalises a query coming from the network. */
export function parseOaQuery(params: URLSearchParams): OaQuery | undefined {
  const doi = params.get('doi')?.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').toLowerCase();
  const title = params.get('title')?.replace(/\s+/g, ' ').trim().slice(0, 300);
  const year = Number(params.get('year')) || undefined;
  const author = params.get('author')?.trim().slice(0, 80);
  if (doi && DOI_RE.test(doi)) return { doi, title, year, author };
  if (title && title.length >= 8) return { title, year: year && year > 1500 && year < 2100 ? year : undefined, author };
  return undefined;
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Rate limits, timeouts, cache                                                                                   */
/* ------------------------------------------------------------------------------------------------------------ */

/** Per-catalogue cool-down after a 429 (honours Retry-After, capped), shared by requests of this isolate/process. */
const cooldownUntil = new Map<OaSourceName, number>();
/** Minimum spacing between calls to catalogues that ask for it (arXiv: one request every 3 s). */
const MIN_GAP: Partial<Record<OaSourceName, number>> = { arXiv: 3000, 'Semantic Scholar': 1000 };
const lastCall = new Map<OaSourceName, number>();
/** Catalogues that are often slower than the rest get a longer timeout (multiplier). */
const SLOW: Partial<Record<OaSourceName, number>> = { 'Europe PMC': 1.5 };

/** For tests: forget cool-downs, spacing and the default in-memory cache. */
export function resetOaState() {
  cooldownUntil.clear();
  lastCall.clear();
  defaultCache = memoryCache();
}

class RateLimited extends Error {}
class TimedOut extends Error {}

interface Ctx {
  f: Fetch;
  env: OaEnv;
  timeoutMs: number;
  now: () => number;
}

async function call(ctx: Ctx, name: OaSourceName, url: string, headers: Record<string, string> = {}): Promise<Response | undefined> {
  const now = ctx.now();
  if ((cooldownUntil.get(name) ?? 0) > now) throw new RateLimited();
  const gap = MIN_GAP[name];
  if (gap) {
    const wait = (lastCall.get(name) ?? 0) + gap - now;
    // never queue for long inside a request: past 1.5 s we skip this catalogue for now
    if (wait > 1500) throw new RateLimited();
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
      cooldownUntil.set(name, ctx.now() + Math.min(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 60_000, 10 * 60_000));
      void r.body?.cancel();
      throw new RateLimited();
    }
    if (!r.ok) {
      void r.body?.cancel();
      return undefined;
    }
    return r;
  } catch (e) {
    if (e instanceof RateLimited) throw e;
    if (timedOut) throw new TimedOut();
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function callJson<T>(ctx: Ctx, name: OaSourceName, url: string, headers?: Record<string, string>): Promise<T | undefined> {
  const r = await call(ctx, name, url, headers);
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
export const oaCacheKey = (q: OaQuery) => (q.doi ? `v2|doi|${q.doi}` : `v2|t|${fold(q.title ?? '')}|${q.year ?? ''}|${fold(q.author ?? '')}`);

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
  URL?: string;
  issued?: { 'date-parts'?: number[][] };
  author?: { given?: string; family?: string }[];
  link?: { URL?: string; 'content-type'?: string }[];
  license?: { URL?: string }[];
}): OpenAlexWork {
  const title = m.title?.[0];
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
    publication_year: year ?? null,
    authorships: (m.author ?? []).map((a) => ({ author: { display_name: [a.given, a.family].filter(Boolean).join(' ') } })),
    primary_location: { landing_page_url: m.URL ?? null },
    best_oa_location: pdfs[0] ?? null,
    locations: pdfs,
  };
}

function bestMatch<T>(items: T[], q: OaQuery, titleOf: (w: T) => string, authorsOf: (w: T) => string[], yearOf: (w: T) => number | null | undefined, min = 0.8): T | undefined {
  if (!q.title) return undefined;
  const author = q.author ? (fold(q.author).split(' ').pop() ?? '') : '';
  let best: { w: T; s: number } | undefined;
  for (const w of items) {
    let s = titleSimilarity(q.title, titleOf(w));
    if (author && authorsOf(w).some((a) => fold(a).split(' ').includes(author))) s += 0.1;
    if (q.year && yearOf(w) === q.year) s += 0.05;
    if (!best || s > best.s) best = { w, s };
  }
  return best && best.s >= min ? best.w : undefined;
}

async function findWorkCrossref(ctx: Ctx, q: OaQuery): Promise<OpenAlexWork | undefined> {
  if (q.doi) {
    const w = await callJson<{ message?: Parameters<typeof crossrefToWork>[0] }>(ctx, 'Crossref', withMail(`https://api.crossref.org/works/${q.doi}`));
    if (w?.message) return crossrefToWork(w.message);
  }
  if (!q.title) return undefined;
  const params = new URLSearchParams({ 'query.bibliographic': q.title, rows: '8' });
  if (q.year) params.set('filter', `from-pub-date:${q.year - 1},until-pub-date:${q.year + 1}`);
  const res = await callJson<{ message?: { items?: Parameters<typeof crossrefToWork>[0][] } }>(ctx, 'Crossref', withMail(`https://api.crossref.org/works?${params.toString()}`));
  const works = (res?.message?.items ?? []).map(crossrefToWork);
  return bestMatch(works, q, (w) => w.title ?? '', (w) => (w.authorships ?? []).map((a) => a.author?.display_name ?? ''), (w) => w.publication_year);
}

async function findWorkOpenAlex(ctx: Ctx, q: OaQuery): Promise<OpenAlexWork | undefined> {
  if (q.doi) {
    const w = await callJson<OpenAlexWork>(ctx, 'OpenAlex', withMail(`https://api.openalex.org/works/doi:${encodeURIComponent(q.doi)}`));
    if (w) return w;
  }
  if (!q.title) return undefined;
  const filter = q.year ? `&filter=publication_year:${q.year - 1}-${q.year + 1}` : '';
  const res = await callJson<{ results: OpenAlexWork[] }>(ctx, 'OpenAlex', withMail(`https://api.openalex.org/works?search=${encodeURIComponent(q.title)}${filter}&per-page=8`));
  return bestMatch(res?.results ?? [], q, (w) => w.title ?? w.display_name ?? '', (w) => (w.authorships ?? []).map((a) => a.author?.display_name ?? ''), (w) => w.publication_year);
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

async function fromSemanticScholar(ctx: Ctx, doi: string | undefined, title: string | undefined, pdfs: CandidateSet): Promise<boolean> {
  const headers = ctx.env.S2_API_KEY ? { 'x-api-key': ctx.env.S2_API_KEY } : undefined;
  type S2 = { title?: string; openAccessPdf?: { url?: string; status?: string; license?: string | null } | null; externalIds?: { ArXiv?: string; PubMedCentral?: string } };
  let s2: S2 | undefined;
  if (doi) s2 = await callJson<S2>(ctx, 'Semantic Scholar', `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=openAccessPdf,externalIds`, headers);
  else if (title) {
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

/** Runs one catalogue and records how it went. */
async function step(statuses: Map<OaSourceName, OaSourceStatus>, name: OaSourceName, run: () => Promise<boolean | OaSourceStatus>) {
  try {
    const out = await run();
    statuses.set(name, typeof out === 'string' ? out : out ? 'found' : (statuses.get(name) === 'found' ? 'found' : 'none'));
  } catch (e) {
    statuses.set(name, e instanceof RateLimited ? 'rate_limited' : e instanceof TimedOut ? 'timeout' : 'error');
  }
}

/** Looks the work up and gathers its free legal copies (cached). */
export async function lookupOpenAccess(q: OaQuery, f: Fetch = fetch, opts: OaOptions = {}): Promise<OaResult> {
  const cache = opts.cache ?? defaultCache;
  const key = oaCacheKey(q);
  const hit = await cache.get(key);
  if (hit) return { ...hit, cached: true };
  const ctx: Ctx = { f, env: opts.env ?? {}, timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, now: opts.now ?? Date.now };
  const statuses = new Map<OaSourceName, OaSourceStatus>();
  const pdfs = new CandidateSet();
  const reads = new CandidateSet();

  // 1) identify the work: OpenAlex, then Crossref
  let w: OpenAlexWork | undefined;
  let via: OaSourceName = 'OpenAlex';
  await step(statuses, 'OpenAlex', async () => Boolean((w = await findWorkOpenAlex(ctx, q))));
  if (!w && (q.doi || q.title)) {
    via = 'Crossref';
    await step(statuses, 'Crossref', async () => Boolean((w = await findWorkCrossref(ctx, q))));
  }
  const work = w as OpenAlexWork | undefined;
  if (work) {
    openAlexCandidates(work, pdfs, via);
    openAlexReadLinks(work, reads, via);
  }
  const doi = (work?.doi ?? '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase() || q.doi;
  const title = work?.title ?? work?.display_name ?? q.title ?? undefined;

  // 2) the catalogues of free copies, in parallel (each with its own timeout)
  let epmcEmail: { email?: string; name?: string } = {};
  await Promise.all([
    doi ? step(statuses, 'Unpaywall', () => fromUnpaywall(ctx, doi, pdfs, reads)) : (statuses.set('Unpaywall', 'skipped'), undefined),
    step(statuses, 'Semantic Scholar', () => fromSemanticScholar(ctx, doi, doi ? undefined : title, pdfs)),
    step(statuses, 'Europe PMC', async () => {
      const r = await fromEuropePmc(ctx, doi, { ...q, title }, pdfs, reads);
      epmcEmail = r;
      return r.found;
    }),
    doi ? step(statuses, 'CORE', () => fromCore(ctx, doi, pdfs)) : (statuses.set('CORE', 'skipped'), undefined),
  ]);
  // 3) arXiv by title, last (strict rate limit), only when nothing else gave a PDF
  const firstAuthor = q.author ?? work?.authorships?.[0]?.author?.display_name;
  if (!pdfs.size && title) await step(statuses, 'arXiv', () => fromArxiv(ctx, title, pdfs, firstAuthor));
  else statuses.set('arXiv', pdfs.list().some((c) => c.host === 'preprint' && /arxiv/.test(c.url)) ? 'found' : 'skipped');

  const sources = [...statuses].map(([name, status]) => ({ name, status }));
  const pdfList = pdfs.list();
  const pdfKeys = new Set(pdfList.map((c) => candidateKey(c.url)));
  const readList = reads.list().filter((c) => !pdfKeys.has(candidateKey(c.url)) && !(doi && /doi\.org\//i.test(c.url) && c.host !== 'publisher'));
  const corresponding = work?.authorships?.find((a) => a.is_corresponding && emailIn(a.raw_affiliation_strings ?? []));
  const anyWithEmail = corresponding ?? work?.authorships?.find((a) => emailIn(a.raw_affiliation_strings ?? []));
  const contactEmail = anyWithEmail ? emailIn(anyWithEmail.raw_affiliation_strings ?? []) : epmcEmail.email;
  const contactName = anyWithEmail ? anyWithEmail.author?.display_name : epmcEmail.email ? epmcEmail.name : undefined;
  const authors = (work?.authorships ?? []).map((a) => a.author?.display_name).filter((n): n is string => Boolean(n)).slice(0, 3);

  let result: OaResult;
  if (!work && !pdfList.length && !readList.length) result = { status: 'not_found', pdfUrls: [], sources };
  else
    result = {
      status: pdfList.length || readList.length ? 'oa' : 'closed',
      title,
      doi: doi || undefined,
      year: work?.publication_year ?? q.year ?? undefined,
      openalexId: work?.id ? work.id.replace('https://openalex.org/', '') || undefined : undefined,
      landingUrl: doi ? `https://doi.org/${doi}` : (work?.primary_location?.landing_page_url ?? undefined),
      pdfUrls: pdfList.slice(0, 8),
      readUrls: readList.slice(0, 4),
      authors: authors.length ? authors : undefined,
      contactEmail,
      contactName: contactEmail ? contactName : undefined,
      sources,
    };
  // don't cache answers spoiled by a catalogue being down or throttled, unless something was found anyway
  const degraded = sources.some((s) => s.status === 'error' || s.status === 'timeout' || s.status === 'rate_limited');
  if (!degraded || result.pdfUrls.length) await cache.put(key, result, result.status === 'not_found' || result.status === 'closed' ? TTL_MISS : TTL_FOUND);
  return result;
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
  if (/^\[|^\d+\.\d+\.\d+\.\d+$/.test(h)) return false;
  return true;
}

/** Last two host labels ("idp.nature.com" -> "nature.com"): cookies only travel within that site. */
function siteOf(url: string): string {
  return new URL(url).hostname.split('.').slice(-2).join('.');
}

/**
 * First candidate that really serves a PDF: follows redirects by hand (each hop re-checked against
 * isFetchableUrl), keeps the session cookies a publisher sets while bouncing through its own cookie check
 * (same site only, never the user's), and validates the "%PDF-" magic before accepting the body.
 */
export async function openPdfResponse<C extends { url: string; source: string }>(candidates: C[], f: Fetch = fetch): Promise<{ stream: ReadableStream<Uint8Array>; source: string; url: string; candidate: C } | undefined> {
  for (const c of candidates.slice(0, 8)) {
    let url = c.url;
    const jar = new Map<string, Map<string, string>>();
    for (let hop = 0; hop < 8 && isFetchableUrl(url); hop++) {
      let r: Response;
      const site = siteOf(url);
      const cookies = [...(jar.get(site) ?? new Map<string, string>())].map(([k, v]) => `${k}=${v}`).join('; ');
      try {
        r = await f(url, { redirect: 'manual', headers: { 'User-Agent': UA, Accept: 'application/pdf,*/*;q=0.5', ...(cookies ? { Cookie: cookies } : {}) } });
      } catch {
        break;
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
      const type = r.headers.get('content-type') ?? '';
      if (len > MAX_PDF_BYTES || /html|json|xml/i.test(type)) {
        void r.body.cancel();
        break;
      }
      const stream = await checkedPdfStream(r.body);
      if (stream) return { stream, source: c.source, url, candidate: c };
      break;
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

/** Full request handling, shared by the Pages Function and the local server. */
export async function handleOaRequest(url: URL, f: Fetch = fetch, opts: OaOptions = {}): Promise<Response> {
  const q = parseOaQuery(url.searchParams);
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (!q) return json({ error: 'Informe um DOI ou um título.' }, 400);
  const result = await lookupOpenAccess(q, f, opts);
  if (url.pathname.endsWith('/pdf')) {
    let opened = result.pdfUrls.length ? await openPdfResponse(result.pdfUrls, f) : undefined;
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
        'X-Fontexto-Source': encodeURIComponent(opened.source),
        'X-Fontexto-Url': encodeURIComponent(opened.url),
        'X-Fontexto-Host': opened.candidate.host,
        'X-Fontexto-Version': opened.candidate.version,
      },
    });
  }
  return json(result);
}
