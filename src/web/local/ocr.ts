/**
 * Lazy, same-origin Tesseract OCR. This module is dynamically imported only when
 * a page has no text layer or the file is an image. Ordinary text PDFs never load it.
 *
 * Traineddata (por+eng) and the wasm core are self-hosted under /tesseract/ so the
 * CSP (connect-src 'self') stays closed. Models are cached by tesseract.js after
 * the first run.
 */
import type { PdfDocLike, PdfJsLike } from '../../core/pdfjsText';
import { emptyPageNumbers, imageKind, linesFromWords, mergeOcrPage, OCR_LANGS, OCR_MAX_EDGE, scaleToFit, type ImageKind } from '../../core/ocr';
import type { PageText, PdfText, TextLine } from '../../core/text';
import { jpegToPdf } from './imagePdf';

export type OcrProgress = (p: { stage: 'ocr'; done: number; total: number; name?: string }) => void;

const origin = self.location.origin;
const tess = {
  workerPath: `${origin}/tesseract/worker.min.js`,
  corePath: `${origin}/tesseract/tesseract-core-simd-lstm.wasm.js`,
  langPath: `${origin}/tesseract/tessdata`,
};

type TessWorker = {
  recognize: (input: Blob | ImageBitmap, opts?: object) => Promise<{ data: { text: string; words: { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }[] } }>;
  terminate: () => Promise<void>;
};

let workerPromise: Promise<TessWorker> | undefined;

async function worker(onProgress?: OcrProgress, total?: number): Promise<TessWorker> {
  if (!workerPromise) {
    const { createWorker } = await import('tesseract.js');
    workerPromise = createWorker(OCR_LANGS, 1, {
      workerPath: tess.workerPath,
      corePath: tess.corePath,
      langPath: tess.langPath,
      cacheMethod: 'write',
      gzip: true,
      logger: (m: { status?: string; progress?: number }) => {
        if (m.status === 'recognizing text' && typeof m.progress === 'number' && total) {
          onProgress?.({ stage: 'ocr', done: Math.min(total - 1, Math.floor(m.progress * 1)), total, name: 'Tesseract' });
        }
      },
    }) as unknown as Promise<TessWorker>;
  }
  return workerPromise;
}

async function recognizeBitmap(image: Blob | ImageBitmap, pageSize: { width: number; height: number }): Promise<TextLine[]> {
  const w = await worker();
  const out = await w.recognize(image);
  return linesFromWords(out.data.words ?? [], pageSize);
}

async function renderPdfPage(pdfjs: PdfJsLike, doc: PdfDocLike, pageNumber: number): Promise<{ blob: Blob; width: number; height: number; scale: number }> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = scaleToFit(base.width, base.height, OCR_MAX_EDGE);
  const viewport = page.getViewport({ scale });
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(viewport.width)), Math.max(1, Math.round(viewport.height)));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas indisponível para OCR');
  const render = (page as unknown as { render: (o: object) => { promise: Promise<void> } }).render;
  await render({ canvasContext: ctx, viewport }).promise;
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return { blob, width: base.width, height: base.height, scale };
}

/** OCRs empty pages of a PDF already opened by pdf.js and merges the text back (rects in PDF points). */
export async function ocrEmptyPdfPages(pdfjs: PdfJsLike, doc: PdfDocLike, text: PdfText, onProgress?: OcrProgress): Promise<PdfText> {
  const pages = emptyPageNumbers(text);
  if (pages.length === 0) return text;
  await worker(onProgress, pages.length);
  let out = text;
  let done = 0;
  for (const n of pages) {
    onProgress?.({ stage: 'ocr', done, total: pages.length, name: `página ${n}` });
    const rendered = await renderPdfPage(pdfjs, doc, n);
    const raw = await recognizeBitmap(rendered.blob, { width: rendered.width * rendered.scale, height: rendered.height * rendered.scale });
    // Map OCR pixel boxes back to PDF points (top-left origin, same as pdfjsText).
    const lines: TextLine[] = raw.map((l) => ({
      ...l,
      rect: { x: l.rect.x / rendered.scale, y: l.rect.y / rendered.scale, w: l.rect.w / rendered.scale, h: l.rect.h / rendered.scale },
    }));
    const page: PageText = { page: n, width: rendered.width, height: rendered.height, lines };
    out = mergeOcrPage(out, page);
    done++;
    onProgress?.({ stage: 'ocr', done, total: pages.length, name: `página ${n}` });
  }
  return out;
}

async function toJpeg(data: Uint8Array, kind: ImageKind): Promise<{ jpeg: Uint8Array; width: number; height: number }> {
  const mime = kind === 'png' ? 'image/png' : kind === 'webp' ? 'image/webp' : 'image/jpeg';
  const blob = new Blob([data as unknown as BlobPart], { type: mime });
  const bmp = await createImageBitmap(blob);
  try {
    if (kind === 'jpeg') return { jpeg: data, width: bmp.width, height: bmp.height };
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas indisponível');
    ctx.drawImage(bmp, 0, 0);
    const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    return { jpeg: new Uint8Array(await out.arrayBuffer()), width: bmp.width, height: bmp.height };
  } finally {
    bmp.close();
  }
}

/** Turns a PNG/JPEG/WebP into a one-page PDF (for the viewer) and OCRs it. */
export async function imageToSearchablePdf(data: Uint8Array, kind: ImageKind, onProgress?: OcrProgress): Promise<{ pdf: Uint8Array; text: PdfText }> {
  onProgress?.({ stage: 'ocr', done: 0, total: 1, name: 'imagem' });
  const { jpeg, width, height } = await toJpeg(data, kind);
  const pdf = jpegToPdf(jpeg, width, height);
  await worker(onProgress, 1);
  const lines = await recognizeBitmap(new Blob([jpeg as unknown as BlobPart], { type: 'image/jpeg' }), { width, height });
  onProgress?.({ stage: 'ocr', done: 1, total: 1, name: 'imagem' });
  return { pdf, text: { pageCount: 1, info: {}, pages: [{ page: 1, width, height, lines }] } };
}

export { imageKind, jpegToPdf };
