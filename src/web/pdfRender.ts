import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { findPhrase } from '../core/textsearch';

/**
 * The worker is started here (same-origin file only) through a Trusted Types policy, so the page can run under
 * `require-trusted-types-for 'script'`. pdf.js keeps running in a Web Worker and never evaluates PDF content as code.
 */
const trustedTypes = (window as unknown as { trustedTypes?: { createPolicy: (name: string, rules: { createScriptURL: (url: string) => string }) => { createScriptURL: (url: string) => unknown } } }).trustedTypes;
const workerPolicy = trustedTypes?.createPolicy('fontexto-pdfjs', {
  createScriptURL: (url: string) => {
    const u = new URL(url, window.location.href);
    if (u.origin !== window.location.origin) throw new TypeError('Worker bloqueado: origem diferente');
    return u.href;
  },
});
pdfjs.GlobalWorkerOptions.workerPort = new Worker((workerPolicy ? workerPolicy.createScriptURL(workerUrl) : workerUrl) as string, { type: 'module' });

export type PdfDoc = Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;

export function openPdf(url: string) {
  return pdfjs.getDocument({
    url,
    isEvalSupported: false,
    enableXfa: false,
    // Self-hosted decoders and fonts (copied to /pdfjs at build time); nothing is fetched from another origin.
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    wasmUrl: '/pdfjs/wasm/',
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    iccUrl: '/pdfjs/iccs/',
  } as Parameters<typeof pdfjs.getDocument>[0]);
}

export interface RenderedPage {
  width: number;
  height: number;
  /** PDF points -> CSS pixels. */
  scale: number;
  cancel: () => void;
  done: Promise<void>;
}

/**
 * Renders one page into a canvas and builds a selectable text layer over it.
 * `done` resolves when both layers are ready, and never rejects on cancel.
 */
export async function renderPage(doc: PdfDoc, pageNumber: number, scale: number, canvas: HTMLCanvasElement, textLayer: HTMLElement): Promise<RenderedPage> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  const renderTask = page.render({
    canvas,
    canvasContext: canvas.getContext('2d')!,
    viewport,
    transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
  } as Parameters<typeof page.render>[0]);
  textLayer.replaceChildren();
  textLayer.style.setProperty('--scale-factor', String(scale));
  textLayer.style.setProperty('--total-scale-factor', String(scale));
  const layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textLayer, viewport });
  // pdf.js sizes the layer with CSS round(); make sure it also works in older browsers.
  textLayer.style.width = `${viewport.width}px`;
  textLayer.style.height = `${viewport.height}px`;
  const done = Promise.all([renderTask.promise, layer.render()]).then(
    () => undefined,
    () => undefined,
  );
  return {
    width: viewport.width,
    height: viewport.height,
    scale,
    cancel: () => {
      renderTask.cancel();
      layer.cancel();
    },
    done,
  };
}

export interface BoxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Screen boxes (relative to `layer`) of `phrase` as laid out in the text layer.
 * Returns undefined when the phrase is not found; `exact` is false when only a
 * leading part of the phrase could be located.
 */
export function locatePhraseBoxes(layer: HTMLElement, phrase: string, nth = 0): { boxes: BoxRect[]; exact: boolean } | undefined {
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  const match = findPhrase(
    nodes.map((n) => n.data),
    phrase,
    { nth },
  );
  if (!match) return undefined;
  const range = document.createRange();
  range.setStart(nodes[match.start.seg], match.start.offset);
  range.setEnd(nodes[match.end.seg], match.end.offset);
  const origin = layer.getBoundingClientRect();
  const raw = [...range.getClientRects()]
    .filter((r) => r.width > 1 && r.height > 1)
    .map((r) => ({ left: r.left - origin.left, top: r.top - origin.top, width: r.width, height: r.height }));
  // merge boxes that sit on the same line to keep the overlay light
  const boxes: BoxRect[] = [];
  for (const r of raw.sort((a, b) => a.top - b.top || a.left - b.left)) {
    const last = boxes[boxes.length - 1];
    if (last && Math.abs(last.top - r.top) < last.height * 0.5 && r.left <= last.left + last.width + 4) {
      const right = Math.max(last.left + last.width, r.left + r.width);
      last.width = right - last.left;
      last.height = Math.max(last.height, r.height);
    } else boxes.push({ ...r });
  }
  return boxes.length ? { boxes, exact: match.exact } : undefined;
}
