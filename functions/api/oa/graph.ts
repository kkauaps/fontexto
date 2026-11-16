// Cloudflare Pages Function: POST /api/oa/graph {items:[{key, doi?, openalexId?, title?, year?, author?}]} (see src/core/openAlexGraph.ts)
// Every method lands here so a GET gets a 405 JSON answer instead of the SPA's index.html.
import { edgeCache, tieredCache, type EdgeCacheStore } from '../../../src/core/openAccess';
import { handleGraphRequest } from '../../../src/core/openAlexGraph';
import type { OaContext } from './_shared';

export const onRequest = ({ request, env }: OaContext) => {
  const edgeStore = (globalThis as { caches?: { default?: EdgeCacheStore } }).caches?.default;
  const cache = edgeStore ? tieredCache(edgeCache(edgeStore), env?.OA_CACHE, 'graph|') : undefined;
  return handleGraphRequest(request, fetch, { env: { OPENALEX_API_KEY: env?.OPENALEX_API_KEY }, cache });
};
