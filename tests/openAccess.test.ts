/** "Só o documento": open-access lookup and the PDF proxy, with every network call mocked. */
import { describe, expect, it } from 'vitest';
import { handleOaRequest, isFetchableUrl, lookupOpenAccess, OA_CONTACT, parseOaQuery } from '../src/core/openAccess';

type Route = (url: string, init?: RequestInit) => Response | undefined;
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
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const pdf = (extra: Record<string, string> = {}) => new Response(new TextEncoder().encode('%PDF-1.7 fake body'), { headers: { 'content-type': 'application/pdf', ...extra } });

const WORK = {
  id: 'https://openalex.org/W1',
  doi: 'https://doi.org/10.1000/xyz',
  title: 'U-Net: Convolutional Networks for Biomedical Image Segmentation',
  publication_year: 2015,
  authorships: [{ author: { display_name: 'Olaf Ronneberger' } }],
  best_oa_location: { pdf_url: 'https://repo.example.org/unet.pdf', landing_page_url: 'https://repo.example.org/unet' },
  locations: [{ landing_page_url: 'https://arxiv.org/abs/1505.04597', pdf_url: null }],
};

describe('query and URL guards', () => {
  it('needs a DOI or a real title', () => {
    expect(parseOaQuery(new URLSearchParams('doi=https://doi.org/10.1000/ABC'))?.doi).toBe('10.1000/abc');
    expect(parseOaQuery(new URLSearchParams('title=abc'))).toBeUndefined();
    expect(parseOaQuery(new URLSearchParams('title=Deep learning for wounds&year=2020'))?.year).toBe(2020);
    expect(parseOaQuery(new URLSearchParams(''))).toBeUndefined();
  });
  it('only fetches public http(s) hosts', () => {
    expect(isFetchableUrl('https://arxiv.org/pdf/1505.04597')).toBe(true);
    for (const bad of ['file:///etc/passwd', 'http://localhost/x.pdf', 'http://127.0.0.1/x', 'http://10.0.0.1/x', 'https://[::1]/x', 'https://user:pw@example.org/x', 'https://example.org:8080/x', 'http://intranet/x'])
      expect(isFetchableUrl(bad), bad).toBe(false);
  });
});

describe('lookupOpenAccess', () => {
  it('collects candidates, arXiv first', async () => {
    const { f } = mockFetch(
      (u) => (u.startsWith('https://api.openalex.org/works/doi:') ? json(WORK) : undefined),
      (u) => (u.startsWith('https://api.semanticscholar.org/') ? json({ openAccessPdf: null, externalIds: {} }) : undefined),
    );
    const r = await lookupOpenAccess({ doi: '10.1000/xyz' }, f);
    expect(r.status).toBe('oa');
    expect(r.pdfUrls[0]).toEqual({ url: 'https://arxiv.org/pdf/1505.04597', source: 'arXiv' });
    expect(r.pdfUrls.map((p) => p.url)).toContain('https://repo.example.org/unet.pdf');
  });
  it('title search accepts only a close match', async () => {
    const { f } = mockFetch((u) => (u.startsWith('https://api.openalex.org/works?') ? json({ results: [{ ...WORK, title: 'Something else entirely about cats' }] }) : undefined));
    const r = await lookupOpenAccess({ title: 'U-Net: Convolutional Networks for Biomedical Image Segmentation', year: 2015 }, f);
    expect(r.status).toBe('not_found');
  });
  it('a known work without free copies is "closed"', async () => {
    const { f } = mockFetch(
      (u) => (u.startsWith('https://api.openalex.org/works/doi:') ? json({ ...WORK, best_oa_location: null, locations: [] }) : undefined),
      (u) => (u.startsWith('https://api.semanticscholar.org/') ? json({ openAccessPdf: null, externalIds: {} }) : undefined),
    );
    const r = await lookupOpenAccess({ doi: '10.1000/xyz' }, f);
    expect(r.status).toBe('closed');
    expect(r.landingUrl).toBe('https://doi.org/10.1000/xyz');
  });
  it('sends a polite User-Agent with mailto and the OpenAlex mailto parameter', async () => {
    const { f, calls } = mockFetch((u) => (u.startsWith('https://api.openalex.org/works/doi:') ? json({ ...WORK, best_oa_location: null, locations: [] }) : undefined));
    await lookupOpenAccess({ doi: '10.1000/xyz' }, f);
    const oa = calls.find((c) => c.url.startsWith('https://api.openalex.org/'));
    expect(oa?.url).toContain(`mailto=${encodeURIComponent(OA_CONTACT)}`);
    expect((oa?.init?.headers as Record<string, string>)['User-Agent']).toContain(`mailto:${OA_CONTACT}`);
    expect(calls.some((c) => c.url.startsWith('https://api.unpaywall.org/v2/10.1000/xyz') && c.url.includes(`email=${encodeURIComponent(OA_CONTACT)}`))).toBe(true);
  });
  it('falls back to Crossref when OpenAlex misses, and picks up an Unpaywall PDF', async () => {
    const { f } = mockFetch(
      (u) => (u.startsWith('https://api.crossref.org/works/10.1000/xyz') ? json({ message: { DOI: '10.1000/xyz', title: ['U-Net: Convolutional Networks for Biomedical Image Segmentation'], issued: { 'date-parts': [[2015]] }, URL: 'https://doi.org/10.1000/xyz' } }) : undefined),
      (u) => (u.startsWith('https://api.unpaywall.org/v2/10.1000/xyz') ? json({ best_oa_location: { url_for_pdf: 'https://unpaywall.example.org/unet.pdf' }, oa_locations: [] }) : undefined),
    );
    const r = await lookupOpenAccess({ doi: '10.1000/xyz' }, f);
    expect(r.status).toBe('oa');
    expect(r.title).toMatch(/U-Net/);
    expect(r.pdfUrls).toContainEqual({ url: 'https://unpaywall.example.org/unet.pdf', source: 'Unpaywall' });
  });
});

