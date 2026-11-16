import { describe, expect, it, vi } from 'vitest';
import { parseOaBatchBody, OA_BATCH_MAX } from '../src/core/oaBatch';
import { makePacer, withRetry } from '../src/core/oaClient';
import { checkClientRateLimit, clientIpFromRequest, resetOaRateLimits } from '../src/core/oaRateLimit';
import { isFetchableUrl, lookupOpenAccess, memoryCache, oaCacheKey, openAlexApiKey, pmcIdOf, pmcPdfCandidates, resetOaState, sourcesIndicateUpstreamError } from '../src/core/openAccess';

describe('OA cache keys v6', () => {
  it('versions DOI and title keys', () => {
    expect(oaCacheKey({ doi: '10.5555/x' })).toBe('v6|doi|10.5555/x');
    expect(oaCacheKey({ title: 'Sample lattice study', year: 2020 })).toMatch(/^v6\|t\|/);
  });
});

describe('in-flight coalescing', () => {
  it('runs one upstream lookup for parallel identical queries', async () => {
    resetOaState();
    let calls = 0;
    const f = (async (url: string) => {
      calls++;
      if (url.startsWith('https://api.openalex.org/works/doi:'))
        return new Response(JSON.stringify({ id: 'https://openalex.org/W1', doi: 'https://doi.org/10.5555/coalesce', title: 'Coalesce test', open_access: { is_oa: false } }), { headers: { 'content-type': 'application/json' } });
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const q = { doi: '10.5555/coalesce' };
    const [a, b] = await Promise.all([lookupOpenAccess(q, f), lookupOpenAccess(q, f)]);
    expect(a.doi).toBe('10.5555/coalesce');
    expect(b.doi).toBe('10.5555/coalesce');
    expect(calls).toBeLessThan(12);
  });
});

describe('client rate limit', () => {
  it('returns retry-after when the per-minute budget is exceeded', () => {
    resetOaRateLimits();
    const ip = '203.0.113.50';
    let t = 1_000_000;
    for (let i = 0; i < 200; i++) {
      expect(checkClientRateLimit(ip, t).ok).toBe(true);
    }
    const blocked = checkClientRateLimit(ip, t);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it('reads CF-Connecting-IP first', () => {
    expect(clientIpFromRequest(new Request('https://x/', { headers: { 'CF-Connecting-IP': '198.51.100.2' } }))).toBe('198.51.100.2');
  });
});

describe('batch parse', () => {
  it('accepts up to OA_BATCH_MAX queries', () => {
    const queries = Array.from({ length: OA_BATCH_MAX }, (_, i) => ({ doi: `10.5555/b${i}` }));
    expect(parseOaBatchBody({ queries })?.length).toBe(OA_BATCH_MAX);
    expect(parseOaBatchBody({ queries: [...queries, { doi: '10.5555/extra' }] })).toBeUndefined();
  });
});

describe('landing pdf meta', () => {
  it('parses citation_pdf_url from HTML', async () => {
    const html = `<html><head><meta name="citation_pdf_url" content="https://example.org/o/a.pdf"/></head></html>`;
    const f = (async () => new Response(html, { headers: { 'content-type': 'text/html' } })) as typeof fetch;
    const { pdfUrlFromLanding } = await import('../src/core/openAccess');
    expect(await pdfUrlFromLanding('https://example.org/article', f)).toBe('https://example.org/o/a.pdf');
  });
});

describe('SSRF guard', () => {
  it('blocks private IPv4 literals', () => {
    expect(isFetchableUrl('http://10.0.0.5/file.pdf')).toBe(false);
    expect(isFetchableUrl('http://127.0.0.1/x.pdf')).toBe(false);
    expect(isFetchableUrl('http://192.168.1.1/x.pdf')).toBe(false);
  });
});

describe('client queue backoff', () => {
  it('honours retry-after in error messages', async () => {
    const sleeps: number[] = [];
    await withRetry(
      async () => {
        throw new Error('429 retry-after: 2');
      },
      [5000],
      async (ms) => sleeps.push(ms),
    ).catch(() => undefined);
    expect(sleeps[0]).toBe(2000);
  });

  it('completes a full queue under pacing', async () => {
    const starts: number[] = [];
    const pace = makePacer(100, () => starts.length * 50, async () => undefined);
    for (let i = 0; i < 12; i++) {
      await pace();
      starts.push(i);
    }
    expect(starts.length).toBe(12);
  });
});

describe('degraded cache TTL', () => {
  it('does not cache a full rate-limited miss', async () => {
    resetOaState();
    const cache = memoryCache();
    const t = 1_000_000;
    const bare = { id: 'https://openalex.org/W9', doi: 'https://doi.org/10.5555/nocache', title: 'No cache', open_access: { is_oa: false }, locations: [] };
    const f = vi.fn(async (url: string) => {
      if (url.startsWith('https://api.openalex.org/works/doi:'))
        return new Response(JSON.stringify(bare), { headers: { 'content-type': 'application/json' } });
      if (url.includes('semanticscholar')) return new Response('', { status: 429, headers: { 'retry-after': '60' } });
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const r = await lookupOpenAccess({ doi: '10.5555/nocache' }, f, { cache, now: () => t });
    expect(r.sources?.some((s) => s.status === 'rate_limited')).toBe(true);
    expect(await cache.get(oaCacheKey({ doi: '10.5555/nocache' }))).toBeUndefined();
  });

  it('does not cache a miss after an OpenAlex HTTP 401', async () => {
    resetOaState();
    const cache = memoryCache();
    const f = vi.fn(async (url: string) => {
      if (url.startsWith('https://api.openalex.org/'))
        return new Response('{"error":"Invalid or missing API key"}', { status: 401, headers: { 'content-type': 'application/json' } });
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const r = await lookupOpenAccess({ doi: '10.5555/oa-401' }, f, { cache, env: { OPENALEX_API_KEY: 'test-key-abc' } });
    expect(r.sources?.some((s) => s.name === 'OpenAlex' && s.detail === 'http_401')).toBe(true);
    expect(await cache.get(oaCacheKey({ doi: '10.5555/oa-401' }))).toBeUndefined();
  });
});

describe('PMC pdf fallback', () => {
  it('extracts PMC ids from NCBI, Europe PMC, accid, and bare ids', () => {
    expect(pmcIdOf('https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1234567/pdf/foo.pdf')).toBe('1234567');
    expect(pmcIdOf('https://europepmc.org/articles/PMC1234567?pdf=render')).toBe('1234567');
    expect(pmcIdOf('https://europepmc.org/article/PMC/1234567')).toBe('1234567');
    expect(pmcIdOf('https://europepmc.org/backend/ptpmcrender.fcgi?accid=PMC1234567&blobtype=pdf')).toBe('1234567');
    expect(pmcIdOf('PMC1234567')).toBe('1234567');
  });

  it('lists NCBI and Europe PMC PDF endpoints', () => {
    expect(pmcPdfCandidates('PMC42')).toEqual([
      'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC42/pdf/',
      'https://europepmc.org/articles/PMC42?pdf=render',
      'https://europepmc.org/backend/ptpmcrender.fcgi?accid=PMC42&blobtype=pdf',
    ]);
  });
});

describe('upstream error classification', () => {
  it('does not count a Semantic Scholar 429 as a failure when another catalogue answered', () => {
    expect(
      sourcesIndicateUpstreamError([
        { name: 'OpenAlex', status: 'found' },
        { name: 'Semantic Scholar', status: 'rate_limited' },
        { name: 'Europe PMC', status: 'none' },
      ]),
    ).toBe(false);
    expect(
      sourcesIndicateUpstreamError([
        { name: 'OpenAlex', status: 'none' },
        { name: 'Semantic Scholar', status: 'rate_limited' },
      ]),
    ).toBe(false);
  });

  it('still flags a miss when no catalogue answered', () => {
    expect(
      sourcesIndicateUpstreamError([
        { name: 'OpenAlex', status: 'error' },
        { name: 'Semantic Scholar', status: 'rate_limited' },
        { name: 'Unpaywall', status: 'skipped' },
      ]),
    ).toBe(true);
  });
});

describe('OpenAlex API key', () => {
  it('trims BOM, spaces and newlines', () => {
    expect(openAlexApiKey({ OPENALEX_API_KEY: 'test-key-abc\n' })).toBe('test-key-abc');
    expect(openAlexApiKey({ OPENALEX_API_KEY: '\r\n test-key-abc \t' })).toBe('test-key-abc');
    expect(openAlexApiKey({ OPENALEX_API_KEY: '\ufefftest-key-abc' })).toBe('test-key-abc');
    expect(openAlexApiKey({ OPENALEX_API_KEY: '   \n' })).toBeUndefined();
    expect(openAlexApiKey({ })).toBeUndefined();
  });

  it('sends the trimmed key on OpenAlex requests, never a trailing newline', async () => {
    resetOaState();
    const urls: string[] = [];
    const work = { id: 'https://openalex.org/W1', doi: 'https://doi.org/10.5555/trim-key', title: 'Trim key', open_access: { is_oa: false }, locations: [] };
    const f = (async (url: string) => {
      urls.push(url);
      if (url.startsWith('https://api.openalex.org/works/doi:'))
        return new Response(JSON.stringify(work), { headers: { 'content-type': 'application/json' } });
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    await lookupOpenAccess({ doi: '10.5555/trim-key' }, f, { env: { OPENALEX_API_KEY: 'test-key-abc\n' }, cache: memoryCache() });
    const openAlex = urls.filter((u) => u.startsWith('https://api.openalex.org/'));
    expect(openAlex.length).toBeGreaterThan(0);
    for (const u of openAlex) {
      expect(new URL(u).searchParams.get('api_key')).toBe('test-key-abc');
      expect(u).not.toMatch(/api_key=test-key-abc(?:%0[AaDd]|[\r\n])/);
    }
  });
});
