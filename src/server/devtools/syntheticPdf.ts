/**
 * Minimal PDF writer used for synthetic test fixtures and the demo project.
 * Produces valid PDF 1.4 files with Helvetica text (WinAnsi, ASCII-safe).
 * No real document content is ever embedded.
 */

export interface SyntheticLine {
  text: string;
  x?: number;
  /** Baseline y measured from the TOP of the page (points). */
  y: number;
  size?: number;
}

export interface SyntheticPage {
  lines: SyntheticLine[];
}

export interface SyntheticPdfOptions {
  title?: string;
  author?: string;
  width?: number;
  height?: number;
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[^\x20-\x7E]/g, '?');

export function makePdf(pages: SyntheticPage[], opts: SyntheticPdfOptions = {}): Buffer {
  const W = opts.width ?? 595;
  const H = opts.height ?? 842;
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = add('');
  const pagesId = add('');
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const infoParts: string[] = [];
  if (opts.title) infoParts.push(`/Title (${esc(opts.title)})`);
  if (opts.author) infoParts.push(`/Author (${esc(opts.author)})`);
  infoParts.push('/Producer (citation-tracer synthetic fixture)');
  const infoId = add(`<< ${infoParts.join(' ')} >>`);
  const pageIds: number[] = [];
  for (const page of pages) {
    const ops = page.lines
      .map((l) => `BT /F1 ${l.size ?? 10} Tf 1 0 0 1 ${l.x ?? 56} ${(H - l.y).toFixed(2)} Tm (${esc(l.text)}) Tj ET`)
      .join('\n');
    const contentId = add(`<< /Length ${Buffer.byteLength(ops, 'latin1')} >>\nstream\n${ops}\nendstream`);
    pageIds.push(
      add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`),
    );
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Lays out paragraphs top-to-bottom, wrapping long text, starting new pages as needed. */
export function flowText(blocks: { text: string; size?: number; indent?: number; gapBefore?: number }[], opts: { width?: number; height?: number } = {}): SyntheticPage[] {
  const H = opts.height ?? 842;
  const pages: SyntheticPage[] = [{ lines: [] }];
  let y = 72;
  for (const b of blocks) {
    const size = b.size ?? 10;
    const maxChars = Math.floor(((opts.width ?? 595) - 112) / (size * 0.5));
    y += b.gapBefore ?? 0;
    const words = b.text.split(/\s+/);
    let line = '';
    let first = true;
    const flush = () => {
      if (!line) return;
      if (y > H - 72) {
        pages.push({ lines: [] });
        y = 72;
      }
      pages[pages.length - 1].lines.push({ text: line, x: 56 + (first ? 0 : (b.indent ?? 0)), y, size });
      y += size * 1.4;
      line = '';
      first = false;
    };
    for (const w of words) {
      if ((line + ' ' + w).trim().length > maxChars) flush();
      line = (line ? line + ' ' : '') + w;
    }
    flush();
  }
  return pages;
}
