// Cloudflare Pages Function: POST /api/feedback — opt-in calibration totals (see src/core/feedback.ts).
// Reads only four values from the body; never IPs (beyond in-memory pacing), cookies or identifiers.
import { parseFeedback, recordFeedback } from '../../src/core/feedback';
import { checkClientRateLimit, clientIpFromRequest } from '../../src/core/oaRateLimit';
import type { KvLike } from '../../src/core/visitCounter';

interface PagesContext {
  request: Request;
  env?: { FEEDBACK?: KvLike };
  waitUntil?: (promise: Promise<unknown>) => void;
}

function allowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === 'fontexto.com' || host === 'www.fontexto.com' || host === 'fontexto.pages.dev' || host.endsWith('.fontexto.pages.dev') || host === 'localhost' || host === '127.0.0.1';
  } catch {
    return false;
  }
}

const empty = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store' } });

export const onRequestPost = async (ctx: PagesContext): Promise<Response> => {
  if (!allowedOrigin(ctx.request.headers.get('Origin'))) return empty(403);
  if (!checkClientRateLimit(clientIpFromRequest(ctx.request)).ok) return empty(429);
  if (Number(ctx.request.headers.get('content-length') ?? 0) > 512) return empty(413);
  let body: unknown;
  try {
    body = JSON.parse((await ctx.request.text()).slice(0, 512));
  } catch {
    return empty(400);
  }
  const sample = parseFeedback(body);
  if (!sample) return empty(400);
  const kv = ctx.env?.FEEDBACK;
  if (!kv) return empty(204);
  const write = recordFeedback(kv, sample).catch(() => undefined);
  if (ctx.waitUntil) ctx.waitUntil(write);
  else await write;
  return empty(204);
};
