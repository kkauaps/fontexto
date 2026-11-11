import { loadGold } from './gold.mts';
import { computeEvidence } from '../../src/core/evidence.ts';

const g = await loadGold();
const rep = computeEvidence({ projectId: 'demo', now: '2026-01-01T00:00:00Z', graph: g.graph, texts: g.texts });
let n = 0, h1 = 0, h3 = 0, withGoldPages = 0;
const conf: Record<string, Record<string, number>> = {};
for (const o of rep.occurrences) {
  const gd = g.gold.get(o.id);
  if (!gd || !o.referenceFileId) continue;
  n++;
  const gs = gd.status;
  conf[gs] ??= {};
  const as = o.status ?? 'none';
  conf[gs][as] = (conf[gs][as] ?? 0) + 1;
  if (gd.pages.size) {
    withGoldPages++;
    if (o.passages[0] && gd.pages.has(o.passages[0].page)) h1++;
    if (o.passages.slice(0, 3).some((p) => gd.pages.has(p.page))) h3++;
  }
}
console.log({ n, withGoldPages, top1: h1 / withGoldPages, top3: h3 / withGoldPages });
console.log(conf);
