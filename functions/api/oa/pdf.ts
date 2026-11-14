// Cloudflare Pages Function: GET /api/oa/pdf?doi=... | ?title=...  -> the free PDF (streamed, checked, size-capped)
import { serveOa, type OaContext } from './_shared';

export const onRequestGet = (ctx: OaContext) => serveOa(ctx);
