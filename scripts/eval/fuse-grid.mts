import { prepare, candidatesOf } from './lab.mts';
import { MATCH_PARAMS } from '../../src/core/matching.ts';
import fs from 'node:fs';
const items = await prepare();
const mp = { ...MATCH_PARAMS, windowSizes: [1, 2, 3], topK: 24 };
const S: Record<string, any> = { e5: JSON.parse(fs.readFileSync(`${process.env.MODELS_DIR ?? 'models-eval'}/sims-e5.json`, 'utf8')), minilm: JSON.parse(fs.readFileSync(`${process.env.MODELS_DIR ?? 'models-eval'}/sims-minilm.json`, 'utf8')) };
const data = items.map((it) => ({ it, c: candidatesOf(it, mp) }));
const z = (a: number[]) => { const m = a.reduce((x, y) => x + y, 0) / a.length; const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length) || 1; return a.map((v) => (v - m) / sd); };
const mm = (a: number[]) => { const lo = Math.min(...a), hi = Math.max(...a); return a.map((v) => (v - lo) / (hi - lo || 1)); };
function run(label: string, f: (it: any, c: any[]) => number[]) {
  let n = 0, h1 = 0, h3 = 0;
  for (const { it, c } of data) {
    if (!it.gold.pages.size) continue; n++;
    if (!c.length) continue;
    const sc = f(it, c);
    const order = c.map((x, i) => ({ x, s: sc[i] })).sort((a, b) => b.s - a.s).map((o) => o.x);
    if (it.gold.pages.has(order[0].page)) h1++;
    if (order.slice(0, 3).some((x) => it.gold.pages.has(x.page))) h3++;
  }
  console.log(label.padEnd(40), (h1 / n).toFixed(3), (h3 / n).toFixed(3));
}
for (const model of ['e5', 'minilm']) {
  for (const src of ['sent', 'local']) {
    for (const lam of [0.3, 0.5, 0.7]) {
      run(`${model} ${src} z lam=${lam}`, (it, c) => { const lx = z(c.map((x) => x.lex)); const sm = z(S[model][it.occ.id][src]); return lx.map((v, i) => (1 - lam) * v + lam * sm[i]); });
    }
  }
}
for (const lam of [0.3, 0.5, 0.7]) run(`both models sent+local z lam=${lam}`, (it, c) => { const lx = z(c.map((x) => x.lex)); const parts = [S.e5[it.occ.id].sent, S.e5[it.occ.id].local, S.minilm[it.occ.id].sent, S.minilm[it.occ.id].local].map(z); return lx.map((v, i) => (1 - lam) * v + lam * (parts.reduce((a, p) => a + p[i], 0) / 4)); });
