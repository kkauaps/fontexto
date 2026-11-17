// Downloads the PDF of a DOI with the reader's own access (their cookies, their network, their library proxy).
//
// Safety rules:
// - Requests are accepted only from Fontexto's pages (sender origin below) and only carry a DOI, never a URL.
// - The DOI is resolved by doi.org (or through the library proxy the reader typed in this extension's popup);
//   from the publisher's page only the PDF link it declares is followed (citation_pdf_url and similar).
// - Only a real PDF ("%PDF-", up to 40 MB) is ever returned to the page. Web pages are never returned.

const ALLOWED_ORIGINS = new Set([
  'https://fontexto.com',
  'https://www.fontexto.com',
  'https://fontexto.pages.dev',
]);
// local development of Fontexto only (vite 5173, API 5174, wrangler pages dev 8788), never any other local server
const DEV_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1):(?:5173|5174|8788)$/;
const PREVIEW_ORIGIN = /^https:\/\/[a-z0-9-]+\.fontexto\.pages\.dev$/;
const DOI_RE = /^10\.\d{4,9}\/\S+$/;
const MAX_BYTES = 40 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const MAX_HOPS = 2;

function originAllowed(sender) {
  const origin = sender.origin || (sender.url ? new URL(sender.url).origin : '');
  return ALLOWED_ORIGINS.has(origin) || DEV_ORIGIN.test(origin) || PREVIEW_ORIGIN.test(origin);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'fetch' || !sender.tab || !originAllowed(sender)) return false;
  pdfForDoi(String(msg.doi || '')).then(
    (pdf) => sendResponse(pdf ? { ok: true, pdf: toBase64(pdf) } : { ok: false }),
    () => sendResponse({ ok: false }),
  );
  return true; // async response
});

/** Library proxy link for a URL, same convention as the site: "{url}" / "{doi}" placeholders, else appended. */
function withLibrary(prefix, url, doi) {
  if (prefix.includes('{url}') || prefix.includes('{doi}')) return prefix.replace(/\{url\}/g, encodeURIComponent(url)).replace(/\{doi\}/g, doi);
  return prefix + url;
}

async function pdfForDoi(doi) {
  const clean = doi.trim().toLowerCase();
  if (!DOI_RE.test(clean)) return undefined;
  const { libraryPrefix, resolver } = await chrome.storage.sync.get(['libraryPrefix', 'resolver']);
  // "resolver" exists for automated tests only; it is not exposed in the popup
  const landing = `${resolver || 'https://doi.org/'}${clean}`;
  const targets = [landing];
  if (libraryPrefix) targets.unshift(withLibrary(libraryPrefix, landing, clean));
  for (const url of targets) {
    const pdf = await tryUrl(url, 0).catch(() => undefined);
    if (pdf) return pdf;
  }
  return undefined;
}

async function tryUrl(url, hop) {
  if (!/^https?:\/\//i.test(url)) return undefined;
  const res = await fetch(url, {
    credentials: 'include',
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: 'application/pdf,text/html;q=0.9,*/*;q=0.5' },
  });
  if (!res.ok) return undefined;
  const type = (res.headers.get('content-type') || '').toLowerCase();
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) return undefined;
  if (type.includes('pdf') || type.includes('octet-stream')) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    return bytes.length <= MAX_BYTES && isPdf(bytes) ? bytes : undefined;
  }
  if (hop >= MAX_HOPS || !type.includes('html')) return undefined;
  const html = (await res.text()).slice(0, 3_000_000);
  for (const link of pdfLinks(html, res.url).slice(0, 3)) {
    const pdf = await tryUrl(link, hop + 1).catch(() => undefined);
    if (pdf) return pdf;
  }
  return undefined;
}

function isPdf(bytes) {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

/** PDF links a publisher page declares for itself (Highwire/Google Scholar tags, link rel=alternate). */
function pdfLinks(html, base) {
  const out = [];
  const add = (raw) => {
    if (!raw) return;
    try {
      const u = new URL(raw.replace(/&amp;/g, '&'), base).toString();
      if (/^https?:/i.test(u) && !out.includes(u)) out.push(u);
    } catch {
      /* not a URL */
    }
  };
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    if (/\bname\s*=\s*["']?(?:citation_pdf_url|eprints\.document_url|bepress_citation_pdf_url)["']?/i.test(tag)) add((/\bcontent\s*=\s*["']([^"']+)["']/i.exec(tag) || [])[1]);
  }
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    if (/\btype\s*=\s*["']application\/pdf["']/i.test(tag)) add((/\bhref\s*=\s*["']([^"']+)["']/i.exec(tag) || [])[1]);
  }
  return out;
}

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
