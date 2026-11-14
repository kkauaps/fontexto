/**
 * Page / anchor integrity.
 *
 * An anchor is only trusted when its page exists in the file and, if it carries
 * text, that text occurs on that page. Highlight rectangles are kept only when
 * they lie inside the page; otherwise the viewer opens the page and tells the
 * user that an exact highlight is unavailable. Coordinates are never invented.
 */
import type { Anchor, FileRecord, Rect } from './model.js';
import { stripDiacritics } from './normalize.js';
import type { PdfText, PageText } from './text.js';
import { findPhrase } from './textsearch.js';

export interface AnchorCheck {
  valid: boolean;
  pageExists: boolean;
  /** undefined when the anchor has no text or page text is unavailable. */
  textFound?: boolean;
  rectsValid: boolean;
  problems: string[];
}

const squash = (s: string) =>
  stripDiacritics(s)
    .toLowerCase()
    .replace(/[‐-―-]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');

function rectInside(r: Rect, size: { width: number; height: number }) {
  const eps = 1;
  return (
    [r.x, r.y, r.w, r.h].every(Number.isFinite) &&
    r.w > 0 &&
    r.h > 0 &&
    r.x >= -eps &&
    r.y >= -eps &&
    r.x + r.w <= size.width + eps &&
    r.y + r.h <= size.height + eps
  );
}

export function checkAnchor(anchor: Anchor, file: Pick<FileRecord, 'id' | 'pageCount'> | undefined, text?: PdfText): AnchorCheck {
  const problems: string[] = [];
  if (!file) return { valid: false, pageExists: false, rectsValid: false, problems: ['file_missing'] };
  if (anchor.fileId !== file.id) problems.push('file_mismatch');
  const pageCount = file.pageCount ?? text?.pageCount;
  const pageExists = Number.isInteger(anchor.page) && anchor.page >= 1 && pageCount !== undefined && anchor.page <= pageCount;
  if (!pageExists) problems.push(pageCount === undefined ? 'page_count_unknown' : 'page_out_of_range');

  let textFound: boolean | undefined;
  const page = text?.pages.find((p) => p.page === anchor.page);
  if (anchor.text && page) {
    const hay = squash(page.lines.map((l) => l.text).join(' '));
    textFound = hay.includes(squash(anchor.text));
    if (!textFound) problems.push('text_not_on_page');
  }

  let rectsValid = false;
  if (anchor.rects && anchor.rects.length > 0) {
    const size = anchor.pageSize ?? (page ? { width: page.width, height: page.height } : undefined);
    rectsValid = Boolean(size) && anchor.rects.every((r) => rectInside(r, size!));
    if (!rectsValid) problems.push('rects_invalid');
  }
  return { valid: pageExists && problems.filter((p) => p !== 'rects_invalid').length === 0, pageExists, textFound, rectsValid, problems };
}

export type ViewerTarget =
  | {
      ok: true;
      fileId: string;
      page: number;
      highlights: Rect[];
      pageSize?: { width: number; height: number };
      exactHighlight: boolean;
      searchText?: string;
      notice?: string;
    }
  | { ok: false; reason: 'missing_pdf' | 'invalid_page' | 'file_mismatch'; message: string };

/**
 * Converts an anchor into what the PDF viewer should do. Falls back to
 * "open the page, no exact highlight" whenever the anchor is not fully trusted.
 */

/** Line boxes on a page that contain `phrase` (used when the pdf.js text layer is empty, e.g. OCR). */
export function lineRectsForPhrase(page: PageText, phrase: string): Rect[] {
  if (!phrase.trim() || page.lines.length === 0) return [];
  const m = findPhrase(page.lines.map((l) => l.text), phrase, { minWords: 1 });
  if (!m) return [];
  return page.lines.slice(m.start.seg, m.end.seg + 1).map((l) => l.rect);
}

export function viewerTarget(anchor: Anchor, file: Pick<FileRecord, 'id' | 'pageCount'> | undefined, text?: PdfText): ViewerTarget {
  if (!file) return { ok: false, reason: 'missing_pdf', message: 'O PDF desta fonte não está disponível.' };
  const check = checkAnchor(anchor, file, text);
  if (check.problems.includes('file_mismatch')) return { ok: false, reason: 'file_mismatch', message: 'A âncora não pertence a este arquivo.' };
  if (!check.pageExists) {
    return { ok: false, reason: 'invalid_page', message: `A página ${anchor.page} não existe neste PDF.` };
  }
  const page = text?.pages.find((pg) => pg.page === anchor.page);
  const fromText = (!anchor.rects || anchor.rects.length === 0) && check.textFound !== false && page && anchor.text ? lineRectsForPhrase(page, anchor.text) : [];
  const exact = (check.rectsValid || fromText.length > 0) && check.textFound !== false;
  const highlights = exact ? (check.rectsValid ? anchor.rects! : fromText) : [];
  return {
    ok: true,
    fileId: file.id,
    page: anchor.page,
    highlights,
    pageSize: anchor.pageSize ?? (page ? { width: page.width, height: page.height } : undefined),
    exactHighlight: exact,
    searchText: check.textFound === false ? undefined : anchor.text,
    notice: exact ? undefined : 'Destaque exato indisponível: abrindo apenas a página.',
  };
}
