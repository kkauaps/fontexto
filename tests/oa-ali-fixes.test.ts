/** Parser, identifier and OA-lookup fixes for Nature-style numbered bibliographies. Fictional works only. */
import { beforeEach, describe, expect, it } from 'vitest';
import { findArxivIds, findDois, reconstructSpacedDois } from '../src/core/normalize';
import { lookupOpenAccess, memoryCache, oaCacheKey, parseArxivId, parseOaQuery, resetOaState } from '../src/core/openAccess';
import { parseReferenceText, toBibtex } from '../src/core/refparse';

type Route = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;
function mockFetch(...routes: Route[]) {
  const calls: { url: string }[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push({ url });
    for (const r of routes) {
      const res = r(url);
      if (res) return res;
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { f, calls };
}
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });

beforeEach(() => resetOaState());

describe('spaced DOIs and arXiv ids', () => {
  it('reconstructs DOIs that a PDF extractor split with spaces or zero-width characters', () => {
    const spaced = 'see h t t p s : / / d o i . o r g / 1 0 . 5 5 5 5 / f x . 0 0 0 1 (2021)';
    expect(findDois(spaced)).toEqual(['10.5555/fx.0001']);
    expect(findDois(`doi:${'\u200b'}10.5555/fx.0001`)).toEqual(['10.5555/fx.0001']);
    expect(reconstructSpacedDois(spaced)).toMatch(/10\.5555\/fx\.0001/);
  });

  it('finds labelled and bare new-style arXiv ids', () => {
    expect(findArxivIds('Isensee, F. nnU-Net. arXiv Preprint arXiv:1809.10486 (2018).')).toEqual(['1809.10486']);
    expect(findArxivIds('Segment Anything. 2304.02643 (2023).')).toEqual(['2304.02643']);
    expect(findArxivIds('https://arxiv.org/abs/cs/0301001v2')).toEqual(['cs/0301001']);
    expect(parseArxivId('arXiv:1809.10486v3')).toBe('1809.10486');
    expect(parseArxivId('https://arxiv.org/pdf/2304.02643.pdf')).toBe('2304.02643');
    expect(parseArxivId('not-an-id')).toBeUndefined();
  });
});

describe('Nature-style numbered author–year entries', () => {
  it('keeps the title and authors instead of splitting on initials, and emits eprint', () => {
    const text =
      'Quillfeather, A., Okonkwo-Lind, B. & Mira, C. Lumen Index: Synthetic Benchmarks for Moss Growth Modelling. arXiv Preprint arXiv:2101.00001 (2021).';
    const r = parseReferenceText(text, 0, '12');
    expect(r.authors.map((a) => a.family)).toEqual(['Quillfeather', 'Okonkwo-Lind', 'Mira']);
    expect(r.title).toMatch(/^Lumen Index/);
    expect(r.year).toBe(2021);
    expect(r.arxiv).toBe('2101.00001');
    expect(r.title).not.toMatch(/et al|^& /);
    const bib = toBibtex([{ ...r, key: 'quillfeather2021' }]);
    expect(bib).toMatch(/eprint = \{2101\.00001\}/);
    expect(bib).toMatch(/archivePrefix = \{arXiv\}/);
    expect(bib).toMatch(/url = \{https:\/\/arxiv\.org\/abs\/2101\.00001\}/);
  });

  it('keeps a quoted IEEE title when given-family names resemble Family, I.', () => {
    const text =
      'Zhou Wang, A. Bovik, H. Sheikh, and E. Simoncelli, “Image quality assessment: from error visibility to structural similarity,” IEEE Transactions on Image Processing, vol. 13, no. 4, pp. 600–612, 2004, doi:10.1109/tip.2003.819861.';
    const r = parseReferenceText(text, 0, '1');
    expect(r.title).toMatch(/^Image quality assessment/);
    expect(r.authors[0]?.family).toMatch(/Wang/i);
    expect(r.year).toBe(2004);
    expect(r.doi).toBe('10.1109/tip.2003.819861');
  });

  it('drops leftover author fragments used as a title', () => {
    const r = parseReferenceText('Quillfeather, A. et al. Something long enough as a title here. (2021).', 0);
    // After a good parse the title is the real title; the guard is for leftover "et al" / initials.
    expect(r.title === undefined || !/^(?:et\s+al|&)/i.test(r.title)).toBe(true);
  });
});

describe('OA query, cache and DOI fidelity', () => {
  it('accepts an arXiv id as a lookup query and versions the cache key', () => {
    const q = parseOaQuery(new URLSearchParams('arxiv=1809.10486'));
    expect(q).toEqual({ arxiv: '1809.10486' });
    expect(oaCacheKey({ arxiv: '1809.10486' })).toBe('v5|arxiv|1809.10486');
    expect(oaCacheKey({ doi: '10.5555/fx.0001' }).startsWith('v5|doi|')).toBe(true);
    expect(parseOaQuery(new URLSearchParams('arxiv=nope'))).toBeUndefined();
  });

  it('adds the legal arXiv PDF for a known id even when a DOI lookup finds no copy', async () => {
    const queried = '10.5555/closed-chapter';
    const { f, calls } = mockFetch((u) => (u.startsWith('https://api.openalex.org/works/doi:') ? new Response('missing', { status: 404 }) : undefined));
    const r = await lookupOpenAccess({ doi: queried, arxiv: '2101.00001' }, f);
    expect(r.pdfUrls.some((c) => c.url === 'https://arxiv.org/pdf/2101.00001')).toBe(true);
    expect(r.status).toBe('oa');
    expect(calls.some((c) => c.url.includes('openalex.org/works?search='))).toBe(false);
  });

  it('does not substitute a different work when an OpenAlex DOI lookup fails and a title search would match something else', async () => {
    const queried = '10.5555/fx.the-real-one';
    const wrong = {
      id: 'https://openalex.org/W9',
      doi: 'https://doi.org/10.5555/other-journal',
      title: 'Unrelated Sustainability Review of Mosses',
      publication_year: 2020,
      best_oa_location: { pdf_url: 'https://other.example.org/wrong.pdf', is_oa: true, version: 'publishedVersion', source: { display_name: 'Other Journal', type: 'journal' } },
      locations: [],
    };
    const { f, calls } = mockFetch(
      (u) => (u.startsWith('https://api.openalex.org/works/doi:') ? new Response('missing', { status: 404 }) : undefined),
      (u) => (u.startsWith('https://api.openalex.org/works?') ? json({ results: [wrong] }) : undefined),
    );
    const r = await lookupOpenAccess({ doi: queried, title: 'A review of deep learning' }, f);
    expect(r.doi).toBe(queried);
    expect(r.pdfUrls.some((c) => /wrong\.pdf/.test(c.url))).toBe(false);
    expect(calls.some((c) => c.url.includes('openalex.org/works?search='))).toBe(false);
  });

  it('does not reuse a v3 cache entry after the key version bump', async () => {
    const cache = memoryCache();
    await cache.put('v3|doi|10.5555/fx.0001', { status: 'not_found', pdfUrls: [] }, 60);
    const r = await lookupOpenAccess({ doi: '10.5555/fx.0001', arxiv: '2101.00001' }, (async () => new Response('missing', { status: 404 })) as typeof fetch, { cache });
    expect(r.cached).not.toBe(true);
    expect(r.pdfUrls[0]?.url).toBe('https://arxiv.org/pdf/2101.00001');
  });
});
