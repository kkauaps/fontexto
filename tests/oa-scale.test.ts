import { describe, expect, it, vi } from 'vitest';
import { parseOaBatchBody, OA_BATCH_MAX } from '../src/core/oaBatch';
import { makePacer, withRetry } from '../src/core/oaClient';
import { checkClientRateLimit, clientIpFromRequest, resetOaRateLimits } from '../src/core/oaRateLimit';
import { isFetchableUrl, lookupOpenAccess, memoryCache, oaCacheKey, resetOaState } from '../src/core/openAccess';

describe('OA cache keys v5', () => {
  it('versions DOI and title keys', () => {
    expect(oaCacheKey({ doi: '10.5555/x' })).toBe('v5|doi|10.5555/x');
    expect(oaCacheKey({ title: 'Sample lattice study', year: 2020 })).toMatch(/^v5\|t\|/);
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
});