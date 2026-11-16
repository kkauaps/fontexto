import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleOaBatchRequest } from '../src/core/oaBatch';
import { OaDeadline, oaBatchLookup, oaTotalBudgetMs, runOaQueue, timeoutSignal, withDeadline } from '../src/core/oaClient';
import { resetOaState } from '../src/core/openAccess';

const never = () => new Promise<never>(() => {});

describe('OA deadlines: the free-PDF search always finishes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('withDeadline rejects even when the work ignores its signal', async () => {
    await expect(withDeadline(never, 20)).rejects.toBeInstanceOf(OaDeadline);
    await expect(withDeadline(async () => 'ok', 1000)).resolves.toBe('ok');
  });

  it('timeoutSignal fires on time and follows its parent', async () => {
    const s = timeoutSignal(15);
    await new Promise((r) => setTimeout(r, 40));
    expect(s.aborted).toBe(true);
    const parent = new AbortController();
    const child = timeoutSignal(60_000, parent.signal);
    parent.abort();
    expect(child.aborted).toBe(true);
  });

  it('a hung request ends as an error and the others still finish', async () => {
    const done: number[] = [];
    const errs: number[] = [];
    await runOaQueue([1, 2, 3, 4, 5, 6], {
      concurrency: 3,
      itemTimeoutMs: 30,
      run: (n) => (n === 2 || n === 5 ? never() : Promise.resolve(n)),
      onDone: (n) => done.push(n),
      onError: (n, e) => (expect(e).toBeInstanceOf(OaDeadline), errs.push(n)),
    });
    expect(done.sort()).toEqual([1, 3, 4, 6]);
    expect(errs.sort()).toEqual([2, 5]);
  });

  it('items not started before the total budget end as deadline errors', async () => {
    let t = 0;
    const seen: string[] = [];
    await runOaQueue([1, 2, 3, 4], {
      concurrency: 1,
      totalBudgetMs: 100,
      now: () => t,
      run: async (n) => ((t += 60), n),
      onDone: (n) => seen.push(`ok${n}`),
      onError: (n) => seen.push(`late${n}`),
    });
    expect(seen).toEqual(['ok1', 'ok2', 'late3', 'late4']);
  });

  it('total budget grows with the list but is capped', () => {
    expect(oaTotalBudgetMs(36)).toBeLessThan(oaTotalBudgetMs(300));
    expect(oaTotalBudgetMs(10_000)).toBe(15 * 60_000);
  });

  it('the metadata prefetch gives up after its budget instead of blocking the search', async () => {
    vi.stubGlobal('fetch', (_u: string, init: RequestInit) => new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason))));
    const t0 = Date.now();
    await expect(oaBatchLookup([{ doi: undefined, title: 'A sample study of lattices', year: undefined, author: 'Doe' }], '', 50)).rejects.toBeTruthy();
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('the batch endpoint starts no lookup after its deadline and leaves none running', async () => {
    resetOaState();
    let started = 0;
    let running = 0;
    const f = (async () => {
      running++;
      started++;
      await new Promise((r) => setTimeout(r, 30));
      running--;
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const queries = Array.from({ length: 24 }, (_, k) => ({ doi: `10.5555/batch-${k}` }));
    const res = await handleOaBatchRequest({ queries }, f, { timeoutMs: 60_000 }, 50);
    const body = (await res.json()) as { results: unknown[]; partial?: boolean };
    expect(res.status).toBe(200);
    expect(running).toBe(0);
    expect(body.partial).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results.length).toBeLessThan(24);
    expect(started).toBeGreaterThan(0);
  });
});
