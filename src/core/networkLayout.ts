/**
 * Force layout for the network view (d3-force), run synchronously: 150 nodes settle in a few dozen ms.
 * Deterministic (seeded), so the same bibliography always gets the same picture.
 *
 * Each topic group gets an anchor on a ring and its members are pulled towards it, so groups read as islands;
 * citation links pull hardest, shared-reference links less, title-similarity links least. The main document sits in
 * the middle with very weak links (it cites everything: letting it pull would collapse the picture into a star).
 * Timeline mode puts the year on the x axis and the groups in horizontal bands.
 */
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import { nodeRadius, type Network, type SizeBy } from './network.js';

export interface LaidOut {
  x: number;
  y: number;
  r: number;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  r: number;
  cluster: string;
  year?: number;
  doc: boolean;
}
interface SimLink extends SimulationLinkDatum<SimNode> {
  kind: string;
  weight: number;
}

function lcg(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function layoutNetwork(net: Network, opts: { sizeBy: SizeBy; timeline?: boolean; showDoc?: boolean; /** height / width of the screen: portrait phones get a tall ring. */ aspect?: number } = { sizeBy: 'inText' }): Map<string, LaidOut> {
  const nodes: SimNode[] = net.nodes
    .filter((n) => opts.showDoc !== false || n.kind !== 'document')
    .map((n) => ({ id: n.id, r: nodeRadius(n, opts.sizeBy), cluster: n.cluster, year: n.year, doc: n.kind === 'document' }));
  const ids = new Set(nodes.map((n) => n.id));
  const pubCount = nodes.filter((n) => !n.doc).length;
  const clusterKeys = net.clusters.map((c) => c.key);
  const ringR = Math.max(150, Math.sqrt(Math.max(1, pubCount)) * 46);
  const squash = Math.min(1.7, Math.max(0.6, opts.aspect ?? 0.72));
  const anchor = new Map<string, { x: number; y: number }>();
  clusterKeys.forEach((k, i) => {
    const a = (i / Math.max(1, clusterKeys.length)) * Math.PI * 2 - Math.PI / 2;
    anchor.set(k, clusterKeys.length === 1 ? { x: 0, y: 0 } : { x: Math.cos(a) * ringR * Math.min(1, 1 / squash), y: Math.sin(a) * ringR * Math.min(1.25, squash) });
  });
  const years = nodes.flatMap((n) => (n.year && !n.doc ? [n.year] : []));
  const y0 = years.length ? Math.min(...years) : 0;
  const y1 = years.length ? Math.max(...years) : 1;
  const width = Math.max(600, pubCount * 9);
  const yearX = (y: number | undefined) => (y === undefined ? width / 2 + 60 : ((y - y0) / Math.max(1, y1 - y0)) * width - width / 2);
  const band = (k: string) => (clusterKeys.indexOf(k) - (clusterKeys.length - 1) / 2) * 70;

  const rand = lcg(20261114);
  // seed positions near the anchors (deterministic)
  for (const n of nodes) {
    if (n.doc) {
      n.x = 0;
      n.y = 0;
      if (!opts.timeline) ((n.fx = 0), (n.fy = 0));
      continue;
    }
    const a = opts.timeline ? { x: yearX(n.year), y: band(n.cluster) } : (anchor.get(n.cluster) ?? { x: 0, y: 0 });
    n.x = a.x + (rand() - 0.5) * 80;
    n.y = a.y + (rand() - 0.5) * 80;
  }
  const links: SimLink[] = net.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ source: e.source, target: e.target, kind: e.kind, weight: e.weight }));

  const sim = forceSimulation<SimNode>(nodes)
    .randomSource(rand)
    .force(
      'link',
      forceLink<SimNode, SimLink>(links)
        .id((n) => n.id)
        .distance((l) => (l.kind === 'doc' ? ringR * 0.9 : l.kind === 'cites' ? 46 : l.kind === 'coupling' ? 64 : 80))
        .strength((l) => (l.kind === 'doc' ? 0.004 : l.kind === 'cites' ? 0.5 : l.kind === 'coupling' ? Math.min(0.4, 0.08 * l.weight) : 0.12)),
    )
    .force('charge', forceManyBody<SimNode>().strength((n) => (n.doc ? -400 : -38 - n.r * 2)).distanceMax(ringR * 1.6))
    .force('collide', forceCollide<SimNode>((n) => n.r + 5).iterations(2))
    .force('x', forceX<SimNode>((n) => (opts.timeline ? yearX(n.year) : (anchor.get(n.cluster)?.x ?? 0))).strength((n) => (n.doc ? 0 : opts.timeline ? 0.5 : 0.16)))
    .force('y', forceY<SimNode>((n) => (opts.timeline ? band(n.cluster) : (anchor.get(n.cluster)?.y ?? 0))).strength((n) => (n.doc ? 0 : opts.timeline ? 0.12 : 0.16)))
    .stop();
  const ticks = Math.min(400, 160 + nodes.length);
  for (let i = 0; i < ticks; i++) sim.tick();
  const out = new Map<string, LaidOut>();
  for (const n of nodes) out.set(n.id, { x: n.x ?? 0, y: n.y ?? 0, r: n.r });
  return out;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(pos: Iterable<LaidOut>, pad = 0): Bounds {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of pos) {
    minX = Math.min(minX, p.x - p.r);
    minY = Math.min(minY, p.y - p.r);
    maxX = Math.max(maxX, p.x + p.r);
    maxY = Math.max(maxY, p.y + p.r);
  }
  if (!Number.isFinite(minX)) return { minX: -100, minY: -100, maxX: 100, maxY: 100 };
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}
