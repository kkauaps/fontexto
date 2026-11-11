import { prepare, candidatesOf } from './lab.mts';
import { MATCH_PARAMS } from '../../src/core/matching.ts';
import fs from 'node:fs';
const items = await prepare();
const mp = { ...MATCH_PARAMS, windowSizes: [1, 2, 3], topK: 24 };
const S: any = { e5: JSON.parse(fs.readFileSync(`${process.env.MODELS_DIR ?? 'models-eval'}/sims-e5.json`, 'utf8')), minilm: JSON.parse(fs.readFileSync(`${process.env.MODELS_DIR ?? 'models-eval'}/sims-minilm.json`, 'utf8')) };
const data = items.map((it) => ({ it, c: candidatesOf(it, mp) })).filter((d) => d.c.length && d.it.gold.pages.size);
const z = (a: number[]) => { const m = a.reduce((x, y) => x + y, 0) / a.length; const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length) || 1; return a.map((v) => (v - m) / sd); };
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const toks = (s: string) => new Set(fold(s).match(/[a-z0-9]{3,}/g) ?? []);
const quoteHit = (text: string, quotes: string[]) => { const t = toks(text); return quotes.some((q) => { const qt = toks(q); if (!qt.size) return false; let n = 0; for (const w of qt) if (t.has(w)) n++; return n / qt.size >= 0.7; }); };
function feats(d: any, useSem: string[]) {
  const { it, c } = d;
  const zl = z(c.map((x: any) => x.lex));
  const sems = useSem.flatMap((m) => [S[m][it.occ.id].sent, S[m][it.occ.id].local]);
  const zs = sems.map(z);
  return c.map((x: any, i: number) => [1, zl[i], x.lex, ...zs.map((a) => a[i]), ...sems.map((a) => a[i]), x.len === 2 ? 1 : 0, x.len === 3 ? 1 : 0, x.region === 'resumo' ? 1 : 0, x.missingNumbers.length ? 1 : 0, Math.log(1 + i) ]);
}
const sig = (v: number) => 1 / (1 + Math.exp(-v));
function train(rows: { f: number[]; y: number }[], l2 = 0.05) {
  const D = rows[0].f.length; const w = new Array(D).fill(0);
  // standardise
  const mu = new Array(D).fill(0), sd = new Array(D).fill(1);
  for (let j = 1; j < D; j++) { mu[j] = rows.reduce((a, r) => a + r.f[j], 0) / rows.length; sd[j] = Math.sqrt(rows.reduce((a, r) => a + (r.f[j] - mu[j]) ** 2, 0) / rows.length) || 1; }
  const X = rows.map((r) => r.f.map((v, j) => (j ? (v - mu[j]) / sd[j] : 1)));
  for (let it = 0; it < 400; it++) {
    const g = new Array(D).fill(0);
    for (let i = 0; i < X.length; i++) { const p = sig(X[i].reduce((a, v, j) => a + v * w[j], 0)); for (let j = 0; j < D; j++) g[j] += (p - rows[i].y) * X[i][j]; }
    for (let j = 0; j < D; j++) w[j] -= (0.5 * (g[j] / X.length + (j ? l2 * w[j] : 0)));
  }
  console.error('w', w.map((v)=>+v.toFixed(2)).join(' '));
  return (f: number[]) => sig(f.reduce((a, v, j) => a + (j ? (v - mu[j]) / sd[j] : 1) * w[j], 0));
}
for (const useSem of [['minilm']]) {
  for (const label of ['page', 'quote']) {
    const res: number[][] = [];
    for (const testFold of [0, 1]) {
      const rows: { f: number[]; y: number }[] = [];
      for (const d of data.filter((d) => d.it.fold !== testFold)) { const F = feats(d, useSem); d.c.forEach((x: any, i: number) => rows.push({ f: F[i], y: (label === 'page' ? d.it.gold.pages.has(x.page) : quoteHit(x.text, d.it.gold.quotes)) ? 1 : 0 })); }
      const bad = rows.find((r) => r.f.some((v) => !Number.isFinite(v))); if (bad) console.error('BAD', bad.f); const model = train(rows);
      let n = 0, p1 = 0, p3 = 0, q1 = 0, q3 = 0;
      for (const d of data.filter((d) => d.it.fold === testFold)) {
        n++; const F = feats(d, useSem); const sc = d.c.map((x: any, i: number) => ({ x, s: model(F[i]) })).sort((a: any, b: any) => b.s - a.s).map((o: any) => o.x);
        if (d.it.gold.pages.has(sc[0].page)) p1++; if (sc.slice(0, 3).some((x: any) => d.it.gold.pages.has(x.page))) p3++;
        if (quoteHit(sc[0].text, d.it.gold.quotes)) q1++; if (sc.slice(0, 3).some((x: any) => quoteHit(x.text, d.it.gold.quotes))) q3++;
      }
      res.push([p1 / n, p3 / n, q1 / n, q3 / n, n]);
    }
    const tot = res[0][4] + res[1][4];
    const avg = [0, 1, 2, 3].map((k) => ((res[0][k] * res[0][4] + res[1][k] * res[1][4]) / tot).toFixed(3));
    console.log(JSON.stringify(useSem).padEnd(18), 'trained on', label.padEnd(5), 'held-out page@1/3, quote@1/3:', avg.join(' '));
  }
}
