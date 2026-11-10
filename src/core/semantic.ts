/**
 * Stage 2 of the matcher: re-ranks the lexical candidates with sentence embeddings.
 *
 * The embedding model itself lives outside the core (a Web Worker in the browser, onnxruntime-node in experiments);
 * this module only plans which texts must be embedded and applies the resulting vectors, so the same code serves the
 * web build, the Windows edition and the evaluation scripts. Vectors are L2-normalised, so cosine = dot product.
 */
import { applyCurated, type CuratedFile } from './curated.js';
import { finalizeV2, summarizeOccurrences, type CitationOccurrence, type EvidenceParams, type EvidenceReport, type PendingMatch } from './evidence.js';
import type { CitationGraph } from './model.js';

/** Which texts to embed, with unique entries and indexes back into them. */
export interface SemanticPlan {
  /** Citing texts (embedded as queries). */
  claims: string[];
  /** Passage windows (embedded as passages). */
  passages: string[];
  items: { occId: string; claim: number; local: number; cands: number[] }[];
}

const MAX_CLAIM_CHARS = 600;

export function planSemantic(pendings: Iterable<PendingMatch>, occurrences: Map<string, CitationOccurrence>): SemanticPlan {
  const claims: string[] = [];
  const passages: string[] = [];
  const cIdx = new Map<string, number>();
  const pIdx = new Map<string, number>();
  const idx = (m: Map<string, number>, list: string[], t: string) => {
    let i = m.get(t);
    if (i === undefined) {
      i = list.length;
      list.push(t);
      m.set(t, i);
    }
    return i;
  };
  const items: SemanticPlan['items'] = [];
  for (const pm of pendings) {
    const occ = occurrences.get(pm.occId);
    if (!occ || pm.candidates.length === 0) continue;
    const sentence = pm.parts.sentence.slice(0, MAX_CLAIM_CHARS);
    const local = (pm.parts.local || pm.parts.sentence).slice(0, MAX_CLAIM_CHARS);
    items.push({ occId: pm.occId, claim: idx(cIdx, claims, sentence), local: idx(cIdx, claims, local), cands: pm.candidates.map((c) => idx(pIdx, passages, c.text)) });
  }
  return { claims, passages, items };
}

const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/** Applies the embeddings: sets `sem` on every candidate and re-labels the occurrences. Returns a new report. */
export function applySemantic(
  report: EvidenceReport,
  pendings: Map<string, PendingMatch>,
  plan: SemanticPlan,
  claimVecs: Float32Array[],
  passageVecs: Float32Array[],
  params: EvidenceParams,
  curated?: { graph: CitationGraph; file: CuratedFile },
): EvidenceReport {
  const occurrences = report.occurrences.map((o) => ({ ...o }));
  const byId = new Map(occurrences.map((o) => [o.id, o]));
  for (const it of plan.items) {
    const pm = pendings.get(it.occId);
    const occ = byId.get(it.occId);
    if (!pm || !occ) continue;
    pm.candidates.forEach((c, k) => {
      const v = passageVecs[it.cands[k]];
      c.sem = (dot(claimVecs[it.claim], v) + dot(claimVecs[it.local], v)) / 2;
    });
    finalizeV2(occ, pm, params);
  }
  let out: EvidenceReport = { ...report, method: SEMANTIC_METHOD, occurrences, summary: summarizeOccurrences(occurrences) };
  if (curated) out = applyCurated(curated.graph, out, curated.file).report;
  return out;
}

export const SEMANTIC_METHOD =
  'Rótulos automáticos: sobreposição lexical ponderada (frase que cita × janelas de 1 a 3 frases do PDF da referência, ' +
  'com glossário PT→EN e correspondência aproximada) combinada com a similaridade de um modelo de linguagem multilíngue ' +
  'que roda no seu navegador. "Localizado" indica que há uma passagem muito próxima do que a frase diz, não que ela comprove a afirmação: ' +
  'toda passagem é candidata e precisa de revisão humana.';
