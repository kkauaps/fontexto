import { prepare, candidatesOf } from './lab.mts';
import { MATCH_PARAMS } from '../../src/core/matching.ts';
import fs from 'node:fs';
const items = await prepare();
const mp = { ...MATCH_PARAMS, windowSizes: [1, 2, 3], topK: 24 };
const S: any = { e5: JSON.parse(fs.readFileSync(`${process.env.MODELS_DIR ?? 'models-eval'}/sims-e5.json`, 'utf8')), minilm: JSON.parse(fs.readFileSync(`${process.env.MODELS_DIR ?? 'models-eval'}/sims-minilm.json`, 'utf8')) };
const data = items.map((it) => ({ it, c: candidatesOf(it, mp) }));
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const toks = (s: string) => new Set(fold(s).match(/[a-z0-9]{3,}/g) ?? []);
const quoteHit = (text: string, quotes: string[]) => { const t = toks(text); return quotes.some((q) => { const qt = toks(q); if (!qt.size) return false; let n = 0; for (const w of qt) if (t.has(w)) n++; return n / qt.size >= 0.7; }); };
// recall of quote in 24 cands
let n = 0, rec = 0, recPage = 0;
for (const { it, c } of data) { if (!it.gold.quotes.length) continue; n++; if (c.some((x) => quoteHit(x.text, it.gold.quotes))) rec++; if (c.some((x) => it.gold.pages.has(x.page))) recPage++; }
console.log('quote recall@24', (rec / n).toFixed(3), 'page recall@24', (recPage / n).toFixed(3), n);
const z = (a: number[]) => { const m = a.reduce((x, y) => x + y, 0) / a.length; const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length) || 1; return a.map((v) => (v - m) / sd); };
function run(label: string, f: (it: any, c: any[]) => number[]) {
  let n = 0, p1 = 0, p3 = 0, q1 = 0, q3 = 0;
  for (const { it, c } of data) {
    if (!it.gold.pages.size) continue; n++;
    if (!c.length) continue;
    const sc = f(it, c);
    const order = c.map((x, i) => ({ x, s: sc[i] })).sort((a, b) => b.s - a.s).map((o) => o.x);
    if (it.gold.pages.has(order[0].page)) p1++;
    if (order.slice(0, 3).some((x) => it.gold.pages.has(x.page))) p3++;
    if (quoteHit(order[0].text, it.gold.quotes)) q1++;
    if (order.slice(0, 3).some((x) => quoteHit(x.text, it.gold.quotes))) q3++;
  }
  console.log(label.padEnd(34), 'page', (p1 / n).toFixed(3), (p3 / n).toFixed(3), ' quote', (q1 / n).toFixed(3), (q3 / n).toFixed(3));
}
run('lex', (it, c) => c.map((x) => x.lex));
run('minilm sent', (it, c) => S.minilm[it.occ.id].sent);
run('minilm z .5 + lex', (it, c) => { const l = z(c.map((x) => x.lex)); const s = z(S.minilm[it.occ.id].sent); return l.map((v, i) => 0.5 * v + 0.5 * s[i]); });
run('both z .5 + lex', (it, c) => { const l = z(c.map((x) => x.lex)); const parts = [S.e5[it.occ.id].sent, S.e5[it.occ.id].local, S.minilm[it.occ.id].sent, S.minilm[it.occ.id].local].map(z); return l.map((v, i) => 0.5 * v + 0.5 * parts.reduce((a, p) => a + p[i], 0) / 4); });
