/**
 * Pure view-model derivation for the UI: mode selection, filters, search and
 * group collapse. Kept framework-free so it can be unit tested.
 */
import { categoryOf, UNCATEGORIZED } from './categories.js';
import type { CitationGraph, EdgeKind, GraphEdge, GraphNode, NodeKind, PublicationNode, VerificationStatus } from './model.js';
import { normalizeName, normalizeTitle } from './normalize.js';

export type GraphMode = 'bibliographic' | 'evidence';

export interface ViewFilters {
  mode: GraphMode;
  yearMin?: number;
  yearMax?: number;
  author?: string;
  /** Empty = all categories. */
  categories: string[];
  statuses: VerificationStatus[];
  edgeKinds: EdgeKind[];
  search?: string;
  onlyWithPdf?: boolean;
  hideIsolated?: boolean;
}

export const DEFAULT_FILTERS: ViewFilters = {
  mode: 'bibliographic',
  categories: [],
  statuses: ['confirmed', 'unverified', 'validated', 'candidate', 'inconclusive', 'potential_contradiction'],
  edgeKinds: ['cites', 'contains_claim', 'references', 'has_evidence', 'supports', 'contradicts'],
  hideIsolated: false,
};

export interface ViewNode {
  id: string;
  kind: NodeKind | 'group';
  label: string;
  title?: string;
  category: string;
  categorySuggested: boolean;
  year?: number;
  hasPdf: boolean;
  inDegree: number;
  outDegree: number;
  matchesSearch: boolean;
  groupSize?: number;
  memberIds?: string[];
}

export interface ViewEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  status: VerificationStatus;
  /** >1 when several edges were aggregated by a collapsed group. */
  count: number;
  memberIds: string[];
}

export interface ViewGraph {
  nodes: ViewNode[];
  edges: ViewEdge[];
  hiddenCount: number;
}

const MODE_NODES: Record<GraphMode, NodeKind[]> = {
  bibliographic: ['document', 'publication'],
  evidence: ['document', 'claim', 'publication', 'evidence'],
};
const MODE_EDGES: Record<GraphMode, EdgeKind[]> = {
  bibliographic: ['cites', 'related_to'],
  evidence: ['contains_claim', 'references', 'has_evidence', 'supports', 'contradicts'],
};

export const groupNodeId = (category: string) => `group:${category}`;

function nodePasses(n: GraphNode, f: ViewFilters): boolean {
  if (n.kind !== 'publication') return true;
  if (f.yearMin !== undefined && (n.year === undefined || n.year < f.yearMin)) return false;
  if (f.yearMax !== undefined && (n.year === undefined || n.year > f.yearMax)) return false;
  if (f.author?.trim()) {
    const q = normalizeName(f.author.trim());
    if (!n.authors.some((a) => normalizeName(a.family).includes(q) || normalizeName(a.raw).includes(q))) return false;
  }
  if (f.categories.length > 0 && !f.categories.includes(categoryOf(n))) return false;
  if (f.onlyWithPdf && n.fileIds.length === 0) return false;
  return true;
}

export function matchesSearch(n: GraphNode, q: string | undefined): boolean {
  if (!q?.trim()) return false;
  const nq = normalizeTitle(q);
  if (!nq) return false;
  const hay = [n.label, 'title' in n ? n.title : undefined, n.kind === 'publication' ? n.doi : undefined, n.kind === 'publication' ? n.authors.map((a) => a.raw).join(' ') : undefined]
    .filter(Boolean)
    .map((s) => normalizeTitle(String(s)))
    .join(' ');
  return hay.includes(nq) || (n.kind === 'publication' && Boolean(n.doi) && n.doi!.includes(q.trim().toLowerCase()));
}

