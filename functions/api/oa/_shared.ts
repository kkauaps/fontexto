// Shared wiring for the /api/oa/* Pages Functions: optional API keys from the project env, edge cache.
import { edgeCache, handleOaRequest, type EdgeCacheStore, type OaEnv } from '../../../src/core/openAccess';
import { checkClientRateLimit, clientIpFromRequest, rateLimitResponse } from '../../../src/core/oaRateLimit';

export interface OaContext {
  request: Request;
  env?: OaEnv;
}

const oaOpts = (env: OaContext['env'], cache?: ReturnType<typeof edgeCache>) => ({
  env: { CORE_API_KEY: env?.CORE_API_KEY, S2_API_KEY: env?.S2_API_KEY, OPENALEX_API_KEY: env?.OPENALEX_API_KEY },
  cache,
});

export function serveOa({ request, env }: OaContext): Promise<Response> {
  const rl = checkClientRateLimit(clientIpFromRequest(request));
  if (!rl.ok) return Promise.resolve(rateLimitResponse(rl.retryAfterSec));
  const edgeStore = (globalThis as { caches?: { default?: EdgeCacheStore } }).caches?.default;
  const edge = edgeStore ? edgeCache(edgeStore) : undefined;
  return handleOaRequest(new URL(request.url), fetch, oaOpts(env, edge));
}

export function oaCacheFromContext(env: OaContext['env']) {
  const edgeStore = (globalThis as { caches?: { default?: EdgeCacheStore } }).caches?.default;
  return edgeStore ? edgeCache(edgeStore) : undefined;
}

export function guardOaRequest(request: Request): Response | undefined {
  const rl = checkClientRateLimit(clientIpFromRequest(request));
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);
  return undefined;
}

export { oaOpts };
