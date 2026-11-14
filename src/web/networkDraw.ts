/**
 * One drawing routine for the network view, painted either on the live canvas or into an export (PNG via an
 * offscreen canvas, SVG as markup). Keeping a single routine means the exported image is exactly what is on screen.
 */
import { shortLabel, type NetEdge, type NetNode } from '../core/network';
import type { LaidOut } from '../core/networkLayout';

export interface Painter {
  line(x1: number, y1: number, x2: number, y2: number, stroke: string, width: number, alpha: number, dash?: number[]): void;
  poly(points: [number, number][], fill: string, alpha: number): void;
  circle(x: number, y: number, r: number, fill: string, stroke: string | undefined, strokeWidth: number, alpha: number): void;
  rect(x: number, y: number, w: number, h: number, fill: string, radius: number, alpha?: number, stroke?: string): void;
  text(x: number, y: number, s: string, o: { size: number; weight?: number; color: string; align?: 'left' | 'center' | 'right'; halo?: string; alpha?: number }): void;
  svgPath(d: string, o: { x: number; y: number; scale: number; fill?: string; stroke?: string; strokeWidth?: number }): void;
}

export interface Palette {
  text: string;
  muted: string;
  halo: string;
  edge: string;
  cites: string;
  docFill: string;
  docText: string;
  accent: string;
  ring: string;
}

export const LIGHT_PALETTE: Palette = { text: '#1c2026', muted: '#5b6472', halo: '#ffffff', edge: '#7b8494', cites: '#3c4657', docFill: '#065F46', docText: '#ffffff', accent: '#10B981', ring: '#ffffff' };

export interface SceneOpts {
  k: number;
  tx: number;
  ty: number;
  palette: Palette;
  colorOf: (n: NetNode) => string;
  /** Nodes to keep bright (hover neighbourhood or selection); everything else is dimmed. */
  focus?: Set<string>;
  hover?: string;
  selected?: string;
  matches?: Set<string>;
  maxLabels: number;
  labelSize: number;
  measure: (s: string, size: number, weight: number) => number;
  /** Minimum on-screen radius. */
  minR?: number;
  radiusScale?: number;
}

const FONT = 'Inter, "Segoe UI", system-ui, -apple-system, sans-serif';
export const fontOf = (size: number, weight = 500) => `${weight} ${size}px ${FONT}`;

export function drawScene(p: Painter, nodes: NetNode[], edges: NetEdge[], pos: Map<string, LaidOut>, o: SceneOpts) {
  const S = (x: number, y: number): [number, number] => [x * o.k + o.tx, y * o.k + o.ty];
  const R = (r: number) => Math.max(o.minR ?? 2.5, r * o.k * (o.radiusScale ?? 1));
  const visible = new Set(nodes.map((n) => n.id));
  const bright = (id: string) => !o.focus || o.focus.has(id);
  const order: NetEdge['kind'][] = ['doc', 'similar', 'coupling', 'cites'];
  for (const kind of order) {
    for (const e of edges) {
      if (e.kind !== kind || !visible.has(e.source) || !visible.has(e.target)) continue;
      const a = pos.get(e.source);
      const b = pos.get(e.target);
      if (!a || !b) continue;
      const on = !o.focus || (o.focus.has(e.source) && o.focus.has(e.target) && (e.source === o.hover || e.target === o.hover || e.source === o.selected || e.target === o.selected || !o.hover));
      const [x1, y1] = S(a.x, a.y);
      const [x2, y2] = S(b.x, b.y);
      const w = kind === 'cites' ? 1.4 : kind === 'coupling' ? Math.min(3, 0.6 + 0.35 * e.weight) : kind === 'similar' ? 1 : 0.8;
      const alpha = o.focus ? (on ? 0.9 : 0.05) : kind === 'doc' ? 0.16 : kind === 'cites' ? 0.7 : kind === 'coupling' ? 0.42 : 0.35;
      const color = kind === 'cites' ? o.palette.cites : o.palette.edge;
      p.line(x1, y1, x2, y2, color, w, alpha, kind === 'similar' ? [2, 4] : kind === 'coupling' ? [5, 4] : undefined);
      if (kind === 'cites') {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const rb = R(b.r) + 1.5;
        const tipX = x2 - ux * rb;
        const tipY = y2 - uy * rb;
        const s = 6;
        p.poly(
          [
            [tipX, tipY],
            [tipX - ux * s - uy * s * 0.55, tipY - uy * s + ux * s * 0.55],
            [tipX - ux * s + uy * s * 0.55, tipY - uy * s - ux * s * 0.55],
          ],
          color,
          alpha,
        );
      }
    }
  }
  // nodes: small first so big hubs stay on top
  const sorted = [...nodes].sort((a, b) => (pos.get(a.id)?.r ?? 0) - (pos.get(b.id)?.r ?? 0));
  for (const n of sorted) {
    const q = pos.get(n.id);
    if (!q) continue;
    const [x, y] = S(q.x, q.y);
    const r = R(q.r);
    const alpha = bright(n.id) ? 1 : 0.18;
    if (n.kind === 'document') {
      p.circle(x, y, r + 3, o.palette.docFill, o.palette.ring, 2, alpha);
      continue;
    }
    p.circle(x, y, r, o.colorOf(n), o.palette.ring, 1.2, alpha);
    if (o.matches?.has(n.id)) p.circle(x, y, r + 3.5, 'none', o.palette.accent, 2.2, 1);
    if (n.id === o.selected || n.id === o.hover) p.circle(x, y, r + 3, 'none', o.palette.text, 2, 1);
  }
  // labels: forced ones first, then the most important, skipping any that would overlap
  const forced = (n: NetNode) => n.id === o.hover || n.id === o.selected || o.matches?.has(n.id) || n.kind === 'document' || (o.focus && o.hover && o.focus.has(n.id));
  const cands = nodes
    .filter((n) => pos.has(n.id) && bright(n.id))
    .sort((a, b) => Number(Boolean(forced(b))) - Number(Boolean(forced(a))) || b.importance - a.importance);
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  let count = 0;
  for (const n of cands) {
    const must = forced(n);
    if (!must && count >= o.maxLabels) break;
    const q = pos.get(n.id) as LaidOut;
    const [x, y] = S(q.x, q.y);
    const r = R(q.r) + (n.kind === 'document' ? 3 : 0);
    const size = n.kind === 'document' ? o.labelSize + 1 : o.labelSize;
    const weight = n.kind === 'document' || must ? 650 : 550;
    const s = shortLabel(n.label, n.kind === 'document' ? 42 : 26);
    const w = o.measure(s, size, weight);
    const box = { x: x - w / 2 - 2, y: y + r + 2, w: w + 4, h: size + 3 };
    if (!must && placed.some((b) => box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y)) continue;
    placed.push(box);
    count++;
    p.text(x, y + r + size + 1, s, { size, weight, color: o.palette.text, align: 'center', halo: o.palette.halo });
  }
}

