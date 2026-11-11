import { loadGold } from './gold.mts';
import { computeEvidence, buildReferenceIndex, claimPartsOf, referenceFileFor, EVIDENCE_PARAMS, type ReferenceIndex, type CitationOccurrence } from '../../src/core/evidence.ts';
import { buildQuery, lexicalCandidates, MATCH_PARAMS, type Candidate, type MatchParams } from '../../src/core/matching.ts';
import type { PublicationNode } from '../../src/core/model.ts';

export interface Item {
  occ: CitationOccurrence;
  index: ReferenceIndex;
  fileId: string;
  gold: { status: string; pages: Set<number>; key: string; quotes: string[]; sourceNote?: boolean };
  fold: number;
}
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

export async function prepare(): Promise<Item[]> {
  const g = await loadGold();
  const rep = computeEvidence({ projectId: 'demo', now: '2026-01-01T00:00:00Z', graph: g.graph, texts: g.texts, params: { matcher: 'v1' } });
  const cache = new Map<string, ReferenceIndex>();
  const items: Item[] = [];
  for (const o of rep.occurrences) {
    const gd = g.gold.get(o.id);
    if (!gd || !o.referenceFileId) continue;
    const t = g.texts[o.referenceFileId];
    if (!t) continue;
    let idx = cache.get(o.referenceFileId);
    if (!idx) cache.set(o.referenceFileId, (idx = buildReferenceIndex(t)));
    items.push({ occ: o, index: idx, fileId: o.referenceFileId, gold: gd, fold: hash(gd.key) % 2 });
  }
  return items;
}

export function candidatesOf(it: Item, mp: MatchParams): Candidate[] {
  return lexicalCandidates(it.index, buildQuery(claimPartsOf(it.occ), mp), mp);
}

export function rankMetrics(items: Item[], mp: MatchParams, kRecall = 24) {
  let n = 0, h1 = 0, h3 = 0, hk = 0;
  for (const it of items) {
    if (!it.gold.pages.size) continue;
    const c = candidatesOf(it, mp);
    n++;
    if (c[0] && it.gold.pages.has(c[0].page)) h1++;
    if (c.slice(0, 3).some((x) => it.gold.pages.has(x.page))) h3++;
    if (c.slice(0, kRecall).some((x) => it.gold.pages.has(x.page))) hk++;
  }
  return { n, top1: +(h1 / n).toFixed(3), top3: +(h3 / n).toFixed(3), recallK: +(hk / n).toFixed(3) };
}
