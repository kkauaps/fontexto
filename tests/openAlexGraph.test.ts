import { beforeEach, describe, expect, it } from 'vitest';
import { resetOaState } from '../src/core/openAccess';
import { GRAPH_MAX_ITEMS, handleGraphRequest, parseGraphItems, resetGraphCache, resolveGraphItems, toGraphWork } from '../src/core/openAlexGraph';

const W = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `https://openalex.org/W${n}`,
  doi: `https://doi.org/10.5555/fx.${n}`,
  display_name: `Fictional work ${n}`,
  title: `Fictional work ${n}`,
  publication_year: 2010 + n,
  type: 'article',
  cited_by_count: n * 10,
  referenced_works: [`https://openalex.org/W${n + 1}`, 'https://openalex.org/W999'],
  primary_topic: { id: 'https://openalex.org/T10', display_name: 'Flood risk', subfield: { id: 'https://openalex.org/subfields/2312', display_name: 'Water Science' }, field: { id: 'https://openalex.org/fields/23', display_name: 'Environmental Science' } },
  ...extra,
});

function fakeFetch(handler: (url: URL) => Response | Promise<Response>) {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const u = new URL(String(input));
    calls.push(u.toString());
    return handler(u);
  }) as typeof fetch;
  return { f, calls };
}
const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  resetOaState();
  resetGraphCache();
});

describe('openAlexGraph', () => {
  it('trims an OpenAlex work to what the graph needs', () => {
    expect(toGraphWork(W(1))).toEqual({
      id: 'W1',
      type: 'article',
      year: 2011,
      citedBy: 10,
      refs: ['W2', 'W999'],
      topic: { id: 'T10', name: 'Flood risk', subfield: { id: '2312', name: 'Water Science' }, field: { id: '23', name: 'Environmental Science' } },
    });
    expect(toGraphWork({ id: 'https://example.org/x' })).toBeUndefined();
  });

  it('validates items: DOI normalized, bad ids dropped, size capped', () => {
    expect(parseGraphItems({ items: [{ key: 'a', doi: 'https://doi.org/10.5555/FX.1' }, { key: 'b', openalexId: 'W12' }, { key: 'c', openalexId: 'X1' }, { key: 'd', title: 'short' }] })).toEqual([
      { key: 'a', doi: '10.5555/fx.1', openalexId: undefined, title: undefined, year: undefined, author: undefined },
      { key: 'b', openalexId: 'W12', doi: undefined, title: undefined, year: undefined, author: undefined },
    ]);
    expect(parseGraphItems({ items: Array.from({ length: GRAPH_MAX_ITEMS + 1 }, (_, i) => ({ key: `k${i}`, doi: `10.5555/fx.${i}` })) })).toBeUndefined();
    expect(parseGraphItems({})).toBeUndefined();
  });

  it('resolves DOIs in ONE batched call, titles by search, and caches the answers; the key never reaches the client', async () => {
    const { f, calls } = fakeFetch((u) => {
      const filter = u.searchParams.get('filter') ?? '';
      if (filter.startsWith('doi:')) return ok({ results: [W(1), W(2)] });
      if (u.searchParams.get('search')) return ok({ results: [W(3, { title: 'Urban flood maps from fictional radar data', display_name: 'Urban flood maps from fictional radar data' })] });
      return ok({ results: [] });
    });
    const items = parseGraphItems({
      items: [
        { key: 'a', doi: '10.5555/fx.1' },
        { key: 'b', doi: '10.5555/fx.2' },
        { key: 'c', doi: '10.5555/fx.404' },
        { key: 'd', title: 'Urban flood maps from fictional radar data', year: 2013 },
      ],
    })!;
    const r = await resolveGraphItems(items, f, { env: { OPENALEX_API_KEY: 'secret-key' } });
    expect(Object.keys(r.works).sort()).toEqual(['a', 'b', 'd']);
    expect(r.status.c).toBe('not_found');
    expect(r.busy).toBe(false);
    expect(calls.filter((c) => c.includes('filter=doi'))).toHaveLength(1);
    expect(calls.every((c) => c.includes('api_key=secret-key'))).toBe(true);
    expect(JSON.stringify(r)).not.toContain('secret-key');
    const again = await resolveGraphItems(items, f, { env: { OPENALEX_API_KEY: 'secret-key' } });
    expect(again.works.a.id).toBe('W1');
    expect(calls.length).toBe(2); // 1 DOI batch + 1 title search; the second run is fully cached
  });

  it('marks the batch busy when OpenAlex throttles, without caching the miss', async () => {
    let throttle = true;
    const { f } = fakeFetch(() => (throttle ? new Response('slow down', { status: 429, headers: { 'retry-after': '1' } }) : ok({ results: [W(1)] })));
    const items = parseGraphItems({ items: [{ key: 'a', doi: '10.5555/fx.1' }] })!;
    let now = 1_000_000;
    const r = await resolveGraphItems(items, f, { now: () => now });
    expect(r).toMatchObject({ busy: true, status: { a: 'busy' } });
    throttle = false;
    now += 2000;
    const r2 = await resolveGraphItems(items, f, { now: () => now });
    expect(r2.status.a).toBe('found');
  });

  it('HTTP handler: POST + JSON only, size limit, and safe headers', async () => {
    const { f } = fakeFetch(() => ok({ results: [W(1)] }));
    const get = await handleGraphRequest(new Request('https://x/api/oa/graph'), f);
    expect(get.status).toBe(405);
    const form = await handleGraphRequest(new Request('https://x/api/oa/graph', { method: 'POST', body: 'a=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } }), f);
    expect(form.status).toBe(415);
    const big = await handleGraphRequest(new Request('https://x/api/oa/graph', { method: 'POST', body: JSON.stringify({ items: [{ key: 'a', title: 'x'.repeat(70_000) }] }), headers: { 'content-type': 'application/json' } }), f);
    expect(big.status).toBe(413);
    const r = await handleGraphRequest(new Request('https://x/api/oa/graph', { method: 'POST', body: JSON.stringify({ items: [{ key: 'a', doi: '10.5555/fx.1' }] }), headers: { 'content-type': 'application/json' } }), f);
    expect(r.status).toBe(200);
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect((await r.json()).works.a.refs).toEqual(['W2', 'W999']);
  });
});
