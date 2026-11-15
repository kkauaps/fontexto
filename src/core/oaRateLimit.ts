/** Per-IP pacing for /api/oa/* (in-isolate; prod can add a KV/DO binding for global counts). */
const WINDOW_MS = 60_000;
/** Enough for a 300-reference document plus graph batches in one minute. */
export const OA_IP_MAX_PER_MIN = 200;

const buckets = new Map<string, { count: number; reset: number }>();

export function resetOaRateLimits() {
  buckets.clear();
}

export function clientIpFromHeaders(headers: { get?(name: string): string | null; [key: string]: unknown }): string {
  const cf = typeof headers.get === 'function' ? headers.get('CF-Connecting-IP') : (headers['cf-connecting-ip'] as string | undefined);
  if (cf) return cf;
  const xff = typeof headers.get === 'function' ? headers.get('X-Forwarded-For') : (headers['x-forwarded-for'] as string | undefined);
  if (xff) return String(xff).split(',')[0]?.trim() || 'unknown';
  return 'unknown';
}

export function clientIpFromRequest(req: Request): string {
  return clientIpFromHeaders(req.headers);
}

export type RateCheck = { ok: true } | { ok: false; retryAfterSec: number };

export function checkClientRateLimit(ip: string, now = Date.now(), max = OA_IP_MAX_PER_MIN): RateCheck {
  let b = buckets.get(ip);
  if (!b || b.reset <= now) {
    b = { count: 0, reset: now + WINDOW_MS };
    buckets.set(ip, b);
  }
  b.count++;
  if (b.count > max) return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.reset - now) / 1000)) };
  return { ok: true };
}

export function rateLimitResponse(retryAfterSec: number): Response {
  return new Response(JSON.stringify({ error: 'Muitas consultas; tente de novo em instantes.' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': String(retryAfterSec),
    },
  });
}