// Cloudflare Pages Function: POST /api/oa/batch { queries: [{ doi?, title?, year?, author?, arxiv?, kind? }, ...] }
import { handleOaBatchRequest } from '../../../src/core/oaBatch';
import { guardOaRequest, oaCacheFromContext, oaOpts, type OaContext } from './_shared';

export const onRequestPost = async ({ request, env }: OaContext) => {
  const blocked = guardOaRequest(request);
  if (blocked) return blocked;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido.' }), { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
  return handleOaBatchRequest(body, fetch, oaOpts(env, oaCacheFromContext(env)));
};