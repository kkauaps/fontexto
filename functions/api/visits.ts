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

export const onRequestGet = async (ctx: PagesContext): Promise<Response> => {
  const kv = ctx.env?.VISITS;
  if (!kv) return new Response(JSON.stringify({ error: 'unavailable' }), { status: 503, headers: JSON_HEADERS });
  try {
    const visits = await sumWindow(kv);
    return new Response(JSON.stringify({ visits }), {
      status: 200,
      headers: {
        ...JSON_HEADERS,
        'cache-control': `public, max-age=${VISITS_CACHE_MAX_AGE_SEC}, s-maxage=${VISITS_CACHE_MAX_AGE_SEC}`,
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'unavailable' }), { status: 503, headers: JSON_HEADERS });
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
