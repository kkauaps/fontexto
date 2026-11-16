// Shared wiring for the /api/oa/* Pages Functions: optional API keys from the project env, edge cache.
import { edgeCache, handleOaRequest, tieredCache, type EdgeCacheStore, type KvStore, type OaCache, type OaEnv } from '../../../src/core/openAccess';
import { checkClientRateLimit, clientIpFromRequest, rateLimitResponse } from '../../../src/core/oaRateLimit';

export interface OaContext {
  request: Request;
  /** OA_CACHE: optional KV namespace shared by every data centre (see wrangler.toml). */
  env?: OaEnv & { OA_CACHE?: KvStore };
}

const oaOpts = (env: OaContext['env'], cache?: ReturnType<typeof edgeCache>) => ({
  env: { CORE_API_KEY: env?.CORE_API_KEY, S2_API_KEY: env?.S2_API_KEY, OPENALEX_API_KEY: env?.OPENALEX_API_KEY },
  cache,
});

export function serveOa({ request, env }: OaContext): Promise<Response> {
  const rl = checkClientRateLimit(clientIpFromRequest(request));
  if (!rl.ok) return Promise.resolve(rateLimitResponse(rl.retryAfterSec));
  return handleOaRequest(new URL(request.url), fetch, oaOpts(env, oaCacheFromContext(env)));
}

/** Per-isolate memory -> per-colo Cache API -> global KV (when bound). */
export function oaCacheFromContext(env: OaContext['env']): OaCache | undefined {
  const edgeStore = (globalThis as { caches?: { default?: EdgeCacheStore } }).caches?.default;
  const edge = edgeStore ? edgeCache(edgeStore) : undefined;
  return edge ? tieredCache(edge, env?.OA_CACHE) : undefined;
}

export function guardOaRequest(request: Request): Response | undefined {
  const rl = checkClientRateLimit(clientIpFromRequest(request));
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);
  return undefined;
}

export { oaOpts };
