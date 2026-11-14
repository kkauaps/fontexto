// Shared wiring for the /api/oa/* Pages Functions: optional API keys from the project env, edge cache.
import { edgeCache, handleOaRequest, type EdgeCacheStore, type OaEnv } from '../../../src/core/openAccess';

export interface OaContext {
  request: Request;
  env?: OaEnv;
}

export function serveOa({ request, env }: OaContext): Promise<Response> {
  const edgeStore = (globalThis as { caches?: { default?: EdgeCacheStore } }).caches?.default;
  const edge = edgeStore ? edgeCache(edgeStore) : undefined;
  return handleOaRequest(new URL(request.url), fetch, { env: { CORE_API_KEY: env?.CORE_API_KEY, S2_API_KEY: env?.S2_API_KEY, OPENALEX_API_KEY: env?.OPENALEX_API_KEY }, cache: edge });
}