export function buildView(graph: CitationGraph, f: ViewFilters, collapsed: ReadonlySet<string> = new Set()): ViewGraph {
  const kinds = MODE_NODES[f.mode];
  const edgeKinds = MODE_EDGES[f.mode].filter((k) => f.edgeKinds.includes(k));
  const all = Object.values(graph.nodes).filter((n) => kinds.includes(n.kind));
  const visible = new Map(all.filter((n) => nodePasses(n, f)).map((n) => [n.id, n]));
  const hiddenByFilter = all.length - visible.size;

  let edges: GraphEdge[] = Object.values(graph.edges).filter(
    (e) => edgeKinds.includes(e.kind) && f.statuses.includes(e.status) && visible.has(e.source) && visible.has(e.target),
  );
  // In evidence mode only publications that take part in evidence relations are shown.
  if (f.mode === 'evidence') {
    const touched = new Set(edges.flatMap((e) => [e.source, e.target]));
    for (const [id, n] of visible) if (n.kind === 'publication' && !touched.has(id)) visible.delete(id);
  }
  if (f.hideIsolated) {
    const touched = new Set(edges.flatMap((e) => [e.source, e.target]));
    for (const [id, n] of visible) if (n.kind !== 'document' && !touched.has(id)) visible.delete(id);
    edges = edges.filter((e) => visible.has(e.source) && visible.has(e.target));
  }

  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  for (const e of edges) {
    if (e.kind === 'related_to') continue;
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
    outDeg.set(e.source, (outDeg.get(e.source) ?? 0) + 1);
  }

  const toViewNode = (n: GraphNode): ViewNode => {
    const pub = n.kind === 'publication' ? (n as PublicationNode) : undefined;
    return {
      id: n.id,
      kind: n.kind,
      label: n.label,
      title: pub?.title ?? ('title' in n ? (n.title as string | undefined) : undefined),
      category: pub ? categoryOf(pub) : n.kind === 'document' ? 'Documento principal' : UNCATEGORIZED,
      categorySuggested: pub?.category?.source === 'suggested',
      year: pub?.year,
      hasPdf: pub ? pub.fileIds.length > 0 : n.kind === 'document' ? Boolean(n.fileId) : 'anchor' in n && Boolean(n.anchor),
      inDegree: inDeg.get(n.id) ?? 0,
      outDegree: outDeg.get(n.id) ?? 0,
      matchesSearch: matchesSearch(n, f.search),
    };
  };

  const viewNodes: ViewNode[] = [];
  const memberOf = new Map<string, string>();
  const groups = new Map<string, ViewNode>();
  for (const n of visible.values()) {
    const vn = toViewNode(n);
    if (n.kind === 'publication' && collapsed.has(vn.category)) {
      const gid = groupNodeId(vn.category);
      memberOf.set(n.id, gid);
      const g = groups.get(gid) ?? {
        id: gid,
        kind: 'group' as const,
        label: vn.category,
        category: vn.category,
        categorySuggested: false,
        hasPdf: false,
        inDegree: 0,
        outDegree: 0,
        matchesSearch: false,
        groupSize: 0,
        memberIds: [],
      };
      g.groupSize! += 1;
      g.memberIds!.push(n.id);
      g.inDegree += vn.inDegree;
      g.outDegree += vn.outDegree;
      g.matchesSearch ||= vn.matchesSearch;
      g.hasPdf ||= vn.hasPdf;
      groups.set(gid, g);
    } else viewNodes.push(vn);
  }
  viewNodes.push(...groups.values());

  const agg = new Map<string, ViewEdge>();
  for (const e of edges) {
    const s = memberOf.get(e.source) ?? e.source;
    const t = memberOf.get(e.target) ?? e.target;
    if (s === t) continue;
    const key = `${e.kind}|${e.status}|${s}|${t}`;
    const existing = agg.get(key);
    if (existing) {
      existing.count++;
      existing.memberIds.push(e.id);
    } else {
      agg.set(key, { id: s === e.source && t === e.target ? e.id : `agg:${key}`, source: s, target: t, kind: e.kind, status: e.status, count: 1, memberIds: [e.id] });
    }
  }

  viewNodes.sort((a, b) => a.id.localeCompare(b.id));
  return { nodes: viewNodes, edges: [...agg.values()].sort((a, b) => a.id.localeCompare(b.id)), hiddenCount: hiddenByFilter };
}

/** Neighbourhood used for highlighting connections of a selected node. */
export function neighbourhood(view: ViewGraph, nodeId: string): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set([nodeId]);
  const edges = new Set<string>();
  for (const e of view.edges) {
    if (e.source === nodeId || e.target === nodeId) {
      edges.add(e.id);
      nodes.add(e.source);
      nodes.add(e.target);
    }
  }
  return { nodes, edges };
}

/** Lists of publications citing / cited by a node, restricted to confirmed or unverified `cites` edges. */
export function citationLists(graph: CitationGraph, nodeId: string) {
  const cites: GraphEdge[] = [];
  const citedBy: GraphEdge[] = [];
  for (const e of Object.values(graph.edges)) {
    if (e.kind !== 'cites' || e.status === 'rejected') continue;
    if (e.source === nodeId) cites.push(e);
    if (e.target === nodeId) citedBy.push(e);
  }
  return { cites, citedBy };
}