describe('PDF proxy', () => {
  const lookup: Route = (u) => (u.startsWith('https://api.openalex.org/works/doi:') ? json({ ...WORK, locations: [] }) : u.startsWith('https://api.semanticscholar.org/') ? json({}) : undefined);

  it('streams a real PDF with its source and no caching', async () => {
    const { f } = mockFetch(lookup, (u) => (u === 'https://repo.example.org/unet.pdf' ? pdf() : undefined));
    const res = await handleOaRequest(new URL('https://fontexto.com/api/oa/pdf?doi=10.1000/xyz'), f);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(decodeURIComponent(res.headers.get('x-fontexto-source') ?? '')).toBe('repo.example.org');
    expect(new TextDecoder().decode(await res.arrayBuffer())).toMatch(/^%PDF-/);
  });

  it('rejects HTML disguised as PDF and reports the result instead', async () => {
    const { f } = mockFetch(lookup, (u) => (u === 'https://repo.example.org/unet.pdf' ? new Response('<html>login</html>', { headers: { 'content-type': 'application/octet-stream' } }) : undefined));
    const res = await handleOaRequest(new URL('https://fontexto.com/api/oa/pdf?doi=10.1000/xyz'), f);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.result.status).toBe('oa');
  });

  it('follows redirects hop by hop, never to private hosts, keeping same-site cookies only', async () => {
    const { f, calls } = mockFetch(
      lookup,
      (u) => (u === 'https://repo.example.org/unet.pdf' ? new Response(null, { status: 302, headers: { location: 'https://auth.example.org/check', 'set-cookie': 'sess=1; Path=/' } }) : undefined),
      (u, init) =>
        u === 'https://auth.example.org/check'
          ? (init?.headers as Record<string, string>)?.Cookie === 'sess=1'
            ? new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret.pdf' } })
            : new Response('no cookie', { status: 403 })
          : undefined,
    );
    const res = await handleOaRequest(new URL('https://fontexto.com/api/oa/pdf?doi=10.1000/xyz'), f);
    expect(res.status).toBe(404);
    expect(calls.some((c) => c.url.includes('127.0.0.1'))).toBe(false);
    const auth = calls.find((c) => c.url === 'https://auth.example.org/check');
    expect((auth?.init?.headers as Record<string, string>)?.Cookie).toBe('sess=1');
    // the cookie never goes to the OpenAlex / Semantic Scholar calls
    expect(calls.filter((c) => (c.init?.headers as Record<string, string> | undefined)?.Cookie).map((c) => c.url)).toEqual(['https://auth.example.org/check']);
  });

  it('falls back to the arXiv copy found by title', async () => {
    const atom = `<feed><entry><id>http://arxiv.org/abs/1505.04597v1</id><title>U-Net: Convolutional Networks for Biomedical
      Image Segmentation</title></entry></feed>`;
    const { f } = mockFetch(
      (u) => (u.startsWith('https://api.openalex.org/works/doi:') ? json({ ...WORK, best_oa_location: null, locations: [] }) : u.startsWith('https://api.semanticscholar.org/') ? json({}) : undefined),
      (u) => (u.startsWith('https://export.arxiv.org/api/query') ? new Response(atom) : undefined),
      (u) => (u === 'https://arxiv.org/pdf/1505.04597' ? pdf() : undefined),
    );
    const res = await handleOaRequest(new URL('https://fontexto.com/api/oa/pdf?doi=10.1000/xyz'), f);
    expect(res.status).toBe(200);
    expect(decodeURIComponent(res.headers.get('x-fontexto-source') ?? '')).toBe('arXiv');
  });

  it('400 without DOI or title', async () => {
    const res = await handleOaRequest(new URL('https://fontexto.com/api/oa/lookup'), mockFetch().f);
    expect(res.status).toBe(400);
  });
});
