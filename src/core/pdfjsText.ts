/**
 * Turns an opened pdf.js document into `PdfText` (lines with their boxes in top-left PDF points).
 * Shared by the Node server (legacy pdf.js build) and the browser worker (standard build), so both editions
 * produce identical text and therefore identical matching.
 */
import type { PdfText, TextLine } from "./text.js";

interface RawItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

/** The slice of pdf.js used here (typed loosely so both pdf.js builds fit). */
export interface PdfJsLike {
  Util: { transform: (a: number[], b: number[]) => number[] };
}
export interface PdfDocLike {
  numPages: number;
  getMetadata: () => Promise<{ info?: unknown }>;
  getPage: (n: number) => Promise<{
    getViewport: (o: { scale: number }) => {
      transform: number[];
      width: number;
      height: number;
    };
    getTextContent: () => Promise<{ items: unknown[] }>;
    cleanup: () => void;
  }>;
}

export async function textFromDocument(
  pdfjs: PdfJsLike,
  doc: PdfDocLike,
): Promise<PdfText> {
  let info: PdfText["info"] = {};
  try {
    const meta = await doc.getMetadata();
    const i = (meta.info ?? {}) as Record<string, unknown>;
    const str = (v: unknown) =>
      typeof v === "string" && v.trim() ? v.trim() : undefined;
    info = {
      title: str(i.Title),
      author: str(i.Author),
      subject: str(i.Subject),
      keywords: str(i.Keywords),
    };
  } catch {
    /* metadata is optional */
  }
  const pages: PdfText["pages"] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const lines: TextLine[] = [];
    let cur:
      | {
          parts: { s: string; sup: boolean }[];
          x0: number;
          x1: number;
          top: number;
          bottom: number;
          base: number;
          size: number;
        }
      | undefined;
    const flush = () => {
      if (cur) {
        // join the parts collapsing whitespace, keeping the offsets of superscript runs (numeric citations "text³,⁵")
        let text = "";
        const sups: [number, number][] = [];
        for (const part of cur.parts) {
          let s = part.s.replace(/\s+/g, " ");
          if ((text === "" || text.endsWith(" ")) && s.startsWith(" ")) s = s.slice(1);
          if (!s) continue;
          if (part.sup) {
            const lead = s.length - s.trimStart().length;
            const core = s.trim();
            if (core) {
              const start = text.length + lead;
              const last = sups[sups.length - 1];
              if (last && last[1] === start) last[1] = start + core.length;
              else sups.push([start, start + core.length]);
            }
          }
          text += s;
        }
        const trimmed = text.trimEnd();
        if (trimmed)
          lines.push({
            ...(sups.length ? { sups: sups.filter(([a]) => a < trimmed.length).map(([a, b]) => [a, Math.min(b, trimmed.length)] as [number, number]) } : {}),
            text: trimmed,
            rect: {
              x: cur.x0,
              y: cur.top,
              w: Math.max(0.5, cur.x1 - cur.x0),
              h: Math.max(0.5, cur.bottom - cur.top),
            },
            fontSize: cur.size,
          });
      }
      cur = undefined;
    };
    for (const raw of content.items as RawItem[]) {
      if (typeof raw.str !== "string") continue;
      const t = pdfjs.Util.transform(viewport.transform, raw.transform);
      const size = Math.hypot(t[2], t[3]) || raw.height || 1;
      const x = t[4];
      const base = t[5];
      const w = raw.width;
      if (raw.str.length > 0) {
        // a small, raised run of digits right after the text is a superscript (numeric citation), not a new line
        const sup =
          !!cur &&
          /^[\d\s,;\u2013\u2212-]+$/.test(raw.str) &&
          /\d/.test(raw.str) &&
          size <= cur.size * 0.85 &&
          base < cur.base - cur.size * 0.12 &&
          base > cur.base - cur.size * 0.75 &&
          x >= cur.x1 - cur.size * 0.5 &&
          x <= cur.x1 + cur.size * 1.5;
        const newLine =
          !cur ||
          (!sup && Math.abs(base - cur.base) > size * 0.5) ||
          x < cur.x1 - size * 2;
        if (newLine) {
          flush();
          cur = {
            parts: [],
            x0: x,
            x1: x + w,
            top: base - size,
            bottom: base + size * 0.25,
            base,
            size,
          };
        } else if (cur) {
          const gap = x - cur.x1;
          const last = cur.parts[cur.parts.length - 1]?.s ?? "";
          if (gap > size * 0.15 && !/\s$/.test(last) && !/^\s/.test(raw.str))
            cur.parts.push({ s: " ", sup: false });
          cur.x0 = Math.min(cur.x0, x);
          cur.x1 = Math.max(cur.x1, x + w);
          cur.top = Math.min(cur.top, base - size);
          cur.bottom = Math.max(cur.bottom, base + size * 0.25);
          if (!sup) cur.size = Math.max(cur.size, size);
        }
        cur!.parts.push({ s: raw.str, sup });
      }
      if (raw.hasEOL) flush();
    }
    flush();
    pages.push({
      page: n,
      width: viewport.width,
      height: viewport.height,
      lines,
    });
    page.cleanup();
  }
  return { pageCount: doc.numPages, info, pages };
}
