import { describe, expect, it } from 'vitest';
import {
  documentNeedsOcr,
  emptyPageNumbers,
  imageAsPdfText,
  imageKind,
  isImageName,
  linesFromWords,
  mergeOcrPage,
  OCR_EMPTY_CHARS,
  OCR_MAX_PAGES,
  pageNeedsOcr,
  scaleToFit,
} from '../src/core/ocr';
import type { PdfText } from '../src/core/text';
import { lineRectsForPhrase } from '../src/core/anchors';
import { jpegToPdf } from '../src/web/local/imagePdf';

const page = (n: number, text: string, w = 595, h = 842) => ({
  page: n,
  width: w,
  height: h,
  lines: text ? [{ text, rect: { x: 50, y: 60, w: 400, h: 12 }, fontSize: 11 }] : [],
});

describe('image detection', () => {
  it('recognises names and magic bytes for PNG, JPEG and WebP', () => {
    expect(isImageName('scan.PNG')).toBe(true);
    expect(isImageName('foto.jpg')).toBe(true);
    expect(isImageName('paper.pdf')).toBe(false);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    const pdf = new TextEncoder().encode('%PDF-1.7');
    expect(imageKind(png)).toBe('png');
    expect(imageKind(jpg)).toBe('jpeg');
    expect(imageKind(webp)).toBe('webp');
    expect(imageKind(pdf)).toBeUndefined();
  });
});

describe('when OCR should run', () => {
  it('does not flag a normal text page or a document full of text', () => {
    const text: PdfText = { pageCount: 2, info: {}, pages: [page(1, 'A generous paragraph of extractable text about wounds.'), page(2, 'Another full page of body text that pdf.js can read.')] };
    expect(pageNeedsOcr(text.pages[0])).toBe(false);
    expect(documentNeedsOcr(text)).toBe(false);
    expect(emptyPageNumbers(text)).toEqual([]);
  });

  it('flags empty pages and caps how many are OCRed', () => {
    const pages = Array.from({ length: 50 }, (_, i) => page(i + 1, i === 0 ? 'A real text layer lives only on page one of this scan.' : ''));
    const text: PdfText = { pageCount: 50, info: {}, pages };
    expect(documentNeedsOcr(text)).toBe(true);
    expect(emptyPageNumbers(text)).toHaveLength(OCR_MAX_PAGES);
    expect(emptyPageNumbers(text)[0]).toBe(2);
    expect(pageNeedsOcr(page(3, '12'))).toBe(true);
    expect(OCR_EMPTY_CHARS).toBeGreaterThan(12);
  });
});

describe('geometry helpers', () => {
  it('never upscales and fits the long edge', () => {
    expect(scaleToFit(800, 600, 1600)).toBe(1);
    expect(scaleToFit(3200, 2400, 1600)).toBe(0.5);
  });

  it('builds a one-page PdfText from an image and merges OCR pages into a hybrid document', () => {
    const img = imageAsPdfText({ width: 800, height: 1000, lines: [{ text: 'hello', rect: { x: 10, y: 10, w: 40, h: 12 }, fontSize: 12 }] });
    expect(img.pageCount).toBe(1);
    expect(img.pages[0].lines[0].text).toBe('hello');
    const base: PdfText = { pageCount: 2, info: {}, pages: [page(1, 'Text layer'), page(2, '')] };
    const merged = mergeOcrPage(base, { page: 2, width: 595, height: 842, lines: [{ text: 'OCRed body', rect: { x: 1, y: 1, w: 40, h: 10 }, fontSize: 10 }] });
    expect(merged.pages[0].lines[0].text).toBe('Text layer');
    expect(merged.pages[1].lines[0].text).toBe('OCRed body');
  });

  it('groups Tesseract word boxes into lines', () => {
    const lines = linesFromWords(
      [
        { text: 'The', bbox: { x0: 10, y0: 10, x1: 40, y1: 24 } },
        { text: 'wound', bbox: { x0: 45, y0: 11, x1: 90, y1: 24 } },
        { text: 'Healed', bbox: { x0: 10, y0: 40, x1: 70, y1: 54 } },
      ],
      { width: 200, height: 80 },
    );
    expect(lines.map((l) => l.text)).toEqual(['The wound', 'Healed']);
    expect(lines[0].rect.x).toBe(10);
    expect(lines[0].rect.w).toBe(80);
  });
});

describe('jpegToPdf', () => {
  it('builds a one-page PDF that starts with a PDF header and embeds the JPEG', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 1, 2, 3, 4]);
    const pdf = jpegToPdf(jpeg, 200, 100);
    const txt = new TextDecoder('latin1').decode(pdf);
    expect(txt.startsWith('%PDF-1.4')).toBe(true);
    expect(txt).toContain('/MediaBox [0 0 200 100]');
    expect(txt).toContain('%%EOF');
    expect([...pdf]).toEqual(expect.arrayContaining([0xff, 0xd8, 0xff, 0xd9]));
  });
});

describe('lineRectsForPhrase', () => {
  it('returns the boxes of the lines that hold the phrase', () => {
    const page = {
      page: 1,
      width: 300,
      height: 400,
      lines: [
        { text: 'The application is left to present the result.', rect: { x: 10, y: 10, w: 200, h: 12 }, fontSize: 11 },
        { text: 'The set of images was composed of 393 photos.', rect: { x: 10, y: 40, w: 220, h: 12 }, fontSize: 11 },
      ],
    };
    const rects = lineRectsForPhrase(page, 'The set of images was composed of 393 photos.');
    expect(rects).toEqual([page.lines[1].rect]);
  });
});
