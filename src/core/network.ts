/**
 * "Network" view of the bibliography: the references of a document linked to each other, grouped by topic.
 *
 * Pure and framework-free (unit tested). Inputs are the visible reference nodes plus whatever OpenAlex returned for
 * them (see openAlexGraph.ts); without OpenAlex data the references are still grouped (title keywords) and linked
 * by title similarity, so the graph never degrades back to a plain star.
 *
 * Edge kinds, strongest first:
 *  - cites:    reference A lists reference B in its own bibliography (OpenAlex referenced_works). Directed.
 *  - coupling: A and B share 2+ references of their own (bibliographic coupling). Weight = shared count.
 *  - similar:  only for references OpenAlex could not identify: their titles share rare words. A hint, not a fact.
 *  - doc:      the main document cites the reference (the classic star), drawn faintly.
 */
import type { GraphWork } from './openAlexGraph.js';

export type NetType = 'article' | 'book' | 'thesis' | 'web' | 'other';
export type NetEdgeKind = 'cites' | 'coupling' | 'similar' | 'doc';
export type ClusterSource = 'topic' | 'subfield' | 'field' | 'keyword' | 'other';

export interface NetInput {
  id: string;
  kind: 'document' | 'publication';
  label: string;
  title?: string;
  year?: number;
  /** BibTeX-ish entry type from the reference list parser ("article", "book", "phdthesis", "misc"...). */
  entryType?: string;
  url?: string;
  /** Citations of this reference in the main document's text. */
  inText?: number;
}

export interface NetNode {
  id: string;
  kind: 'document' | 'publication';
  label: string;
  title?: string;
  year?: number;
  type: NetType;
  cluster: string;
  citedBy?: number;
  inText: number;
  /** cites + coupling + similar links (not counting the main document). */
  degree: number;
  importance: number;
  openalexId?: string;
}

export interface NetEdge {
  id: string;
  source: string;
  target: string;
  kind: NetEdgeKind;
  weight: number;
}

export interface NetCluster {
  key: string;
  label: string;
  source: ClusterSource;
  count: number;
  color: string;
}

export interface Network {
  nodes: NetNode[];
  edges: NetEdge[];
  clusters: NetCluster[];
  /** References with OpenAlex data / without. */
  identified: number;
}

/** Colour-blind-friendly categorical palette (Okabe–Ito + Tableau), readable on light and dark backgrounds. */
export const CLUSTER_COLORS = ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#D55E00', '#56B4E9', '#8C6D31', '#7B61FF', '#C0392B', '#2A9D8F'];
export const OTHER_COLOR = '#9AA3AF';
export const OTHER_CLUSTER = '__other__';
export const MAX_CLUSTERS = CLUSTER_COLORS.length;
const MAX_COUPLING_PER_NODE = 4;
const MAX_SIMILAR_PER_NODE = 3;

/** Small multilingual stop-list (EN, PT, ES, FR, DE, RU) plus words that say nothing about a topic. */
const STOP = new Set(
  (
    'the and for with from into onto over under about between among within without using based study studies analysis approach review case new effect effects role use towards toward via its their this that these those are was were has have how what why when where which who whose than then also can not but our your his her they them more most less least other such per one two three ' +
    'uma umas uns para com sem por pela pelo pelas pelos entre sobre como mais menos seus suas dos das nos nas aos ' +
    'una unos unas por para con sin sobre entre como más menos sus los las del ' +
    'les des une pour avec sans sur entre dans par aux est ' +
    'der die das und mit für von zur zum eine einer einem eines über unter ' +
    'и в на по для от из с к о об при как что это его их или не'
  ).split(' '),
);

const fold = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const HAN = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u;

