/**
 * Synthetic monographs, theses and dissertations laid out like a word processor exports them: a cover, a table of
 * contents, chapters of prose, a bibliography that spans pages, appendices and annexes, running headers and footers
 * and page numbers. Every name, title, city and publisher is invented. No real document content.
 */
import type { PdfText, TextLine } from '../../src/core/text';

export type ListLayout =
  /** blank line between entries, continuation flush left (ABNT in Word) */
  | 'gap'
  /** no blank line, continuation indented (APA, Chicago) */
  | 'hanging'
  /** no blank line, no indent: only the text tells entries apart */
  | 'flush';

export interface MonographSpec {
  /** Pages of prose before the bibliography. */
  bodyPages: number;
  /** Table-of-contents lines (the bibliography heading usually appears here first). */
  toc: string[];
  /** Sections after the body, in order; `entries` are reference entries already wrapped into lines. */
  sections: { heading: string; entries?: string[][]; lines?: string[]; layout?: ListLayout }[];
  header?: string;
  footer?: string;
  /** Text of a body line; it may contain citations. */
  bodyLine?: (page: number, line: number) => string;
  /** Two text columns on the bibliography pages. */
  twoColumns?: boolean;
}

const W = 595;
const H = 842;
const TOP = 90;
const BOTTOM = 760;
const PITCH = 14;
const LH = 11;

export function buildMonograph(spec: MonographSpec): PdfText {
  const pages: { lines: TextLine[] }[] = [];
  let page: { lines: TextLine[] } = { lines: [] };
  let y = TOP;
  let col = 0;
  const colX = (c: number) => (spec.twoColumns ? (c === 0 ? 56 : 310) : 56);
  const colW = spec.twoColumns ? 230 : 480;
  const newPage = () => {
    pages.push(page);
    page = { lines: [] };
    y = TOP;
    col = 0;
  };
  const advance = (dy: number, columns: boolean) => {
    y += dy;
    if (y > BOTTOM) {
      if (columns && spec.twoColumns && col === 0) {
        col = 1;
        y = TOP;
      } else newPage();
    }
  };
  const put = (text: string, x: number, w = Math.min(colW, text.length * 5.2), size = 11) => {
    page.lines.push({ text, rect: { x, y, w, h: LH }, fontSize: size });
  };

  // cover + table of contents
  put('UNIVERSIDADE FICTÍCIA DO EXEMPLO', 150, 300, 14);
  advance(PITCH * 3, false);
  put('Trabalho de exemplo sobre lattices imaginárias', 120, 360, 16);
  newPage();
  put('SUMÁRIO', 250, 80, 14);
  advance(PITCH * 2, false);
  for (const t of spec.toc) {
    put(t, 56, 480);
    advance(PITCH * 1.5, false);
  }
  newPage();
  for (let p = 0; p < spec.bodyPages; p++) {
    for (let i = 0; i < 44; i++) {
      put(spec.bodyLine?.(p, i) ?? `Texto corrido inventado da página ${p + 1}, linha ${i + 1}, sobre redes sintéticas e dados fictícios.`, 56, 480);
      advance(PITCH, false);
    }
    newPage();
  }
  for (const sec of spec.sections) {
    if (page.lines.length) newPage();
    put(sec.heading, 56, Math.min(480, sec.heading.length * 7), 12);
    advance(PITCH * 2.5, true);
    for (const l of sec.lines ?? []) {
      put(l, colX(col));
      advance(PITCH, true);
    }
    const layout = sec.layout ?? 'gap';
    for (const entry of sec.entries ?? []) {
      // keep the entry together only for one-line entries; longer ones may break across pages and columns
      entry.forEach((text, i) => {
        const x = colX(col) + (layout === 'hanging' && i > 0 ? 18 : 0);
        // justified text: every line but the last of an entry runs to the margin
        const w = i < entry.length - 1 ? colW - (x - colX(col)) : Math.min(colW, text.length * 5.2);
        put(text, x, w);
        advance(PITCH, true);
      });
      if (layout === 'gap') advance(PITCH, true);
    }
  }
  if (page.lines.length) pages.push(page);

  return {
    pageCount: pages.length,
    info: {},
    pages: pages.map((p, i) => {
      const lines = [...p.lines];
      if (i > 0 && spec.header) lines.unshift({ text: spec.header, rect: { x: 150, y: 30, w: 300, h: 9 }, fontSize: 8 });
      if (i > 0 && spec.footer) lines.push({ text: spec.footer, rect: { x: 150, y: 800, w: 300, h: 9 }, fontSize: 8 });
      if (i > 0) lines.push({ text: String(i + 1), rect: { x: 520, y: 30, w: 12, h: 9 }, fontSize: 8 });
      return { page: i + 1, width: W, height: H, lines };
    }),
  };
}

/** Wraps an entry into lines of at most `width` characters, as a word processor would. */
export function wrap(text: string, width = 88): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of text.split(/\s+/)) {
    if (cur && (cur + ' ' + w).length > width) {
      out.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(cur);
  return out;
}

/** CJK text has no spaces: wrap by characters. */
export function wrapChars(text: string, width = 40): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += width) out.push(text.slice(i, i + width));
  return out;
}
