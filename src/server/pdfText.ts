/**
 * Local PDF text extraction with pdf.js (no network, no external service).
 * Produces lines with their bounding boxes as reported by pdf.js, converted to
 * top-left page coordinates in PDF points.
 *
 * Paths to the pdf.js module, worker, standard fonts and WASM can be set with
 * `configurePdfJs` so the packaged Windows executable can load them from the
 * `resources/pdfjs` folder next to the exe.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import type { PdfText, TextLine } from '../core/text.js';
import { toPdfJsFactoryUrl } from './pdfPaths.js';

export interface PdfJsPaths {
  /** File URL or package specifier of the pdf.js API module. */
  moduleUrl: string;
  /** File URL of pdf.worker.mjs. */
  workerSrc: string;
  /** Directory of standard fonts. Normalised with toPdfJsFactoryUrl (pdf.js needs a trailing "/"). */
  standardFontDataUrl: string;
  /** Directory of pdf.js WASM files. Normalised with toPdfJsFactoryUrl. */
  wasmUrl?: string;
}

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsPromise: Promise<PdfJs> | undefined;
let configured: PdfJsPaths | undefined;

export function configurePdfJs(paths: PdfJsPaths): void {
  configured = {
    ...paths,
    standardFontDataUrl: toPdfJsFactoryUrl(paths.standardFontDataUrl),
    ...(paths.wasmUrl ? { wasmUrl: toPdfJsFactoryUrl(paths.wasmUrl) } : {}),
  };
  pdfjsPromise = undefined;
}

/** Restores the default (unpackaged) pdf.js resolution. Used by tests. */
export function resetPdfJsConfig(): void {
  configured = undefined;
  pdfjsPromise = undefined;
}

async function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const moduleUrl = configured?.moduleUrl ?? 'pdfjs-dist/legacy/build/pdf.mjs';
      const lib = (await import(moduleUrl)) as PdfJs;
      if (configured?.workerSrc) {
        lib.GlobalWorkerOptions.workerSrc = configured.workerSrc;
      } else {
        const require = createRequire(import.meta.url);
        lib.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
      }
      return lib;
    })();
  }
  return pdfjsPromise;
}

function pdfjsPackageDir(): string {
  const require = createRequire(import.meta.url);
  return path.dirname(require.resolve('pdfjs-dist/package.json'));
}

function standardFontDataUrl(): string {
  if (configured?.standardFontDataUrl) return configured.standardFontDataUrl;
  return toPdfJsFactoryUrl(path.join(pdfjsPackageDir(), 'standard_fonts'));
}

function wasmUrl(): string | undefined {
  if (configured) return configured.wasmUrl;
  const dir = path.join(pdfjsPackageDir(), 'wasm');
  return existsSync(dir) ? toPdfJsFactoryUrl(dir) : undefined;
}

interface RawItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

export async function extractPdfText(data: Uint8Array): Promise<PdfText> {
  const pdfjs = await loadPdfJs();
  const fontsDir = standardFontDataUrl();
  const wasmDir = wasmUrl();
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    verbosity: 0,
    useSystemFonts: false,
    standardFontDataUrl: fontsDir,
    disableFontFace: true,
    ...(wasmDir ? { wasmUrl: wasmDir } : {}),
  });
  const doc = await task.promise;
  try {
    let info: PdfText['info'] = {};
    try {
      const meta = await doc.getMetadata();
      const i = (meta.info ?? {}) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
      info = { title: str(i.Title), author: str(i.Author), subject: str(i.Subject), keywords: str(i.Keywords) };
    } catch {
      /* metadata is optional */
    }
    const pages: PdfText['pages'] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const lines: TextLine[] = [];
      let cur: { parts: string[]; x0: number; x1: number; top: number; bottom: number; base: number; size: number } | undefined;
      const flush = () => {
        if (cur) {
          const text = cur.parts.join('').replace(/\s+/g, ' ').trim();
          if (text) lines.push({ text, rect: { x: cur.x0, y: cur.top, w: Math.max(0.5, cur.x1 - cur.x0), h: Math.max(0.5, cur.bottom - cur.top) }, fontSize: cur.size });
        }
        cur = undefined;
      };
      for (const raw of content.items as RawItem[]) {
        if (typeof raw.str !== 'string') continue;
        const t = pdfjs.Util.transform(viewport.transform, raw.transform);
        const size = Math.hypot(t[2], t[3]) || raw.height || 1;
        const x = t[4];
        const base = t[5];
        const w = raw.width;
        if (raw.str.length > 0) {
          const newLine = !cur || Math.abs(base - cur.base) > size * 0.5 || x < cur.x1 - size * 2;
          if (newLine) {
            flush();
            cur = { parts: [], x0: x, x1: x + w, top: base - size, bottom: base + size * 0.25, base, size };
          } else if (cur) {
            const gap = x - cur.x1;
            const last = cur.parts[cur.parts.length - 1] ?? '';
            if (gap > size * 0.15 && !/\s$/.test(last) && !/^\s/.test(raw.str)) cur.parts.push(' ');
            cur.x0 = Math.min(cur.x0, x);
            cur.x1 = Math.max(cur.x1, x + w);
            cur.top = Math.min(cur.top, base - size);
            cur.bottom = Math.max(cur.bottom, base + size * 0.25);
            cur.size = Math.max(cur.size, size);
          }
          cur!.parts.push(raw.str);
        }
        if (raw.hasEOL) flush();
      }
      flush();
      pages.push({ page: n, width: viewport.width, height: viewport.height, lines });
      page.cleanup();
    }
    return { pageCount: doc.numPages, info, pages };
  } finally {
    await task.destroy();
  }
}
