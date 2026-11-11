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
import { textFromDocument, type PdfDocLike, type PdfJsLike } from '../core/pdfjsText.js';
import type { PdfText } from '../core/text.js';
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
    return await textFromDocument(pdfjs as unknown as PdfJsLike, doc as unknown as PdfDocLike);
  } finally {
    await task.destroy();
  }
}
