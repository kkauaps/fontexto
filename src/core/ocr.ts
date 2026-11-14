/**
 * Helpers for the in-browser OCR fallback (tesseract.js). Pure and unit-tested:
 * they decide *when* OCR should run and how its output is turned into `PdfText`.
 * The actual recogniser lives in `src/web/local/ocr.ts` and is lazy-loaded only
 * when a page or an image actually needs it. Ordinary text PDFs never import it.
 */
import type { PdfText, PageText, TextLine } from './text.js';

/** Hard cap so a 200-page scan does not freeze the tab. */
export const OCR_MAX_PAGES = 40;
/** Longest edge of the raster sent to Tesseract, in CSS pixels. */
export const OCR_MAX_EDGE = 1600;
/** A page with fewer extractable characters than this is treated as having no text layer. */
export const OCR_EMPTY_CHARS = 20;
export const OCR_LANGS = 'por+eng';

export type ImageKind = 'png' | 'jpeg' | 'webp';

export const isImageName = (name: string): boolean => /\.(png|jpe?g|webp)$/i.test(name);

export function imageKind(data: Uint8Array): ImageKind | undefined {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpeg';
  if (
    data.length >= 12 &&
    data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
    data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50
  )
    return 'webp';
  return undefined;
}

export const pageCharCount = (page: PageText): number => page.lines.reduce((n, l) => n + l.text.trim().length, 0);

export const pageNeedsOcr = (page: PageText): boolean => pageCharCount(page) < OCR_EMPTY_CHARS;

export function documentNeedsOcr(text: PdfText): boolean {
  if (text.pages.length === 0) return true;
  return text.pages.some(pageNeedsOcr);
}

/** 1-based physical page numbers that should be OCRed, in order, capped. */
export function emptyPageNumbers(text: PdfText, cap = OCR_MAX_PAGES): number[] {
  const out: number[] = [];
  for (const p of text.pages) {
    if (!pageNeedsOcr(p)) continue;
    out.push(p.page);
    if (out.length >= cap) break;
  }
  return out;
}

/** Scale that fits a box into a `maxEdge` square, never upscaling. */
export function scaleToFit(width: number, height: number, maxEdge = OCR_MAX_EDGE): number {
  const long = Math.max(width, height);
  if (long <= 0) return 1;
  return Math.min(1, maxEdge / long);
}

export function imageAsPdfText(page: Pick<PageText, 'width' | 'height' | 'lines'>, info: PdfText['info'] = {}): PdfText {
  return { pageCount: 1, info, pages: [{ page: 1, width: page.width, height: page.height, lines: page.lines }] };
}

/** Replaces (or appends) one physical page of OCR text, keeping other pages intact. */
export function mergeOcrPage(text: PdfText, page: PageText): PdfText {
  const pages = text.pages.filter((p) => p.page !== page.page);
  pages.push(page);
  pages.sort((a, b) => a.page - b.page);
  return { ...text, pageCount: Math.max(text.pageCount, page.page, pages.length), pages };
}

/** Lines from Tesseract word boxes (pixel space, top-left origin). */
export function linesFromWords(
  words: { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }[],
  pageSize: { width: number; height: number },
): TextLine[] {
  const usable = words.filter((w) => w.text.trim() && w.bbox.x1 > w.bbox.x0 && w.bbox.y1 > w.bbox.y0);
  if (usable.length === 0) return [];
  const heights = usable.map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 12;
  const lines: TextLine[] = [];
  const sorted = [...usable].sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  let cur: typeof usable = [];
  const flush = () => {
    if (!cur.length) return;
    const text = cur.map((w) => w.text.trim()).join(' ');
    const x = Math.min(...cur.map((w) => w.bbox.x0));
    const y = Math.min(...cur.map((w) => w.bbox.y0));
    const r = Math.max(...cur.map((w) => w.bbox.x1));
    const b = Math.max(...cur.map((w) => w.bbox.y1));
    lines.push({ text, rect: { x, y, w: r - x, h: b - y }, fontSize: Math.max(8, Math.round(b - y)) });
    cur = [];
  };
  for (const w of sorted) {
    if (cur.length) {
      const mid = (w.bbox.y0 + w.bbox.y1) / 2;
      const cMid = (Math.min(...cur.map((x) => x.bbox.y0)) + Math.max(...cur.map((x) => x.bbox.y1))) / 2;
      if (Math.abs(mid - cMid) > medianH * 0.6) flush();
    }
    cur.push(w);
  }
  flush();
  return lines;
}
