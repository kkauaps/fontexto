// End-to-end evaluation of the shipped matcher against the curated gold set (page hit rates + status agreement).
import { loadGold } from './gold.mts';
import { computeEvidence, EVIDENCE_PARAMS, type PendingMatch, type CitationOccurrence } from '../../src/core/evidence.ts';
import { planSemantic, applySemantic } from '../../src/core/semantic.ts';
import { makeEmbedder } from './nodeEmbed.mts';

const g = await loadGold();
const mode = process.argv[2] ?? 'all';
const base = (matcher: 'v1' | 'v2') => {
  const pend = new Map<string, PendingMatch>();
  const report = computeEvidence({ projectId: 'x', now: '2026-01-01T00:00:00Z', graph: g.graph, texts: g.texts, params: { matcher }, onPending: (pm) => pend.set(pm.occId, pm) });
  return { report, pend };
};
function score(name: string, occs: CitationOccurrence[]) {
  let n = 0, h1 = 0, h3 = 0;
  const conf: Record<string, Record<string, number>> = {};
  for (const o of occs) {
    const gd = g.gold.get(o.id);
    if (!gd || !o.referenceFileId) continue;
    n++;
    (conf[gd.status] ??= {})[o.status ?? '-'] = ((conf[gd.status] ??= {})[o.status ?? '-'] ?? 0) + 1;
    if (!gd.pages.size) continue;
    if (o.passages[0] && gd.pages.has(o.passages[0].page)) h1++;
    if (o.passages.slice(0, 3).some((p) => gd.pages.has(p.page))) h3++;
  }
  const withPages = [...g.gold.values()].filter((x) => x.pages.size).length;
  const L = conf.localizado ?? {}, R = conf.ressalva ?? {}, N = conf.nao_localizado ?? {};
  const c = (m: any, k: string) => m[k] ?? 0;
  const agree = (c(L, 'localizado') + c(R, 'ressalva') + c(N, 'nao_localizado')) / n;
  const predLoc = c(L, 'localizado') + c(R, 'localizado') + c(N, 'localizado');
  const goldLoc = Object.values(L).reduce((a, b) => a + b, 0);
  const out = { name, n, top1: +(h1 / withPages).toFixed(3), top3: +(h3 / withPages).toFixed(3), agree3class: +agree.toFixed(3), localizado: { predicted: predLoc, precision: +(c(L, 'localizado') / Math.max(1, predLoc)).toFixed(3), recall: +(c(L, 'localizado') / goldLoc).toFixed(3) }, conf };
  console.log(JSON.stringify(out));
  return out;
}
if (mode === 'all' || mode === 'lex') {
  score('v1 (baseline)', base('v1').report.occurrences);
  score('v2 lexical', base('v2').report.occurrences);
}
if (mode === 'all' || mode === 'sem') {
  const { report, pend } = base('v2');
  const model = (process.env.MODEL ?? 'minilm') as 'minilm' | 'e5';
  const emb = await makeEmbedder(model);
  const plan = planSemantic(pend.values(), new Map(report.occurrences.map((o) => [o.id, o])));
  const cv = await emb.embed(plan.claims, 'q'), pv = await emb.embed(plan.passages, 'p');
  const out = applySemantic(report, pend, plan, cv.map((v) => Float32Array.from(v)), pv.map((v) => Float32Array.from(v)), { ...EVIDENCE_PARAMS });
  score(`v2 + ${model} semantic`, out.occurrences);
  console.log('summary', JSON.stringify(out.summary));
}
