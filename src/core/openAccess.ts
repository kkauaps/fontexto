/**
 * Open-access lookup for "só o documento": given what the reference list says about a work (DOI, or title + year +
 * first author), find the work in OpenAlex, Crossref and list the free full-text PDFs that OpenAlex, Unpaywall,
 * Semantic Scholar, arXiv and Europe PMC know about.
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

export interface OaResult {
  status: OaStatus;
  title?: string;
  doi?: string;
  year?: number;
  openalexId?: string;
  /** Page where the work can be read/bought (DOI link, publisher). */
  landingUrl?: string;
  /** Free PDF candidates, best first. */
  pdfUrls: { url: string; source: string }[];
}

type Fetch = typeof fetch;
/** Polite contact required by OpenAlex, Unpaywall and Crossref. */
export const OA_CONTACT = 'oa@fontexto.com';
const UA = `Fontexto/1.0 (+https://fontexto.com; mailto:${OA_CONTACT})`;
const withMail = (url: string) => `${url}${url.includes('?') ? '&' : '?'}mailto=${encodeURIComponent(OA_CONTACT)}`;
export const MAX_PDF_BYTES = 40 * 1024 * 1024;
const DOI_RE = /^10\.\d{4,9}\/\S{1,200}$/;

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

interface OpenAlexWork {
  id: string;
  doi?: string | null;
  title?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  ids?: { pmcid?: string; doi?: string };
  open_access?: { is_oa?: boolean; oa_url?: string | null };
  best_oa_location?: { pdf_url?: string | null; landing_page_url?: string | null } | null;
  primary_location?: { landing_page_url?: string | null } | null;
  locations?: { pdf_url?: string | null; landing_page_url?: string | null; is_oa?: boolean }[];
  authorships?: { author?: { display_name?: string } }[];
}

async function getJson<T>(f: Fetch, url: string): Promise<T | undefined> {
  try {
    const r = await f(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!r.ok) return undefined;
    return (await r.json()) as T;
  } catch {
    return undefined;
  }
}

