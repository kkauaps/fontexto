// Cloudflare Pages Function: GET /api/visits (30-day total, edge-cached ~5 min) and POST /api/visits (increment).
// Stores only anonymous daily totals. Does not read or write IPs, cookies, or identifiers.
import {
  incrementVisit,
  sumWindow,
  VISITS_CACHE_MAX_AGE_SEC,
  type KvLike,
} from '../../src/core/visitCounter';

interface Env {
  VISITS?: KvLike;
}

interface PagesContext {
  request: Request;
  env?: Env;
  waitUntil?: (promise: Promise<unknown>) => void;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function cacheControl(): string {
  return `public, max-age=${VISITS_CACHE_MAX_AGE_SEC}, s-maxage=${VISITS_CACHE_MAX_AGE_SEC}`;
}

function edgeCache(): Cache | undefined {
  return (globalThis as { caches?: { default?: Cache } }).caches?.default;
}

function visitsCacheKey(request: Request): Request {
  return new Request(new URL('/api/visits', request.url).toString(), { method: 'GET' });
}

function allowedOrigin(origin: string | null): boolean {
  if (!origin) return true;
  try {
    const host = new URL(origin).hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === 'fontexto.com' || host === 'www.fontexto.com' || host === 'fontexto.pages.dev') {
      return true;
    }
    return host.endsWith('.fontexto.pages.dev');
  } catch {
    return false;
  }
}

function json(body: unknown, status: number, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

export const onRequestGet = async (ctx: PagesContext): Promise<Response> => {
  const cache = edgeCache();
  const key = visitsCacheKey(ctx.request);
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  const kv = ctx.env?.VISITS;
  if (!kv) return json({ error: 'unavailable' }, 503);
  try {
    const visits = await sumWindow(kv);
    const res = json({ visits }, 200, { 'cache-control': cacheControl() });
    if (cache) {
      const put = cache.put(key, res.clone());
      if (ctx.waitUntil) ctx.waitUntil(put);
      else await put;
    }
    return res;
  } catch {
    return json({ error: 'unavailable' }, 503);
  }
};

export const onRequestPost = async (ctx: PagesContext): Promise<Response> => {
  if (!allowedOrigin(ctx.request.headers.get('Origin'))) {
    return new Response(null, { status: 403 });
  }
  const kv = ctx.env?.VISITS;
  if (!kv) return new Response(null, { status: 503 });
  try {
    await incrementVisit(kv);
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  } catch {
    return new Response(null, { status: 503 });
  }
};
