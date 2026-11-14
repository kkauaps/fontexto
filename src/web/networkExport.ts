/**
 * Shareable picture of the network: 1600×900 (X/Twitter's 16:9 card), always on the light theme, with a title,
 * the topic legend and a "fontexto.com" watermark. PNG through an offscreen canvas, SVG as markup.
 */
import type { NetEdge, NetNode } from '../core/network';
import { boundsOf, type LaidOut } from '../core/networkLayout';
import { canvasPainter, drawScene, fontOf, LIGHT_PALETTE, MARK_PATHS, svgPainter, type Painter } from './networkDraw';

export const EXPORT_W = 1600;
export const EXPORT_H = 900;

export interface ExportInput {
  nodes: NetNode[];
  edges: NetEdge[];
  pos: Map<string, LaidOut>;
  colorOf: (n: NetNode) => string;
  legend: { color: string; label: string; count: number }[];
  title: string;
  subtitle: string;
  edgeLegend: { cites: string; coupling: string; similar?: string };
  madeWith: string;
}

function compose(p: Painter, x: ExportInput, measure: (s: string, size: number, weight: number) => number) {
  const W = EXPORT_W;
  const H = EXPORT_H;
  const pal = LIGHT_PALETTE;
  p.rect(0, 0, W, H, '#F7F8FA', 0);
  // header
  const title = x.title.length > 80 ? `${x.title.slice(0, 79)}…` : x.title;
  p.text(56, 70, title, { size: 34, weight: 700, color: pal.text });
  p.text(56, 104, x.subtitle, { size: 20, weight: 500, color: pal.muted });
  // graph area
  const top = 132;
  const bottom = H - 120;
  const left = 56;
  const right = W - 56;
  const b = boundsOf(
    x.nodes.flatMap((n) => {
      const q = x.pos.get(n.id);
      return q ? [q] : [];
    }),
    28,
  );
  const bw = b.maxX - b.minX;
  const bh = b.maxY - b.minY;
  const k = Math.min((right - left) / bw, (bottom - top) / bh, 2.4);
  const tx = left + (right - left - bw * k) / 2 - b.minX * k;
  const ty = top + (bottom - top - bh * k) / 2 - b.minY * k;
  drawScene(p, x.nodes, x.edges, x.pos, { k, tx, ty, palette: pal, colorOf: x.colorOf, maxLabels: 22, labelSize: 15, measure, minR: 4, radiusScale: Math.max(1, 0.9 / k) });
  // legend (bottom-left): topics, then edge kinds
  let lx = 56;
  let ly = H - 74;
  let shown = 0;
  for (const item of x.legend) {
    const label = `${item.label.length > 34 ? `${item.label.slice(0, 33)}…` : item.label} (${item.count})`;
    const w = measure(label, 16, 550) + 30;
    if (lx + w > W - 420) ((lx = 56), (ly += 26));
    if (ly > H - 48) break;
    p.circle(lx + 7, ly - 5, 7, item.color, undefined, 0, 1);
    p.text(lx + 20, ly, label, { size: 16, weight: 550, color: pal.text });
    lx += w + 10;
    shown++;
  }
  if (shown < x.legend.length) p.text(lx, ly, `+${x.legend.length - shown}`, { size: 16, weight: 550, color: pal.muted });
  ly = H - 22;
  lx = 56;
  const edgeItems: [string, number[] | undefined][] = [
    [x.edgeLegend.cites, undefined],
    [x.edgeLegend.coupling, [5, 4]],
  ];
  if (x.edgeLegend.similar) edgeItems.push([x.edgeLegend.similar, [2, 4]]);
  for (const [label, dash] of edgeItems) {
    p.line(lx, ly - 5, lx + 26, ly - 5, dash ? pal.edge : pal.cites, dash ? 1.6 : 2, 0.9, dash);
    p.text(lx + 34, ly, label, { size: 15, weight: 500, color: pal.muted });
    lx += measure(label, 15, 500) + 58;
  }
  // watermark (bottom-right): mark + fontexto.com
  const word = 'fontexto.com';
  const ww = measure(word, 26, 700);
  const markH = 34;
  const scale = markH / 320;
  const mx = W - 56 - ww - 12 - 360 * scale;
  p.svgPath(MARK_PATHS.stem, { x: mx, y: H - 60, scale, stroke: '#065F46', strokeWidth: 26 });
  p.svgPath(MARK_PATHS.bar, { x: mx, y: H - 60, scale, fill: '#10B981' });
  p.text(W - 56, H - 34, word, { size: 26, weight: 700, color: '#065F46', align: 'right' });
  p.text(W - 56, H - 12, x.madeWith, { size: 14, weight: 500, color: pal.muted, align: 'right' });
}

function measurer() {
  const c = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
  return (s: string, size: number, weight: number) => {
    c.font = fontOf(size, weight);
    return c.measureText(s).width;
  };
}

export async function exportPng(x: ExportInput, pixelRatio = 1): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = EXPORT_W * pixelRatio;
  canvas.height = EXPORT_H * pixelRatio;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.scale(pixelRatio, pixelRatio);
  compose(canvasPainter(ctx), x, measurer());
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png'));
}

export function exportSvg(x: ExportInput): string {
  const p = svgPainter();
  compose(p, x, measurer());
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${EXPORT_W}" height="${EXPORT_H}" viewBox="0 0 ${EXPORT_W} ${EXPORT_H}">\n${p.markup()}\n</svg>\n`;
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
