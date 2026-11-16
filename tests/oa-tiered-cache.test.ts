/** Global KV tier behind the per-colo edge cache for /api/oa lookups. */
import { describe, expect, it } from 'vitest';
import { memoryCache, tieredCache, type KvStore, type OaResult } from '../src/core/openAccess';

function fakeKv() {
  const m = new Map<string, { v: string; ttl?: number }>();
  const kv: KvStore & { m: typeof m; reads: number } = {
    m,
    reads: 0,
    async get(k) {
      kv.reads++;
      const e = m.get(k);
      return e ? JSON.parse(e.v) : null;
    },
    async put(k, v, o) {
      m.set(k, { v, ttl: o?.expirationTtl });
    },
  };
  return kv;
}
const R: OaResult = { status: 'oa', title: 'Synthetic moss growth', pdfUrls: [], sources: [] };

describe('tieredCache', () => {
  it('is a no-op wrapper without a KV binding', () => {
    const inner = memoryCache();
    expect(tieredCache(inner, undefined)).toBe(inner);
  });

  it('a colo that never saw the answer reads it from KV and keeps it locally', async () => {
    const kv = fakeKv();
    await tieredCache(memoryCache(), kv).put('k', R, 30 * 24 * 3600);
    expect(kv.m.get('oa|k')?.ttl).toBe(30 * 24 * 3600);
    const otherColo = memoryCache();
    const c = tieredCache(otherColo, kv);
    expect(await c.get('k')).toMatchObject({ title: R.title });
    expect(await otherColo.get('k')).toMatchObject({ title: R.title });
    await c.get('k');
    expect(kv.reads).toBe(1);
  });

  it('short-lived answers (upstream errors) stay out of KV', async () => {
    const kv = fakeKv();
    await tieredCache(memoryCache(), kv).put('k', R, 60);
    expect(kv.m.size).toBe(0);
  });

  it('KV failures never break a lookup', async () => {
    const broken: KvStore = { get: async () => { throw new Error('down'); }, put: async () => { throw new Error('quota'); } };
    const c = tieredCache(memoryCache(), broken);
    await expect(c.put('k', R, 86400)).resolves.toBeUndefined();
    expect(await c.get('k')).toMatchObject({ title: R.title });
    expect(await c.get('missing')).toBeUndefined();
  });
});
