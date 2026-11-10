import ELK from 'elkjs/lib/elk.bundled.js';
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
  const scale = 1 + Math.min(n.inDegree, 12) * 0.05;
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
