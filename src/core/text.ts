/**
 * Extracted PDF text, independent of the extraction library.
 * Produced by `src/server/pdfText.ts` (pdf.js) and cached per file hash.
 */
import type { Rect } from './model.js';

export interface TextLine {
  text: string;
  /** Bounding box in PDF points, top-left origin, as reported by the extractor. */
  rect: Rect;
  /** Dominant font size, used to detect headings. */
  fontSize: number;
  /** [start, end) offsets in `text` of superscript digit runs (numeric citations such as "wounds³,⁵"). */
  sups?: [number, number][];
}

export interface PageText {
  /** 1-based physical page index. */
  page: number;
  width: number;
  height: number;
  lines: TextLine[];
}

export interface PdfText {
  pageCount: number;
  info: { title?: string; author?: string; subject?: string; keywords?: string };
  pages: PageText[];
}

export const pageString = (p: PageText) => p.lines.map((l) => l.text).join('\n');

/** Joins lines, merging hyphenated breaks and DOIs split across lines. */
export function joinLines(lines: string[]): string {
  let out = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!out) {
      out = line;
      continue;
    }
    const tail = out.slice(out.lastIndexOf(' ') + 1);
    const doiBreak = /10\.\d{4,9}\/\S*[./_-]$/.test(tail) || /^(?:https?:\/\/)?(?:dx\.)?doi\.org\/$/i.test(tail);
    // a DOI that ends the line with "." is usually finished: keep the space unless the next line goes on in
    // lower case or digits ("…819861. Revista", "…2717. S. SILVA")
    // a URL broken across lines ("…/empresa_exp" + "ortadora_03.html", "…/setor-" + "farmaceutico.jhtml"): glue it
    // back, keeping its hyphen
    const firstTok = line.split(/\s/, 1)[0];
    const urlBreak =
      /^(?:<?https?:\/\/|<?www\.)\S*[^\s.,;>)]$/i.test(tail) &&
      /^[\p{Ll}\d_~%/.\-]/u.test(line) &&
      (/[/_\-=?&#%.]$/.test(tail) || /[/_=?&#%.\d]/.test(firstTok));
    if (urlBreak) out += line;
    else if (doiBreak && !(/\.$/.test(tail) && !/^[\p{Ll}\d]/u.test(line))) out += line;
    else if (/\p{Ll}-$/u.test(out) && /^\p{Ll}/u.test(line)) out = out.slice(0, -1) + line;
    else if (/\p{L}-$/u.test(out) && /^\p{Lu}/u.test(line)) out += line; // "Maier-" + "Hein"
    else out += ' ' + line;
  }
  return out;
}
