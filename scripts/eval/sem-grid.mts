import { prepare, candidatesOf, type Item } from './lab.mts';
import { MATCH_PARAMS } from '../../src/core/matching.ts';
import { makeEmbedder, cosine, type ModelName } from './nodeEmbed.mts';
import fs from 'node:fs';

const model = (process.argv[2] ?? 'e5') as ModelName;
const items = await prepare();
const mp = { ...MATCH_PARAMS, windowSizes: [1, 2, 3], topK: 24 };
const emb = await makeEmbedder(model);
// gather all texts
const data = items.map((it) => ({ it, c: candidatesOf(it, mp) }));
const claims = new Set<string>();
const passages = new Set<string>();
for (const { it, c } of data) {
  claims.add(it.occ.claim);
  if (it.occ.localClaim) claims.add(it.occ.localClaim);
  for (const x of c) passages.add(x.text);
}
console.error('claims', claims.size, 'passages', passages.size);
const cl = [...claims]; const ps = [...passages];
const cv = await emb.embed(cl, 'q'); const pv = await emb.embed(ps, 'p');
const cmap = new Map(cl.map((t, i) => [t, cv[i]])); const pmap = new Map(ps.map((t, i) => [t, pv[i]]));
// persist sims for the fusion lab
const sims: Record<string, { sent: number[]; local: number[] }> = {};
for (const { it, c } of data) {
  sims[it.occ.id] = {
    sent: c.map((x) => cosine(cmap.get(it.occ.claim)!, pmap.get(x.text)!)),
    local: c.map((x) => (it.occ.localClaim ? cosine(cmap.get(it.occ.localClaim)!, pmap.get(x.text)!) : cosine(cmap.get(it.occ.claim)!, pmap.get(x.text)!))),
  };
}
fs.writeFileSync(`${process.env.MODELS_DIR ?? 'models-eval'}/sims-${model}.json`, JSON.stringify(sims));
const metrics = (rank: (it: Item, c: any[], i: number) => number) => {
  let n = 0, h1 = 0, h3 = 0;
  for (const { it, c } of data) {
    if (!it.gold.pages.size) continue;
    n++;
    const order = c.map((x, i) => ({ x, s: rank(it, c, i) })).sort((a, b) => b.s - a.s).map((o) => o.x);
    if (order[0] && it.gold.pages.has(order[0].page)) h1++;
    if (order.slice(0, 3).some((x) => it.gold.pages.has(x.page))) h3++;
  }
  return { n, top1: +(h1 / n).toFixed(3), top3: +(h3 / n).toFixed(3) };
};
console.log(model, 'lex only', metrics((it, c, i) => c[i].lex));
console.log(model, 'sem sent', metrics((it, c, i) => sims[it.occ.id].sent[i]));
console.log(model, 'sem local', metrics((it, c, i) => sims[it.occ.id].local[i]));
console.log(model, 'sem max', metrics((it, c, i) => Math.max(sims[it.occ.id].sent[i], sims[it.occ.id].local[i])));
console.log(model, 'sem avg', metrics((it, c, i) => (sims[it.occ.id].sent[i] + sims[it.occ.id].local[i]) / 2));
