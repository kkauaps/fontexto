// Cloudflare Pages Function: GET /api/oa/lookup?doi=... | ?title=...&year=...&author=...  (see src/core/openAccess.ts)
import { serveOa, type OaContext } from './_shared';

export const onRequestGet = (ctx: OaContext) => serveOa(ctx);
