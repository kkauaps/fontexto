/**
 * Bridge to the optional "Fontexto — my access" browser extension (extension/ in this repository).
 *
 * The extension downloads a reference's PDF with the reader's own access: the university network, a library login,
 * a publisher session. The page can only ask for a DOI; the extension resolves it itself (doi.org -> publisher page ->
 * its PDF link, optionally through a library proxy configured in the extension), and only ever answers with a PDF
 * ("%PDF-"), never with a web page. Nothing goes through Fontexto's servers.
 */
import { useSyncExternalStore } from 'react';

const PAGE = 'fontexto-page';
const EXT = 'fontexto-ext';
/** Set by the extension's content script on <html> when it is installed. */
export const EXTENSION_ATTR = 'data-fontexto-ext';
/** The reserved source name of a PDF fetched with the reader's own access (shown translated). */
export const MY_ACCESS_SOURCE = '__my_access__';
const TIMEOUT_MS = 90_000;
const DOI_RE = /^10\.\d{4,9}\/\S+$/;

export function extensionAvailable(): boolean {
  return typeof document !== 'undefined' && document.documentElement.hasAttribute(EXTENSION_ATTR);
}

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: [EXTENSION_ATTR] });
  return () => obs.disconnect();
}

export function useExtensionAvailable(): boolean {
  return useSyncExternalStore(subscribe, extensionAvailable, () => false);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let seq = 0;

/** Asks the extension for the PDF of a DOI. Resolves undefined when it is not installed or could not get a PDF. */
export function fetchWithMyAccess(doi: string | undefined, fileName: string): Promise<File | undefined> {
  const clean = doi?.trim().toLowerCase();
  if (!clean || !DOI_RE.test(clean) || !extensionAvailable()) return Promise.resolve(undefined);
  const id = `${Date.now()}-${++seq}`;
  return new Promise((resolve) => {
    const done = (file?: File) => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(file);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const m = e.data as { source?: string; type?: string; id?: string; ok?: boolean; pdf?: string };
      if (m?.source !== EXT || m.type !== 'result' || m.id !== id) return;
      if (!m.ok || typeof m.pdf !== 'string') return done();
      const bytes = base64ToBytes(m.pdf);
      // the extension already checks this; the page checks again
      if (bytes.length < 5 || String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') return done();
      done(new File([bytes], fileName, { type: 'application/pdf' }));
    };
    const timer = setTimeout(() => done(), TIMEOUT_MS);
    window.addEventListener('message', onMessage);
    window.postMessage({ source: PAGE, type: 'fetch', id, doi: clean }, window.location.origin);
  });
}
