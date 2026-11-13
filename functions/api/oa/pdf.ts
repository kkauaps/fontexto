// Cloudflare Pages Function: GET /api/oa/pdf?doi=... | ?title=...  -> the free PDF (streamed, checked, size-capped)
import { handleOaRequest } from '../../../src/core/openAccess';

export const onRequestGet = ({ request }: { request: Request }) => handleOaRequest(new URL(request.url));