function crossrefToWork(m: {
  DOI?: string;
  title?: string[];
  URL?: string;
  issued?: { 'date-parts'?: number[][] };
  author?: { given?: string; family?: string }[];
  link?: { URL?: string; 'content-type'?: string }[];
}): OpenAlexWork {
  const title = m.title?.[0];
  const year = m.issued?.['date-parts']?.[0]?.[0];
  const doi = m.DOI?.toLowerCase();
  const pdfs = (m.link ?? [])
    .filter((l) => /pdf/i.test(`${l['content-type'] ?? ''} ${l.URL ?? ''}`))
    .map((l) => ({ pdf_url: l.URL ?? null, landing_page_url: m.URL ?? null, is_oa: true }));
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

async function findWorkCrossref(q: OaQuery, f: Fetch): Promise<OpenAlexWork | undefined> {
  if (q.doi) {
    const w = await getJson<{ message?: Parameters<typeof crossrefToWork>[0] }>(f, `https://api.crossref.org/works/${q.doi}`);
    if (w?.message) return crossrefToWork(w.message);
  }
  if (!q.title) return undefined;
  const params = new URLSearchParams({ 'query.bibliographic': q.title, rows: '8' });
  if (q.year) params.set('filter', `from-pub-date:${q.year - 1},until-pub-date:${q.year + 1}`);
  const res = await getJson<{ message?: { items?: Parameters<typeof crossrefToWork>[0][] } }>(f, `https://api.crossref.org/works?${params.toString()}`);
  const author = q.author ? fold(q.author) : '';
  let best: { w: OpenAlexWork; s: number } | undefined;
  for (const item of res?.message?.items ?? []) {
    const w = crossrefToWork(item);
    let s = titleSimilarity(q.title, w.title ?? '');
    if (author && (w.authorships ?? []).some((a) => fold(a.author?.display_name ?? '').split(' ').includes(author.split(' ').pop() ?? ''))) s += 0.1;
    if (q.year && w.publication_year === q.year) s += 0.05;
    if (!best || s > best.s) best = { w, s };
  }
  return best && best.s >= 0.8 ? best.w : undefined;
}

async function findWork(q: OaQuery, f: Fetch): Promise<OpenAlexWork | undefined> {
  if (q.doi) {
    const w = await getJson<OpenAlexWork>(f, withMail(`https://api.openalex.org/works/doi:${encodeURIComponent(q.doi)}`));
    if (w) return w;
  }
  if (q.title) {
    const filter = q.year ? `&filter=publication_year:${q.year - 1}-${q.year + 1}` : '';
    const res = await getJson<{ results: OpenAlexWork[] }>(f, withMail(`https://api.openalex.org/works?search=${encodeURIComponent(q.title)}${filter}&per-page=8`));
    const author = q.author ? fold(q.author) : '';
    let best: { w: OpenAlexWork; s: number } | undefined;
    for (const w of res?.results ?? []) {
      let s = titleSimilarity(q.title, w.title ?? w.display_name ?? '');
      if (author && (w.authorships ?? []).some((a) => fold(a.author?.display_name ?? '').split(' ').includes(author.split(' ').pop() ?? ''))) s += 0.1;
      if (q.year && w.publication_year === q.year) s += 0.05;
      if (!best || s > best.s) best = { w, s };
    }
    if (best && best.s >= 0.8) return best.w;
  } else if (!q.doi) {
    return undefined;
  }
  return findWorkCrossref(q, f);
}

const arxivPdf = (u: string | null | undefined) => {
  const m = u ? /arxiv\.org\/(?:abs|pdf)\/([^?#\s]+?)(?:\.pdf)?(?:v\d+)?$/i.exec(u) : null;
  return m ? `https://arxiv.org/pdf/${m[1]}` : undefined;
};

/** Looks the work up and gathers its free PDF candidates. */
export async function lookupOpenAccess(q: OaQuery, f: Fetch = fetch): Promise<OaResult> {
  const w = await findWork(q, f);
  const doi = (w?.doi ?? '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase() || q.doi;
  const urls: { url: string; source: string }[] = [];
  const add = (url: string | null | undefined, source: string) => {
    if (!url || !/^https?:\/\//i.test(url)) return;
    const u = url.replace(/^http:\/\//i, 'https://');
    if (!urls.some((x) => x.url === u)) urls.push({ url: u, source });
  };
  if (w) {
    for (const l of [w.best_oa_location, ...(w.locations ?? [])]) {
      if (!l) continue;
      add(arxivPdf(l.landing_page_url) ?? arxivPdf(l.pdf_url), 'arXiv');
      const pmcInUrl = /ncbi\.nlm\.nih\.gov\/(?:pmc\/)?articles\/(PMC\d+)/i.exec(l.pdf_url ?? l.landing_page_url ?? '');
      if (pmcInUrl) add(`https://europepmc.org/articles/${pmcInUrl[1]}?pdf=render`, 'Europe PMC');
      if (l.pdf_url) add(l.pdf_url, hostLabel(l.pdf_url));
    }
    const pmc = w.ids?.pmcid?.replace(/^.*\/(PMC\d+).*$/i, '$1');
    if (pmc && /^PMC\d+$/i.test(pmc)) add(`https://europepmc.org/articles/${pmc}?pdf=render`, 'Europe PMC');
  }
  if (doi) {
    const s2 = await getJson<{ openAccessPdf?: { url?: string } | null; externalIds?: { ArXiv?: string; PubMedCentral?: string } }>(
      f,
      `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=openAccessPdf,externalIds`,
    );
    if (s2?.externalIds?.ArXiv) add(`https://arxiv.org/pdf/${s2.externalIds.ArXiv}`, 'arXiv');
    if (s2?.openAccessPdf?.url) add(s2.openAccessPdf.url, 'Semantic Scholar');
    if (s2?.externalIds?.PubMedCentral) add(`https://europepmc.org/articles/PMC${s2.externalIds.PubMedCentral}?pdf=render`, 'Europe PMC');
  }
  if (doi) {
    const upw = await getJson<{
      best_oa_location?: { url_for_pdf?: string | null; url?: string | null };
      oa_locations?: { url_for_pdf?: string | null; url?: string | null }[];
    }>(f, `https://api.unpaywall.org/v2/${doi}?email=${encodeURIComponent(OA_CONTACT)}`);
    for (const l of [upw?.best_oa_location, ...(upw?.oa_locations ?? [])]) {
      if (!l) continue;
      add(l.url_for_pdf, 'Unpaywall');
      add(arxivPdf(l.url), 'arXiv');
    }
  }
  // arXiv first (always a real PDF), then the rest in catalogue order
  urls.sort((a, b) => Number(b.source === 'arXiv') - Number(a.source === 'arXiv'));
  if (!w && !urls.length) return { status: 'not_found', pdfUrls: [] };
  return {
    status: urls.length ? 'oa' : 'closed',
    title: w?.title ?? w?.display_name ?? undefined,
    doi: doi || undefined,
    year: w?.publication_year ?? undefined,
    openalexId: w?.id?.replace('https://openalex.org/', ''),
    landingUrl: doi ? `https://doi.org/${doi}` : (w?.primary_location?.landing_page_url ?? undefined),
    pdfUrls: urls.slice(0, 8),
  };
}

function hostLabel(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    if (/ncbi\.nlm\.nih\.gov|europepmc/.test(h)) return 'PubMed Central';
    if (/arxiv/.test(h)) return 'arXiv';
    if (/biorxiv|medrxiv/.test(h)) return 'bioRxiv/medRxiv';
    if (/scielo/.test(h)) return 'SciELO';
    return h;
  } catch {
    return 'repositório';
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
export async function openPdfResponse(candidates: { url: string; source: string }[], f: Fetch = fetch): Promise<{ stream: ReadableStream<Uint8Array>; source: string; url: string } | undefined> {
  for (const c of candidates.slice(0, 6)) {
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
      if (stream) return { stream, source: c.source, url };
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

/** arXiv e-print whose title matches (>= 0.85 token overlap), via the arXiv API. */
export async function arxivByTitle(title: string, f: Fetch = fetch): Promise<string | undefined> {
  const words = fold(title).split(' ').filter((w) => w.length > 3).slice(0, 10);
  if (words.length < 2) return undefined;
  try {
    const r = await f(`https://export.arxiv.org/api/query?search_query=${encodeURIComponent(words.map((w) => `ti:${w}`).join(' AND '))}&max_results=5`, { headers: { 'User-Agent': UA } });
    if (!r.ok) return undefined;
    const xml = await r.text();
    for (const e of xml.split('<entry>').slice(1)) {
      const id = /<id>\s*https?:\/\/arxiv\.org\/abs\/([^<\s]+?)(?:v\d+)?\s*<\/id>/.exec(e)?.[1];
      const t = /<title>([\s\S]*?)<\/title>/.exec(e)?.[1] ?? '';
      if (id && titleSimilarity(title, t) >= 0.85) return `https://arxiv.org/pdf/${id}`;
    }
  } catch {
    /* unavailable */
  }
  return undefined;
}

/** Full request handling, shared by the Pages Function and the local server. */
export async function handleOaRequest(url: URL, f: Fetch = fetch): Promise<Response> {
  const q = parseOaQuery(url.searchParams);
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (!q) return json({ error: 'Informe um DOI ou um título.' }, 400);
  const result = await lookupOpenAccess(q, f);
  if (url.pathname.endsWith('/pdf')) {
    let opened = result.pdfUrls.length ? await openPdfResponse(result.pdfUrls, f) : undefined;
    // last resort: the arXiv version found by title (publisher PDFs often sit behind cookies/logins)
    const title = result.title ?? q.title;
    if (!opened && title && !result.pdfUrls.some((c) => c.source === 'arXiv')) {
      const ax = await arxivByTitle(title, f);
      if (ax) {
        result.pdfUrls.push({ url: ax, source: 'arXiv' });
        opened = await openPdfResponse([{ url: ax, source: 'arXiv' }], f);
      }
    }
    if (!opened) return json({ error: 'Nenhum PDF gratuito pôde ser baixado.', result }, 404);
    return new Response(opened.stream, {
      headers: {
        'Content-Type': 'application/pdf',
        'Cache-Control': 'no-store',
        'X-Fontexto-Source': encodeURIComponent(opened.source),
        'X-Fontexto-Url': encodeURIComponent(opened.url),
      },
    });
  }
  return json(result);
}