export function canvasPainter(ctx: CanvasRenderingContext2D): Painter {
  return {
    line(x1, y1, x2, y2, stroke, width, alpha, dash) {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.setLineDash(dash ?? []);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    },
    poly(points, fill, alpha) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = fill;
      ctx.beginPath();
      points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    },
    circle(x, y, r, fill, stroke, sw, alpha) {
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      if (fill !== 'none') ((ctx.fillStyle = fill), ctx.fill());
      if (stroke) ((ctx.strokeStyle = stroke), (ctx.lineWidth = sw), ctx.stroke());
      ctx.globalAlpha = 1;
    },
    rect(x, y, w, h, fill, radius, alpha = 1, stroke) {
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radius);
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) ((ctx.strokeStyle = stroke), (ctx.lineWidth = 1), ctx.stroke());
      ctx.globalAlpha = 1;
    },
    text(x, y, s, t) {
      ctx.globalAlpha = t.alpha ?? 1;
      ctx.font = fontOf(t.size, t.weight);
      ctx.textAlign = t.align ?? 'left';
      ctx.textBaseline = 'alphabetic';
      if (t.halo) {
        ctx.strokeStyle = t.halo;
        ctx.lineWidth = 3.5;
        ctx.lineJoin = 'round';
        ctx.strokeText(s, x, y);
      }
      ctx.fillStyle = t.color;
      ctx.fillText(s, x, y);
      ctx.globalAlpha = 1;
    },
    svgPath(d, t) {
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(t.scale, t.scale);
      const path = new Path2D(d);
      if (t.fill) ((ctx.fillStyle = t.fill), ctx.fill(path));
      if (t.stroke) {
        ctx.strokeStyle = t.stroke;
        ctx.lineWidth = t.strokeWidth ?? 1;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke(path);
      }
      ctx.restore();
    },
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = (n: number) => Math.round(n * 10) / 10;

export function svgPainter(): Painter & { markup(): string } {
  const out: string[] = [];
  return {
    markup: () => out.join('\n'),
    line(x1, y1, x2, y2, stroke, width, alpha, dash) {
      out.push(`<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${stroke}" stroke-width="${width}" stroke-opacity="${alpha}"${dash ? ` stroke-dasharray="${dash.join(' ')}"` : ''}/>`);
    },
    poly(points, fill, alpha) {
      out.push(`<polygon points="${points.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')}" fill="${fill}" fill-opacity="${alpha}"/>`);
    },
    circle(x, y, r, fill, stroke, sw, alpha) {
      out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${fill}" opacity="${alpha}"${stroke ? ` stroke="${stroke}" stroke-width="${sw}"` : ''}/>`);
    },
    rect(x, y, w, h, fill, radius, alpha = 1, stroke) {
      out.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${radius}" fill="${fill}" opacity="${alpha}"${stroke ? ` stroke="${stroke}"` : ''}/>`);
    },
    text(x, y, s, t) {
      const anchor = t.align === 'center' ? 'middle' : t.align === 'right' ? 'end' : 'start';
      const halo = t.halo ? ` stroke="${t.halo}" stroke-width="3.5" stroke-linejoin="round" paint-order="stroke"` : '';
      out.push(`<text x="${f(x)}" y="${f(y)}" font-family='Inter, "Segoe UI", system-ui, sans-serif' font-size="${t.size}" font-weight="${t.weight ?? 500}" fill="${t.color}" text-anchor="${anchor}"${t.alpha !== undefined ? ` opacity="${t.alpha}"` : ''}${halo}>${esc(s)}</text>`);
    },
    svgPath(d, t) {
      out.push(`<path transform="translate(${f(t.x)} ${f(t.y)}) scale(${t.scale})" d="${d}" fill="${t.fill ?? 'none'}"${t.stroke ? ` stroke="${t.stroke}" stroke-width="${t.strokeWidth ?? 1}" stroke-linecap="round" stroke-linejoin="round"` : ''}/>`);
    },
  };
}

/** The Fontexto mark (src/web/assets/fontexto-mark.svg, viewBox 360×320). */
export const MARK_PATHS = {
  stem: 'M281 29 C225 13 195 45 185 115 C175 185 160 255 137 280 C120 300 90 295 70 292',
  bar: 'M20 160 C90 144 210 138 340 146 L347 150 L292 153 L345 161 L250 164 C170 166 92 172 26 192 C10 188 10 168 20 160 Z',
};
