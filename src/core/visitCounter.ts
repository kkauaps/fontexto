/** Anonymous aggregate visit totals. Daily counts only: no IPs, cookies, or identifiers. */

export const VISITS_VISIBLE_AT = 1000;
export const VISITS_WINDOW_DAYS = 30;
export const VISITS_CACHE_MAX_AGE_SEC = 300;
export const VISITS_SHARDS = 32;
export const VISITS_KEY_TTL_SEC = 60 * 60 * 24 * 60;
export const VISIT_COUNTED_KEY = 'fontexto:visit-counted';
export const VISITS_OVERRIDE_PARAM = 'fx_visits';

const PRODUCTION_HOSTS = new Set(['fontexto.com', 'www.fontexto.com', 'fontexto.pages.dev']);

export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export function shouldShowVisits(count: number): boolean {
  return Number.isFinite(count) && count >= VISITS_VISIBLE_AT;
}

/** Preview Pages hostnames and local dev only. Production hosts never honour the override. */
export function isPreviewHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().split(':')[0] ?? '';
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') return true;
  if (PRODUCTION_HOSTS.has(host)) return false;
  return host.endsWith('.fontexto.pages.dev');
}

export function parseVisitOverride(hostname: string, search: string): number | undefined {
  if (!isPreviewHost(hostname)) return undefined;
  const query = search.startsWith('?') ? search.slice(1) : search;
  const raw = new URLSearchParams(query).get(VISITS_OVERRIDE_PARAM);
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000_000) return undefined;
  return Math.floor(n);
}

export function formatVisitCount(locale: string, count: number): string {
  const formatted = new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(count);
  if (locale === 'en' || locale.startsWith('en-')) return formatted.replace(/K\b/g, 'k');
  return formatted;
}

export function utcDayStamp(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
}

export function utcDays(now: Date = new Date(), n = VISITS_WINDOW_DAYS): string[] {
  const days: string[] = [];
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = 0; i < n; i++) days.push(new Date(base - i * 86_400_000).toISOString().slice(0, 10));
  return days;
}

export function shardKey(day: string, shard: number): string {
  return `v:${day}:${shard}`;
}

export function dayTotalKey(day: string): string {
  return `d:${day}`;
}

function parseCount(raw: string | null): number {
  const n = raw == null ? 0 : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function isVisitStorageKey(key: string): boolean {
  return /^(v:\d{4}-\d{2}-\d{2}:\d+|d:\d{4}-\d{2}-\d{2})$/.test(key);
}

/** Add one to a random (or given) shard of today's UTC date. Writes a number only. */
export async function incrementVisit(kv: KvLike, now: Date = new Date(), shard?: number): Promise<void> {
  const day = utcDayStamp(now);
  const s = (shard ?? Math.floor(Math.random() * VISITS_SHARDS)) % VISITS_SHARDS;
  const key = shardKey(day, s);
  const next = parseCount(await kv.get(key)) + 1;
  await kv.put(key, String(next), { expirationTtl: VISITS_KEY_TTL_SEC });
}

/**
 * Sum the last 30 UTC days. Past days may be rolled up into one daily total;
 * today is always summed from shards so mid-day increments are not frozen.
 */
export async function sumWindow(kv: KvLike, now: Date = new Date()): Promise<number> {
  const days = utcDays(now);
  const today = utcDayStamp(now);
  let total = 0;
  for (const day of days) {
    if (day !== today) {
      const rolled = await kv.get(dayTotalKey(day));
      if (rolled != null) {
        total += parseCount(rolled);
        continue;
      }
    }
    const reads: Promise<string | null>[] = [];
    for (let s = 0; s < VISITS_SHARDS; s++) reads.push(kv.get(shardKey(day, s)));
    let daySum = 0;
    for (const raw of await Promise.all(reads)) daySum += parseCount(raw);
    if (day !== today && daySum > 0) {
      await kv.put(dayTotalKey(day), String(daySum), { expirationTtl: VISITS_KEY_TTL_SEC });
    }
    total += daySum;
  }
  return total;
}