/** Content words of a title (4+ letters, or CJK bigrams), with a light plural fold so "model"/"models" meet. */
export function titleWords(title: string | undefined): string[] {
  if (!title) return [];
  const out = new Set<string>();
  for (const w of fold(title).split(' ')) {
    if (!w || /^\d+$/.test(w)) continue;
    if (HAN.test(w)) {
      for (let i = 0; i + 1 < w.length; i++) out.add(w.slice(i, i + 2));
      continue;
    }
    if (w.length < 4 || STOP.has(w)) continue;
    out.add(w.length > 5 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 4 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is') ? w.slice(0, -1) : w);
  }
  return [...out];
}

export function netType(work: GraphWork | undefined, entryType: string | undefined, url: string | undefined): NetType {
  const t = (work?.type ?? '').toLowerCase();
  if (t === 'dissertation') return 'thesis';
  if (t === 'book' || t === 'book-chapter' || t === 'monograph' || t === 'reference-entry' || t === 'edited-book') return 'book';
  if (t === 'article' || t === 'review' || t === 'preprint' || t === 'letter' || t === 'conference-paper' || t === 'editorial' || t === 'proceedings-article') return 'article';
  if (t) return 'other';
  const e = (entryType ?? '').toLowerCase();
  if (/thesis|dissertation/.test(e)) return 'thesis';
  if (/book|inbook|incollection|chapter/.test(e)) return 'book';
  if (/article|inproceedings|conference|proceedings|techreport|report|preprint/.test(e)) return 'article';
  if (/online|web|misc/.test(e) && url) return 'web';
  if (url && !e) return 'web';
  return 'other';
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function capitalize(w: string) {
  return w ? w[0].toLocaleUpperCase() + w.slice(1) : w;
}

/**
 * Picks the groups: the largest OpenAlex topics (2+ members), then subfields for what is left, then title keywords
 * for references OpenAlex did not identify. Everything else is "other". At most MAX_CLUSTERS coloured groups.
 */
function assignClusters(pubs: NetInput[], works: Map<string, GraphWork>): { byNode: Map<string, string>; clusters: NetCluster[] } {
  const byNode = new Map<string, string>();
  const clusters: NetCluster[] = [];
  const slotsLeft = () => MAX_CLUSTERS - clusters.length;
  const take = (source: ClusterSource, groups: Map<string, { label: string; ids: string[] }>, min: number) => {
    const ranked = [...groups.entries()].filter(([, g]) => g.ids.filter((id) => !byNode.has(id)).length >= min).sort((a, b) => b[1].ids.length - a[1].ids.length || a[1].label.localeCompare(b[1].label));
    for (const [key, g] of ranked) {
      if (slotsLeft() <= 0) break;
      const free = g.ids.filter((id) => !byNode.has(id));
      if (free.length < min) continue;
      const k = `${source}:${key}`;
      for (const id of free) byNode.set(id, k);
      clusters.push({ key: k, label: g.label, source, count: free.length, color: CLUSTER_COLORS[clusters.length] });
    }
  };
  const group = (pick: (w: GraphWork) => { id: string; name: string } | undefined) => {
    const m = new Map<string, { label: string; ids: string[] }>();
    for (const p of pubs) {
      const w = works.get(p.id);
      const lv = w && pick(w);
      if (!lv) continue;
      const g = m.get(lv.id) ?? { label: lv.name, ids: [] };
      g.ids.push(p.id);
      m.set(lv.id, g);
    }
    return m;
  };
  // pick the finest OpenAlex level whose 10 biggest groups cover most references: a focused bibliography gets
  // topics ("Flood risk"), a broad one gets subfields or fields instead of one big "other"
  const levels: [ClusterSource, (w: GraphWork) => { id: string; name: string } | undefined][] = [
    ['topic', (w) => w.topic],
    ['subfield', (w) => w.topic?.subfield],
    ['field', (w) => w.topic?.field],
  ];
  const withTopic = pubs.filter((p) => works.get(p.id)?.topic).length;
  const coverage = (pick: (w: GraphWork) => { id: string; name: string } | undefined) =>
    [...group(pick).values()]
      .map((g) => g.ids.length)
      .filter((n) => n >= 2)
      .sort((a, b) => b - a)
      .slice(0, MAX_CLUSTERS)
      .reduce((a, b) => a + b, 0);
  let chosen = 0;
  if (withTopic) {
    const covs = levels.map(([, pick]) => coverage(pick) / withTopic);
    const fine = covs.findIndex((c) => c >= 0.6);
    chosen = fine >= 0 ? fine : covs.indexOf(Math.max(...covs));
  }
  take(levels[chosen][0], group(levels[chosen][1]), 2);
  for (const [src, pick] of levels.slice(chosen + 1)) take(src, group(pick), 3);
  // keyword groups for the references without a topic: each takes its most shared title word
  const noTopic = pubs.filter((p) => !byNode.has(p.id) && !works.get(p.id)?.topic);
  const words = new Map(pubs.map((p) => [p.id, titleWords(p.title)]));
  // document frequency over the whole list: a word shared by most titles is not a group
  const dfAll = new Map<string, number>();
  for (const ws of words.values()) for (const w of ws) dfAll.set(w, (dfAll.get(w) ?? 0) + 1);
  const df = new Map<string, number>();
  for (const p of noTopic) for (const w of words.get(p.id) ?? []) df.set(w, (df.get(w) ?? 0) + 1);
  // words in more than a third of the titles ("cities", "study"...) say nothing about a group
  const tooCommon = Math.max(3, Math.floor(pubs.length / 3));
  const kw = new Map<string, { label: string; ids: string[] }>();
  for (const p of noTopic) {
    const best = (words.get(p.id) ?? []).filter((w) => (df.get(w) ?? 0) >= 2 && (dfAll.get(w) ?? 0) <= tooCommon).sort((a, b) => (df.get(b) ?? 0) - (df.get(a) ?? 0) || a.localeCompare(b))[0];
    if (!best) continue;
    const g = kw.get(best) ?? { label: capitalize(best), ids: [] };
    g.ids.push(p.id);
    kw.set(best, g);
  }
  // a handful of unidentified references among many identified ones read better as "other" than as tiny word groups
  if (noTopic.length >= Math.max(4, pubs.length * 0.3)) take('keyword', kw, 2);
  const others = pubs.filter((p) => !byNode.has(p.id));
  for (const p of others) byNode.set(p.id, OTHER_CLUSTER);
  if (others.length) clusters.push({ key: OTHER_CLUSTER, label: '', source: 'other', count: others.length, color: OTHER_COLOR });
  return { byNode, clusters };
}

export function buildNetwork(inputs: NetInput[], works: Map<string, GraphWork>, docEdges: { source: string; target: string }[] = []): Network {
  const pubs = inputs.filter((n) => n.kind === 'publication');
  const ids = new Set(inputs.map((n) => n.id));
  const edges: NetEdge[] = [];
  const seen = new Set<string>();
  const add = (source: string, target: string, kind: NetEdgeKind, weight = 1) => {
    if (source === target) return;
    const k = kind === 'cites' || kind === 'doc' ? `${kind}:${source}>${target}` : `${kind}:${pairKey(source, target)}`;
    if (seen.has(k)) return;
    // a citation already says more than coupling/similarity for the same pair
    if (kind !== 'cites' && kind !== 'doc' && (seen.has(`cites:${source}>${target}`) || seen.has(`cites:${target}>${source}`))) return;
    seen.add(k);
    edges.push({ id: k, source, target, kind, weight });
  };

  // OpenAlex id -> reference node (two references resolving to one work are the same work: keep the first)
  const byOa = new Map<string, string>();
  for (const p of pubs) {
    const w = works.get(p.id);
    if (w && !byOa.has(w.id)) byOa.set(w.id, p.id);
  }
  // 1) citations between references
  for (const p of pubs) {
    const w = works.get(p.id);
    if (!w) continue;
    for (const r of w.refs) {
      if (r === w.id) continue;
      const target = byOa.get(r);
      if (target && target !== p.id) add(p.id, target, 'cites');
    }
  }
  // 2) bibliographic coupling: inverted index cited work -> citing references
  const citing = new Map<string, string[]>();
  for (const p of pubs) {
    const w = works.get(p.id);
    if (!w || byOa.get(w.id) !== p.id) continue;
    for (const r of new Set(w.refs)) {
      const l = citing.get(r) ?? [];
      l.push(p.id);
      citing.set(r, l);
    }
  }
  const shared = new Map<string, number>();
  for (const l of citing.values()) {
    if (l.length < 2 || l.length > 60) continue; // a work cited by most of the list says nothing about pairs
    for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) shared.set(pairKey(l[i], l[j]), (shared.get(pairKey(l[i], l[j])) ?? 0) + 1);
  }
  const strongest = (pairs: [string, number][], perNode: number) => {
    const used = new Map<string, number>();
    const out: [string, string, number][] = [];
    for (const [k, n] of pairs.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      const [a, b] = k.split('|');
      if ((used.get(a) ?? 0) >= perNode && (used.get(b) ?? 0) >= perNode) continue;
      used.set(a, (used.get(a) ?? 0) + 1);
      used.set(b, (used.get(b) ?? 0) + 1);
      out.push([a, b, n]);
    }
    return out;
  };
  for (const [a, b, n] of strongest([...shared].filter(([, n]) => n >= 2), MAX_COUPLING_PER_NODE)) add(a, b, 'coupling', n);

  // 3) title similarity, only among references OpenAlex did not identify (or every one when nothing was identified)
  const unknown = pubs.filter((p) => !works.get(p.id));
  if (unknown.length > 0 && pubs.length > 1) {
    const words = new Map(pubs.map((p) => [p.id, new Set(titleWords(p.title))]));
    const df = new Map<string, number>();
    for (const ws of words.values()) for (const w of ws) df.set(w, (df.get(w) ?? 0) + 1);
    const common = Math.max(3, Math.ceil(pubs.length * 0.25));
    const sims: [string, number][] = [];
    for (let i = 0; i < pubs.length; i++) {
      const A = words.get(pubs[i].id) as Set<string>;
      for (let j = i + 1; j < pubs.length; j++) {
        if (works.get(pubs[i].id) && works.get(pubs[j].id)) continue;
        const B = words.get(pubs[j].id) as Set<string>;
        let inter = 0;
        for (const w of A) if (B.has(w) && (df.get(w) ?? 0) <= common) inter++;
        if (inter < 2) continue;
        const jac = inter / (A.size + B.size - inter);
        if (jac >= 0.2) sims.push([pairKey(pubs[i].id, pubs[j].id), Math.round(jac * 100) / 100]);
      }
    }
    for (const [a, b, s] of strongest(sims, MAX_SIMILAR_PER_NODE)) add(a, b, 'similar', s);
  }
  // 4) the main document's citations (the star), faint
  for (const e of docEdges) if (ids.has(e.source) && ids.has(e.target)) add(e.source, e.target, 'doc');

  const degree = new Map<string, number>();
  for (const e of edges) {
    if (e.kind === 'doc') continue;
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const { byNode, clusters } = assignClusters(pubs, works);
  const nodes: NetNode[] = inputs.map((n) => {
    const w = works.get(n.id);
    const inText = n.inText ?? 0;
    const deg = degree.get(n.id) ?? 0;
    return {
      id: n.id,
      kind: n.kind,
      label: n.label,
      title: n.title,
      year: n.year ?? w?.year,
      type: n.kind === 'document' ? 'other' : netType(w, n.entryType, n.url),
      cluster: n.kind === 'document' ? '' : (byNode.get(n.id) ?? OTHER_CLUSTER),
      citedBy: w?.citedBy,
      inText,
      degree: deg,
      importance: n.kind === 'document' ? Infinity : 2 * inText + deg + Math.log10((w?.citedBy ?? 0) + 1),
      openalexId: w?.id,
    };
  });
  return { nodes, edges, clusters, identified: pubs.filter((p) => works.get(p.id)).length };
}

export type SizeBy = 'inText' | 'degree' | 'citedBy';

/** Node radius in graph units. */
export function nodeRadius(n: Pick<NetNode, 'kind' | 'inText' | 'degree' | 'citedBy'>, by: SizeBy): number {
  if (n.kind === 'document') return 16;
  const v = by === 'inText' ? n.inText : by === 'degree' ? n.degree : Math.log10((n.citedBy ?? 0) + 1) * 2;
  return Math.min(22, 5 + 2.6 * Math.sqrt(Math.max(0, v)));
}

/** Short "Surname Year" label: the reference label is already like that; trimmed for the canvas. */
export function shortLabel(label: string, max = 26): string {
  const s = label.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
