// Loads the reference project (data dir + curated evidence) as a gold set for the automatic matcher.
import { ProjectStore } from '../../src/server/store.ts';
import { pairCurated } from '../../src/core/curated.ts';
import type { CitationGraph, PublicationNode } from '../../src/core/model.ts';
import type { PdfText } from '../../src/core/text.ts';
import type { CitationOccurrence, EvidenceStatus } from '../../src/core/evidence.ts';

export interface Gold {
  graph: CitationGraph;
  texts: Record<string, PdfText>;
  /** occurrence id -> gold */
  gold: Map<string, { status: EvidenceStatus; pages: Set<number>; key: string; sourceNote?: boolean; quotes: string[] }>;
}

export async function loadGold(dataDir = process.env.DATA_DIR ?? 'data', projectId = process.env.PROJECT ?? 'demo'): Promise<Gold & { occurrences: CitationOccurrence[]; store: ProjectStore }> {
  const store = new ProjectStore(dataDir);
  const graph = await store.getGraph(projectId);
  const curated = await store.getCurated(projectId);
  if (!curated) throw new Error('no curated evidence in the project');
  const texts: Record<string, PdfText> = {};
  for (const f of Object.values(graph.files)) {
    const t = await store.getText(projectId, f.id);
    if (t) texts[f.id] = t;
  }
  const evidence = await store.getEvidence(projectId);
  // Curated pairing needs occurrences; the stored report already has curated applied, ids are the same.
  const { pairs } = pairCurated(graph, evidence, curated);
  const gold: Gold['gold'] = new Map();
  for (const [id, it] of pairs) gold.set(id, { status: it.status, pages: new Set(it.passages.map((p) => p.page)), key: it.key, sourceNote: it.sourceNote, quotes: it.passages.map((p) => p.text) });
  return { graph, texts, gold, occurrences: evidence.occurrences, store };
}
export const pubOf = (graph: CitationGraph, id: string) => graph.nodes[id] as PublicationNode;
