// Cloudflare Pages Function: GET /api/oa/lookup?doi=... | ?title=...&year=...&author=...  (see src/core/openAccess.ts)
import { handleOaRequest } from '../../../src/core/openAccess';

export const onRequestGet = ({ request }: { request: Request }) => handleOaRequest(new URL(request.url));
