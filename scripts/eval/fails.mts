import { loadGold } from './gold.mts';
import { computeEvidence } from '../../src/core/evidence.ts';
const g = await loadGold();
const rep = computeEvidence({ projectId: 'demo', now: '2026-01-01T00:00:00Z', graph: g.graph, texts: g.texts });
let shown = 0;
for (const o of rep.occurrences) {
  const gd = g.gold.get(o.id);
  if (!gd || !o.referenceFileId || !gd.pages.size) continue;
  if (o.passages.slice(0, 3).some((p) => gd.pages.has(p.page))) continue;
  if (shown++ % 6) continue;
  console.log('---', o.marker, 'gold', gd.status, [...gd.pages], '| auto', o.status, o.score);
  console.log('CLAIM:', o.claim.slice(0, 300));
  console.log('GOLD :', gd.quotes[0]?.slice(0, 300));
  console.log('AUTO :', o.passages[0]?.page, o.passages[0]?.text.slice(0, 200));
}
