/** "Só o documento": the legal open-access cascade and the PDF proxy, with every network call mocked. Fictional works only. */
import { beforeEach, describe, expect, it } from 'vitest';
import { candidateKey, emailIn, handleOaRequest, isFetchableUrl, lookupOpenAccess, memoryCache, OA_CONTACT, parseOaQuery, rankCandidates, resetOaState, type OaCandidate } from '../src/core/openAccess';

type Route = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;
function mockFetch(...routes: Route[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    for (const r of routes) {
      const res = r(url, init);
      if (res) return res;
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { f, calls };
}
const json = (data: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(data), { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
const pdf = (extra: Record<string, string> = {}) => new Response(new TextEncoder().encode('%PDF-1.7 fake body'), { headers: { 'content-type': 'application/pdf', ...extra } });
const hdr = (init?: RequestInit) => (init?.headers ?? {}) as Record<string, string>;

const DOI = '10.5555/fx.0001';
const TITLE = 'Lumen Index: Synthetic Benchmarks for Moss Growth Modelling';
const WORK = {
  id: 'https://openalex.org/W1',
  doi: `https://doi.org/${DOI}`,
  title: TITLE,
  publication_year: 2021,
  authorships: [
    { author: { display_name: 'Ada Quillfeather' }, is_corresponding: true, raw_affiliation_strings: ['Example Institute of Botany, Nowhere. ada.quill@example.edu.'] },
    { author: { display_name: 'Bram Okonkwo-Lind' }, raw_affiliation_strings: ['Fictional University'] },
  ],
  best_oa_location: { pdf_url: 'https://journal.example.org/lumen.pdf', landing_page_url: 'https://journal.example.org/lumen', is_oa: true, version: 'publishedVersion', license: 'cc-by', source: { display_name: 'Journal of Example Studies', type: 'journal' } },
  locations: [
    { landing_page_url: 'https://arxiv.org/abs/2101.00001v2', pdf_url: null, is_oa: true, version: 'submittedVersion', source: { display_name: 'arXiv', type: 'repository' } },
    { landing_page_url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC999001', pdf_url: null, is_oa: true, version: 'publishedVersion', source: { display_name: 'PubMed Central', type: 'repository' } },
  ],
};
const BARE = { ...WORK, best_oa_location: null, locations: [], authorships: [{ author: { display_name: 'Ada Quillfeather' } }] };
const openalex = (w: unknown): Route => (u) => (u.startsWith('https://api.openalex.org/works/doi:') ? json(w) : undefined);
const s2none: Route = (u) => (u.startsWith('https://api.semanticscholar.org/') ? json({ openAccessPdf: null, externalIds: {} }) : undefined);

beforeEach(() => resetOaState());

describe('query and URL guards', () => {
  it('needs a DOI or a real title', () => {
    expect(parseOaQuery(new URLSearchParams('doi=https://doi.org/10.5555/ABC'))?.doi).toBe('10.5555/abc');
    expect(parseOaQuery(new URLSearchParams('title=abc'))).toBeUndefined();
    expect(parseOaQuery(new URLSearchParams('title=Synthetic moss growth&year=2020'))?.year).toBe(2020);
    expect(parseOaQuery(new URLSearchParams(''))).toBeUndefined();
  });
  it('only fetches public http(s) hosts', () => {
    expect(isFetchableUrl('https://arxiv.org/pdf/2101.00001')).toBe(true);
    for (const bad of ['file:///etc/passwd', 'http://localhost/x.pdf', 'http://127.0.0.1/x', 'http://10.0.0.1/x', 'https://[::1]/x', 'https://user:pw@example.org/x', 'https://example.org:8080/x', 'http://intranet/x'])
      expect(isFetchableUrl(bad), bad).toBe(false);
  });
});

describe('candidates: dedupe and ranking', () => {
  it('the same copy through different URLs has one key', () => {
    expect(candidateKey('https://arxiv.org/abs/2101.00001v3')).toBe(candidateKey('https://arxiv.org/pdf/2101.00001.pdf'));
    expect(candidateKey('https://www.ncbi.nlm.nih.gov/pmc/articles/PMC42/')).toBe(candidateKey('https://europepmc.org/articles/PMC42?pdf=render'));
    expect(candidateKey('https://repo.example.org/a/')).toBe(candidateKey('https://www.repo.example.org/a'));
  });
  it('publisher > repository > preprint, then published > accepted > unknown > preprint', () => {
    const c = (url: string, host: OaCandidate['host'], version: OaCandidate['version']): OaCandidate => ({ url, source: url, host, version, via: ['OpenAlex'] });
    const ranked = rankCandidates([c('p1', 'preprint', 'preprint'), c('r-acc', 'repository', 'accepted'), c('r-pub', 'repository', 'published'), c('pub', 'publisher', 'published'), c('r-unk', 'repository', 'unknown')]);
    expect(ranked.map((x) => x.url)).toEqual(['pub', 'r-pub', 'r-acc', 'r-unk', 'p1']);
  });
  it('reads e-mails printed in affiliation strings only', () => {
    expect(emailIn(['Dept. of Examples, Nowhere. someone@uni.example.'])).toBe('someone@uni.example');
    expect(emailIn(['Fictional University', undefined])).toBeUndefined();
  });
});

describe('lookupOpenAccess cascade', () => {
  it('merges OpenAlex, Unpaywall, Semantic Scholar and Europe PMC, deduped and ranked, with source and version', async () => {
    const { f } = mockFetch(
      openalex(WORK),
      (u) =>
        u.startsWith(`https://api.unpaywall.org/v2/${DOI}`)
          ? json({
              journal_name: 'Journal of Example Studies',
              best_oa_location: { url_for_pdf: 'https://journal.example.org/lumen.pdf', url: 'https://journal.example.org/lumen', host_type: 'publisher', version: 'publishedVersion', license: 'cc-by' },
              oa_locations: [{ url_for_pdf: 'https://repo.example.edu/bitstream/lumen-aam.pdf', url: 'https://repo.example.edu/handle/1', host_type: 'repository', version: 'acceptedVersion', repository_institution: 'Example University Repository' }],
            })
          : undefined,
      (u) => (u.startsWith('https://api.semanticscholar.org/') ? json({ openAccessPdf: { url: 'https://arxiv.org/pdf/2101.00001v2', status: 'GREEN' }, externalIds: { ArXiv: '2101.00001' } }) : undefined),
      (u) =>
        u.startsWith('https://www.ebi.ac.uk/europepmc/')
          ? json({ resultList: { result: [{ doi: DOI, source: 'MED', pmcid: 'PMC999001', isOpenAccess: 'Y', inEPMC: 'Y', hasPDF: 'Y', license: 'cc by' }] } })
          : undefined,
    );
    const r = await lookupOpenAccess({ doi: DOI }, f);
    expect(r.status).toBe('oa');
    expect(r.pdfUrls.map((c) => [c.url, c.host, c.version])).toEqual([
      ['https://journal.example.org/lumen.pdf', 'publisher', 'published'],
      ['https://europepmc.org/articles/PMC999001?pdf=render', 'repository', 'published'],
      ['https://repo.example.edu/bitstream/lumen-aam.pdf', 'repository', 'accepted'],
      ['https://arxiv.org/pdf/2101.00001', 'preprint', 'preprint'],
    ]);
    expect(r.pdfUrls[0].source).toBe('Journal of Example Studies');
    expect(r.pdfUrls[0].via).toEqual(['OpenAlex', 'Unpaywall']);
    expect(r.pdfUrls[1].via).toEqual(expect.arrayContaining(['OpenAlex', 'Europe PMC']));
    expect(r.pdfUrls[2].source).toBe('Example University Repository');
    expect(r.pdfUrls[3].via).toEqual(expect.arrayContaining(['OpenAlex']));
    // Semantic Scholar is only asked when nothing else gave a PDF (its key allows ~1 request/s across all users)
    expect(Object.fromEntries((r.sources ?? []).map((s) => [s.name, s.status]))).toMatchObject({ OpenAlex: 'found', Unpaywall: 'found', 'Semantic Scholar': 'skipped', 'Europe PMC': 'found', CORE: 'skipped' });
    expect(r.contactEmail).toBe('ada.quill@example.edu');
    expect(r.contactName).toBe('Ada Quillfeather');
  });

  it('asks Semantic Scholar when the other catalogues found no PDF', async () => {
    const { f, calls } = mockFetch(
      openalex(BARE),
      (u) => (u.startsWith('https://api.semanticscholar.org/') ? json({ openAccessPdf: { url: 'https://repo.example.org/only-s2.pdf', status: 'GREEN' }, externalIds: {} }) : undefined),
    );
    const r = await lookupOpenAccess({ doi: DOI }, f);
    expect(calls.some((c) => c.url.startsWith('https://api.semanticscholar.org/'))).toBe(true);
    expect(r.pdfUrls.map((c) => c.url)).toContain('https://repo.example.org/only-s2.pdf');
    expect(r.sources?.find((s) => s.name === 'Semantic Scholar')?.status).toBe('found');
  });

  it('only talks to legal open catalogues', async () => {
    const { f, calls } = mockFetch(openalex(BARE), s2none);
    await lookupOpenAccess({ doi: DOI }, f, { env: { CORE_API_KEY: 'test-key' } });
    const hosts = new Set(calls.map((c) => new URL(c.url).hostname));
    for (const h of hosts) expect(['api.openalex.org', 'api.crossref.org', 'api.unpaywall.org', 'api.semanticscholar.org', 'www.ebi.ac.uk', 'api.core.ac.uk', 'export.arxiv.org']).toContain(h);
  });

  it('a known work without free copies is "closed", with no contact e-mail unless metadata prints one', async () => {
    const { f } = mockFetch(openalex(BARE), s2none);
    const r = await lookupOpenAccess({ doi: DOI }, f);
    expect(r.status).toBe('closed');
    expect(r.landingUrl).toBe(`https://doi.org/${DOI}`);
    expect(r.contactEmail).toBeUndefined();
    expect(r.authors).toEqual(['Ada Quillfeather']);
  });

  it('a free HTML full text without a PDF link still counts as open (readUrls)', async () => {
    const { f } = mockFetch(openalex(BARE), (u) =>
      u.startsWith('https://api.unpaywall.org/') ? json({ best_oa_location: { url_for_pdf: null, url: 'https://journal.example.org/lumen/full', host_type: 'publisher', version: 'publishedVersion' }, oa_locations: [] }) : undefined,
    );
    const r = await lookupOpenAccess({ doi: DOI }, f);
    expect(r.status).toBe('oa');
    expect(r.pdfUrls).toEqual([]);
    expect(r.readUrls?.[0]).toMatchObject({ url: 'https://journal.example.org/lumen/full', host: 'publisher', version: 'published' });
  });

  it('sends a polite User-Agent with mailto, the OpenAlex mailto parameter and the Unpaywall e-mail', async () => {
    const { f, calls } = mockFetch(openalex(BARE));
    await lookupOpenAccess({ doi: DOI }, f);
    const oa = calls.find((c) => c.url.startsWith('https://api.openalex.org/'));
    expect(oa?.url).toContain(`mailto=${encodeURIComponent(OA_CONTACT)}`);
    expect(hdr(oa?.init)['User-Agent']).toContain(`mailto:${OA_CONTACT}`);
    expect(calls.some((c) => c.url.startsWith(`https://api.unpaywall.org/v2/${DOI}`) && c.url.includes(`email=${encodeURIComponent(OA_CONTACT)}`))).toBe(true);
  });

  it('falls back to Crossref when OpenAlex misses; ignores Crossref links of works without a CC licence', async () => {
    const cr = (license?: string) => (u: string) =>
      u.startsWith(`https://api.crossref.org/works/${DOI}`)
        ? json({ message: { DOI, title: [TITLE], issued: { 'date-parts': [[2021]] }, URL: `https://doi.org/${DOI}`, link: [{ URL: 'https://journal.example.org/tdm/lumen.pdf', 'content-type': 'application/pdf' }], license: license ? [{ URL: license }] : [] } })
        : undefined;
    const upw: Route = (u) => (u.startsWith(`https://api.unpaywall.org/v2/${DOI}`) ? json({ best_oa_location: { url_for_pdf: 'https://repo.example.org/lumen.pdf', host_type: 'repository', version: 'acceptedVersion' }, oa_locations: [] }) : undefined);
    let r = await lookupOpenAccess({ doi: DOI }, mockFetch(cr(), upw).f);
    expect(r.title).toBe(TITLE);
    expect(r.pdfUrls.map((c) => c.url)).toEqual(['https://repo.example.org/lumen.pdf']);
    resetOaState();
    r = await lookupOpenAccess({ doi: DOI }, mockFetch(cr('https://creativecommons.org/licenses/by/4.0/'), upw).f);
    expect(r.pdfUrls[0]).toMatchObject({ url: 'https://journal.example.org/tdm/lumen.pdf', host: 'publisher' });
  });

  it('CORE is skipped without a key and used (Bearer) with one', async () => {
    const core: Route = (u, init) => (u.startsWith('https://api.core.ac.uk/') && hdr(init).Authorization === 'Bearer test-key' ? json({ results: [{ doi: DOI, downloadUrl: 'https://core.ac.uk/download/1234.pdf' }] }) : undefined);
    const a = mockFetch(openalex(BARE), s2none, core);
    let r = await lookupOpenAccess({ doi: DOI }, a.f);
    expect(a.calls.some((c) => c.url.includes('core.ac.uk'))).toBe(false);
    expect(r.sources?.find((s) => s.name === 'CORE')?.status).toBe('skipped');
    resetOaState();
    r = await lookupOpenAccess({ doi: DOI }, mockFetch(openalex(BARE), s2none, core).f, { env: { CORE_API_KEY: 'test-key' } });
    expect(r.pdfUrls[0]).toMatchObject({ url: 'https://core.ac.uk/download/1234.pdf', source: 'CORE', host: 'repository', via: ['CORE'] });
  });

  it('CORE finds a repository copy by title when there is no DOI, and rejects a different work', async () => {
    const coreHit: Route = (u) =>
      u.startsWith('https://api.core.ac.uk/')
        ? json({
            results: [
              { title: 'Lumen Index: Moss Growth Without Benchmarks', authors: [{ name: 'Someone Else' }], yearPublished: 2010, downloadUrl: 'https://repo.example.edu/other.pdf' },
              { title: TITLE, authors: [{ name: 'Quillfeather, Ada' }], yearPublished: 2021, downloadUrl: 'https://repo.example.edu/bitstream/lumen.pdf' },
            ],
          })
        : undefined;
    const nothing: Route = (u) =>
      u.startsWith('https://api.openalex.org/works?') ? json({ results: [] }) : u.startsWith('https://api.crossref.org/works?') ? json({ message: { items: [] } }) : u.includes('europepmc') ? json({ resultList: { result: [] } }) : undefined;
    const { f, calls } = mockFetch(nothing, s2none, coreHit);
    const r = await lookupOpenAccess({ title: TITLE, author: 'Quillfeather', year: 2021 }, f, { env: { CORE_API_KEY: 'test-key' } });
    const coreCall = calls.find((c) => c.url.includes('core.ac.uk'));
    expect(decodeURIComponent(coreCall?.url ?? '')).toContain('title:(');
    expect(r.pdfUrls.map((c) => c.url)).toEqual(['https://repo.example.edu/bitstream/lumen.pdf']);
    expect(r.sources?.find((s) => s.name === 'CORE')?.status).toBe('found');
  });

  it('a work identified through Crossref also gets the copies OpenAlex lists for its DOI', async () => {
    const crossrefItem = { DOI: DOI, title: [TITLE], issued: { 'date-parts': [[2021]] }, author: [{ given: 'Ada', family: 'Quillfeather' }] };
    const { f, calls } = mockFetch(
      (u) => (u.startsWith('https://api.crossref.org/works?') ? json({ message: { items: [crossrefItem] } }) : undefined),
      openalex(WORK),
      s2none,
    );
    // no OpenAlex key + title only: Crossref identifies the work first
    const r = await lookupOpenAccess({ title: TITLE, author: 'Quillfeather', year: 2021 }, f);
    expect(calls.some((c) => c.url.startsWith(`https://api.openalex.org/works/doi:${encodeURIComponent(DOI)}`))).toBe(true);
    expect(r.pdfUrls.some((c) => c.url === 'https://journal.example.org/lumen.pdf')).toBe(true);
    expect(r.openalexId).toBe('W1');
    expect(r.contactEmail).toBe('ada.quill@example.edu');
  });

  it('without a DOI, finds a Europe PMC preprint by title (and marks it as preprint)', async () => {
    const { f, calls } = mockFetch(
      (u) => (u.startsWith('https://api.openalex.org/works?') ? json({ results: [] }) : undefined),
      (u) => (u.startsWith('https://api.crossref.org/works?') ? json({ message: { items: [] } }) : undefined),
      (u) => (u.startsWith('https://www.ebi.ac.uk/europepmc/') ? json({ resultList: { result: [{ title: TITLE, source: 'PPR', pmcid: 'PMC777', isOpenAccess: 'Y' }] } }) : undefined),
    );
    const r = await lookupOpenAccess({ title: TITLE, year: 2021 }, f);
    expect(r.status).toBe('oa');
    expect(r.pdfUrls[0]).toMatchObject({ source: 'Europe PMC', host: 'preprint', version: 'preprint' });
    expect(decodeURIComponent(calls.find((c) => c.url.includes('europepmc'))?.url ?? '')).toContain(`TITLE:"${TITLE}"`);
  });

  it('title search accepts only a close match', async () => {
    const { f } = mockFetch((u) => (u.startsWith('https://api.openalex.org/works?') ? json({ results: [{ ...WORK, title: 'Something else entirely about cats' }] }) : undefined));
    const r = await lookupOpenAccess({ title: TITLE, year: 2021 }, f);
    expect(r.status).toBe('not_found');
  });

  it('resolves a bilingual no-DOI hit to the sibling record that has a DOI and PDF', async () => {
    const pt = 'Indice de lumen para o crescimento ficticio modelado';
    const bilingual = {
      id: 'https://openalex.org/W-stub',
      doi: null,
      display_name: `${TITLE}. ${pt}`,
      title: `${TITLE}. ${pt}`,
      publication_year: 2021,
      authorships: [{ author: { display_name: 'Ada Quillfeather' } }],
      best_oa_location: null,
      locations: [],
    };
    const { f, calls } = mockFetch(
      (u) => (u.startsWith('https://api.openalex.org/works?') && u.includes('has_doi') ? json({ results: [WORK] }) : undefined),
      (u) => (u.startsWith('https://api.openalex.org/works?') ? json({ results: [bilingual] }) : undefined),
      s2none,
    );
    const r = await lookupOpenAccess({ title: pt, year: 2021, author: 'Quillfeather' }, f);
    expect(r.status).toBe('oa');
    expect(r.doi).toBe(DOI);
    expect(r.pdfUrls[0]?.url).toBe('https://journal.example.org/lumen.pdf');
    expect(calls.some((c) => c.url.includes('has_doi'))).toBe(true);
  });

  it('asks arXiv by title only when nothing else gave a PDF', async () => {
    const atom = `<feed><entry><id>http://arxiv.org/abs/2101.00001v1</id><title>Lumen Index: Synthetic Benchmarks for Moss
      Growth Modelling</title></entry></feed>`;
    const arxiv: Route = (u) => (u.startsWith('https://export.arxiv.org/api/query') ? new Response(atom) : undefined);
    const a = mockFetch(openalex(BARE), s2none, arxiv);
    const r = await lookupOpenAccess({ doi: DOI }, a.f);
    expect(r.pdfUrls[0]).toMatchObject({ url: 'https://arxiv.org/pdf/2101.00001', host: 'preprint', via: ['arXiv'] });
    resetOaState();
    const b = mockFetch(openalex(WORK), s2none, arxiv);
    await lookupOpenAccess({ doi: DOI }, b.f);
    expect(b.calls.some((c) => c.url.includes('export.arxiv.org'))).toBe(false);
  });

  it('a slow catalogue times out without sinking the others, and the degraded answer is not cached', async () => {
    const hang: Route = (u, init) =>
      u.startsWith('https://api.semanticscholar.org/') ? new Promise<Response>((_, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted')))) : undefined;
    const cache = memoryCache();
    const { f } = mockFetch(openalex(BARE), hang);
    const r = await lookupOpenAccess({ doi: DOI }, f, { timeoutMs: 20, cache });
    expect(r.status).toBe('closed');
    expect(r.sources?.find((s) => s.name === 'Semantic Scholar')?.status).toBe('timeout');
    expect(await cache.get(`v2|doi|${DOI}`)).toBeUndefined();
  });

  it('a 429 puts that catalogue on cool-down (Retry-After) for the next lookups', async () => {
    const t = 1_000_000;
    const { f, calls } = mockFetch(openalex(BARE), (u) => (u.startsWith('https://api.semanticscholar.org/') ? json({}, { status: 429, headers: { 'retry-after': '30' } }) : undefined));
    const r = await lookupOpenAccess({ doi: DOI }, f, { now: () => t });
    expect(r.sources?.find((s) => s.name === 'Semantic Scholar')?.status).toBe('rate_limited');
    const before = calls.filter((c) => c.url.includes('semanticscholar')).length;
    const r2 = await lookupOpenAccess({ doi: '10.5555/fx.0002' }, f, { now: () => t + 10_000 });
    expect(calls.filter((c) => c.url.includes('semanticscholar')).length).toBe(before);
    expect(r2.sources?.find((s) => s.name === 'Semantic Scholar')?.status).toBe('rate_limited');
  });

  it('calls fetch unbound (Workers throw "Illegal invocation" otherwise)', async () => {
    const { f } = mockFetch(openalex(WORK), s2none);
    const strict = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      return f(input, init);
    } as typeof fetch;
    const r = await lookupOpenAccess({ doi: DOI }, strict);
    expect(r.sources?.find((s) => s.name === 'OpenAlex')?.status).toBe('found');
  });

  it('caches answers: the same reference twice hits the network once', async () => {
    const { f, calls } = mockFetch(openalex(WORK), s2none);
    await lookupOpenAccess({ doi: DOI }, f);
    const n = calls.length;
    const again = await lookupOpenAccess({ doi: DOI }, f);
    expect(calls.length).toBe(n);
    expect(again.cached).toBe(true);
    expect(again.pdfUrls[0].url).toBe('https://journal.example.org/lumen.pdf');
  });
});

describe('PDF proxy', () => {
  const lookup: Route = (u) => (u.startsWith('https://api.openalex.org/works/doi:') ? json({ ...WORK, locations: [] }) : u.startsWith('https://api.semanticscholar.org/') ? json({}) : undefined);

  it('streams a real PDF with its source, host type, version and no caching', async () => {
    const { f } = mockFetch(lookup, (u) => (u === 'https://journal.example.org/lumen.pdf' ? pdf() : undefined));
    const res = await handleOaRequest(new URL(`https://fontexto.com/api/oa/pdf?doi=${DOI}`), f);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(decodeURIComponent(res.headers.get('x-fontexto-source') ?? '')).toBe('Journal of Example Studies');
    expect(res.headers.get('x-fontexto-host')).toBe('publisher');
    expect(res.headers.get('x-fontexto-version')).toBe('published');
    expect(new TextDecoder().decode(await res.arrayBuffer())).toMatch(/^%PDF-/);
  });

  it('rejects HTML disguised as PDF and reports the result instead', async () => {
    const { f } = mockFetch(lookup, (u) => (u === 'https://journal.example.org/lumen.pdf' ? new Response('<html>login</html>', { headers: { 'content-type': 'application/octet-stream' } }) : undefined));
    const res = await handleOaRequest(new URL(`https://fontexto.com/api/oa/pdf?doi=${DOI}`), f);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.result.status).toBe('oa');
  });

  it('follows redirects hop by hop, never to private hosts, keeping same-site cookies only', async () => {
    const { f, calls } = mockFetch(
      lookup,
      (u) => (u === 'https://journal.example.org/lumen.pdf' ? new Response(null, { status: 302, headers: { location: 'https://auth.example.org/check', 'set-cookie': 'sess=1; Path=/' } }) : undefined),
      (u, init) =>
        u === 'https://auth.example.org/check'
          ? hdr(init).Cookie === 'sess=1'
            ? new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret.pdf' } })
            : new Response('no cookie', { status: 403 })
          : undefined,
    );
    const res = await handleOaRequest(new URL(`https://fontexto.com/api/oa/pdf?doi=${DOI}`), f);
    expect(res.status).toBe(404);
    expect(calls.some((c) => c.url.includes('127.0.0.1'))).toBe(false);
    const auth = calls.find((c) => c.url === 'https://auth.example.org/check');
    expect(hdr(auth?.init).Cookie).toBe('sess=1');
    // the cookie never goes to the catalogue calls
    expect(calls.filter((c) => hdr(c.init).Cookie).map((c) => c.url)).toEqual(['https://auth.example.org/check']);
  });

  it('falls back to the arXiv copy found by title', async () => {
    const atom = `<feed><entry><id>http://arxiv.org/abs/2101.00001v1</id><title>Lumen Index: Synthetic Benchmarks for Moss
      Growth Modelling</title></entry></feed>`;
    const { f } = mockFetch(
      openalex(BARE),
      s2none,
      (u) => (u.startsWith('https://export.arxiv.org/api/query') ? new Response(atom) : undefined),
      (u) => (u === 'https://arxiv.org/pdf/2101.00001' ? pdf() : undefined),
    );
    const res = await handleOaRequest(new URL(`https://fontexto.com/api/oa/pdf?doi=${DOI}`), f);
    expect(res.status).toBe(200);
    expect(decodeURIComponent(res.headers.get('x-fontexto-source') ?? '')).toBe('arXiv');
    expect(res.headers.get('x-fontexto-version')).toBe('preprint');
  });

  it('400 without DOI or title', async () => {
    const res = await handleOaRequest(new URL('https://fontexto.com/api/oa/lookup'), mockFetch().f);
    expect(res.status).toBe(400);
  });
});

describe('arXiv title guard', () => {
  it('a short title without an author is not searched on arXiv', async () => {
    const { f, calls } = mockFetch(
      (u) => (u.startsWith('https://api.openalex.org/works?') ? json({ results: [{ ...BARE, title: 'Moss growth', doi: null }] }) : undefined),
    );
    await lookupOpenAccess({ title: 'Moss growth models' }, f);
    expect(calls.some((c) => c.url.includes('export.arxiv.org'))).toBe(false);
  });
  it('an arXiv entry by other authors is not taken', async () => {
    const atom = `<feed><entry><id>http://arxiv.org/abs/2101.00009v1</id><title>Moss Growth Models</title><author><name>Someone Else</name></author></entry></feed>`;
    const { f } = mockFetch(
      (u) => (u.startsWith('https://api.openalex.org/works?') ? json({ results: [{ ...BARE, title: 'Moss Growth Models', doi: null }] }) : undefined),
      (u) => (u.startsWith('https://export.arxiv.org/api/query') ? new Response(atom) : undefined),
    );
    const r = await lookupOpenAccess({ title: 'Moss Growth Models', author: 'Quillfeather' }, f);
    expect(r.pdfUrls).toEqual([]);
  });
});

describe('OJS galley links', () => {
  it('the reader page of a galley maps to its download URL; other links are left alone', async () => {
    const { ojsDownloadUrl } = await import('../src/core/openAccess');
    expect(ojsDownloadUrl('https://www.educ-res.com/index.php/er/article/view/7158/6815')).toBe('https://www.educ-res.com/index.php/er/article/download/7158/6815');
    expect(ojsDownloadUrl('https://revistas.example.br/index.php/rev/article/view/12/34/')).toBe('https://revistas.example.br/index.php/rev/article/download/12/34');
    expect(ojsDownloadUrl('https://revistas.example.br/index.php/rev/article/view/12')).toBeUndefined();
    expect(ojsDownloadUrl('https://journal.example.org/lumen.pdf')).toBeUndefined();
  });
});

describe('CORE quota', () => {
  it('is not asked when another catalogue already gave a PDF, even with a key', async () => {
    resetOaState();
    const { f, calls } = mockFetch(openalex(WORK), s2none);
    const r = await lookupOpenAccess({ doi: DOI }, f, { env: { CORE_API_KEY: 'test-key' } });
    expect(r.pdfUrls.length).toBeGreaterThan(0);
    expect(calls.some((c) => c.url.includes('core.ac.uk'))).toBe(false);
    expect(r.sources?.find((s) => s.name === 'CORE')?.status).toBe('skipped');
  });
});
