import ELK from 'elkjs/lib/elk.bundled.js';
import { REF_STATUS_ORDER } from '../core/refStatus';
import type { ViewGraph, ViewNode } from '../core/view';

const elk = new ELK();

export interface Positioned {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Estimated node box (labels are short: "Author et al. (Year)"). */
export function nodeSize(n: ViewNode): { width: number; height: number } {
  if (n.kind === 'document') return { width: 220, height: 56 };
  if (n.kind === 'group') return { width: 200, height: 54 };
  const scale = 1 + Math.min(Math.max(0, n.inDegree - 1), 12) * 0.05;
  const width = Math.min(260, Math.max(130, n.label.length * 7.2 + 36)) * scale;
  return { width, height: 38 * scale };
}

/** Directed layered layout, left to right (citing → cited). */
export async function layoutGraph(view: ViewGraph): Promise<Map<string, Positioned>> {
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': '90',
      'elk.spacing.nodeNode': '18',
      'elk.spacing.componentComponent': '40',
      'elk.separateConnectedComponents': 'true',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.edgeRouting': 'SPLINES',
    },
    children: view.nodes.map((n) => ({ id: n.id, ...nodeSize(n) })),
    // Thematic suggestions do not influence the hierarchy.
    edges: view.edges.filter((e) => e.kind !== 'related_to').map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
  const res = await elk.layout(graph);
  const out = new Map<string, Positioned>();
  for (const c of res.children ?? []) out.set(c.id, { id: c.id, x: c.x ?? 0, y: c.y ?? 0, width: c.width ?? 0, height: c.height ?? 0 });
  return out;
}


/**
 * When only "document -> source" edges are shown, a layered layout is one very tall column. This places the
 * sources in columns grouped by verification status (same order as the legend), the document on the left.
 */
export function statusGridLayout(view: ViewGraph, opts: { narrow?: boolean; weights?: Map<string, number> } = {}): Map<string, Positioned> {
  const out = new Map<string, Positioned>();
  const docs = view.nodes.filter((n) => n.kind === 'document');
  const rest = view.nodes.filter((n) => n.kind !== 'document');
  const rank = (n: ViewNode) => (n.refStatus ? REF_STATUS_ORDER.indexOf(n.refStatus) : REF_STATUS_ORDER.length);
  // within a status: most cited in the text first (when known), then alphabetical
  const w = (n: ViewNode) => opts.weights?.get(n.id) ?? 0;
  rest.sort((a, b) => rank(a) - rank(b) || w(b) - w(a) || a.label.localeCompare(b.label));
  if (opts.narrow) return narrowStarLayout(docs, rest);
  const sizes = new Map<number, number>();
  for (const n of rest) sizes.set(rank(n), (sizes.get(rank(n)) ?? 0) + 1);
  // one column per status when it fits; long groups wrap
  const ROWS = Math.min(16, Math.max(8, ...sizes.values()));
  const colW = 280;
  const rowH = 50;
  let x = 0;
  let tallest = 0;
  let i = 0;
  while (i < rest.length) {
    const r = rank(rest[i]);
    const block = [];
    while (i < rest.length && rank(rest[i]) === r) block.push(rest[i++]);
    for (let c = 0; c * ROWS < block.length; c++) {
      const col = block.slice(c * ROWS, (c + 1) * ROWS);
      col.forEach((n, k) => {
        const { width, height } = nodeSize(n);
        out.set(n.id, { id: n.id, x, y: k * rowH, width, height });
      });
      tallest = Math.max(tallest, col.length * rowH);
      x += colW;
    }
    x += 40;
  }
  // the document on top, centred over the status groups: its links go down to each group's header without crossing
  const totalW = Math.max(0, x - 40 - colW + Math.max(...[...out.values()].map((p) => p.width), 0));
  docs.forEach((n, k) => {
    const { width, height } = nodeSize(n);
    out.set(n.id, { id: n.id, x: Math.max(0, totalW / 2 - width / 2) + k * (width + 20), y: -(height + 190), width, height });
  });
  return out;
}

/**
 * Phone variant of the star layout: the document on top and its sources in
 * one or a few columns below, so the graph fills a tall, narrow screen.
 * `rest` arrives sorted by status, so each status still forms a run.
 */
function narrowStarLayout(docs: ViewNode[], rest: ViewNode[]): Map<string, Positioned> {
  const out = new Map<string, Positioned>();
  const cols = Math.max(1, Math.min(4, Math.round(Math.sqrt(rest.length * 0.13))));
  const perCol = Math.max(1, Math.ceil(rest.length / cols));
  const sizes = rest.map((n) => nodeSize(n));
  const colW = Math.max(160, ...sizes.map((z) => z.width)) + 24;
  const rowH = 50;
  const totalW = cols * colW - 24;
  let y = 0;
  docs.forEach((n) => {
    const { width, height } = nodeSize(n);
    out.set(n.id, { id: n.id, x: Math.max(0, totalW / 2 - width / 2), y, width, height });
    y += height + 20;
  });
  const top = y + 70;
  rest.forEach((n, i) => {
    const c = Math.floor(i / perCol);
    const k = i % perCol;
    const { width, height } = sizes[i];
    out.set(n.id, { id: n.id, x: c * colW + (colW - 24 - width) / 2, y: top + k * rowH, width, height });
  });
  return out;
}

/** One header per status group of the wide star layout: above its columns, spanning them. */
export interface StatusHeader {
  status: NonNullable<ViewNode['refStatus']>;
  count: number;
  x: number;
  y: number;
  width: number;
}

export const STATUS_HEADER_HEIGHT = 44;

export function statusGroupHeaders(view: ViewGraph, pos: Map<string, Positioned>): StatusHeader[] {
  const groups = new Map<NonNullable<ViewNode['refStatus']>, Positioned[]>();
  for (const n of view.nodes) {
    if (n.kind === 'document' || !n.refStatus) continue;
    const p = pos.get(n.id);
    if (!p) continue;
    const g = groups.get(n.refStatus) ?? [];
    g.push(p);
    groups.set(n.refStatus, g);
  }
  return REF_STATUS_ORDER.filter((s) => groups.has(s)).map((status) => {
    const ps = groups.get(status)!;
    const minX = Math.min(...ps.map((p) => p.x));
    const maxX = Math.max(...ps.map((p) => p.x + p.width));
    const minY = Math.min(...ps.map((p) => p.y));
    return { status, count: ps.length, x: minX, y: minY - STATUS_HEADER_HEIGHT - 26, width: Math.max(200, maxX - minX) };
  });
}
