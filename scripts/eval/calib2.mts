import { prepare, candidatesOf } from './lab.mts';
import { MATCH_PARAMS } from '../../src/core/matching.ts';
import fs from 'node:fs';
const items = await prepare();
const mp = { ...MATCH_PARAMS, windowSizes: [1, 2, 3], topK: 24 };
const SM: any = JSON.parse(fs.readFileSync(`${process.env.MODELS_DIR ?? 'models-eval'}/sims-minilm.json`, 'utf8'));
const z = (a: number[]) => { const m = a.reduce((x, y) => x + y, 0) / a.length; const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length) || 1; return a.map((v) => (v - m) / sd); };
const sig = (v: number) => 1 / (1 + Math.exp(-v));
interface Row { fold: number; gold: string; hit1: boolean; hit3: boolean; f: number[]; short: boolean }
const LAMZ = 0.5;
function build(useSem: boolean): Row[] {
  return items.map((it) => {
    const c = candidatesOf(it, mp);
    if (!c.length) return { fold: it.fold, gold: it.gold.status, hit1: false, hit3: false, f: [], short: true };
    const sims = SM[it.occ.id]; const sem = c.map((_, i) => (sims.sent[i] + sims.local[i]) / 2);
    const zl = z(c.map((x) => x.lex)), zs = z(sem);
    const rk = c.map((x, i) => ({ x, i, r: useSem ? (1 - LAMZ) * zl[i] + LAMZ * zs[i] : x.lex })).sort((a, b) => b.r - a.r);
    const hit = (k: number) => rk.slice(0, k).some((o) => it.gold.pages.has(o.x.page));
    const t = rk[0]; const semN = Math.min(1, Math.max(0, (sem[t.i] - 0.3) / 0.5));
    const second = rk[1]?.x.lex ?? 0;
    const f = useSem ? [1, t.x.lex, semN, t.x.missingNumbers.length ? 1 : 0, t.x.region === 'resumo' ? 1 : 0] : [1, t.x.lex, t.x.missingNumbers.length ? 1 : 0, t.x.region === 'resumo' ? 1 : 0];
    return { fold: it.fold, gold: it.gold.status, hit1: hit(1), hit3: hit(3), f, short: false };
  });
}
function fitLR(rows: Row[], target: 'hit3' | 'hit1', l2 = 0.02) {
  const R = rows.filter((r) => !r.short); const D = R[0].f.length; const w = new Array(D).fill(0);
  for (let it = 0; it < 3000; it++) { const g = new Array(D).fill(0); for (const r of R) { const p = sig(r.f.reduce((a, v, j) => a + v * w[j], 0)); const y = r[target] ? 1 : 0; for (let j = 0; j < D; j++) g[j] += (p - y) * r.f[j]; } for (let j = 0; j < D; j++) w[j] -= 0.3 * (g[j] / R.length + (j ? l2 * w[j] : 0)); }
  return w;
}
const prob = (w: number[], r: Row) => (r.short ? 0 : sig(r.f.reduce((a, v, j) => a + v * w[j], 0)));
const auc = (rs: Row[], w: number[]) => { const pos = rs.filter((r) => r.hit3), neg = rs.filter((r) => !r.hit3); let s = 0; for (const a of pos) for (const b of neg) s += prob(w, a) > prob(w, b) ? 1 : prob(w, a) === prob(w, b) ? 0.5 : 0; return s / (pos.length * neg.length); };
function report(name: string, rs: Row[], w: number[], strong: number, weak: number) {
  const lab = (r: Row) => { const p = prob(w, r); return p >= strong ? 'localizado' : p >= weak ? 'ressalva' : 'nao_localizado'; };
  const cnt: any = { localizado: 0, ressalva: 0, nao_localizado: 0 }; const hit: any = { localizado: [0, 0], ressalva: [0, 0], nao_localizado: [0, 0] }; const conf: any = {};
  for (const r of rs) { const l = lab(r); cnt[l]++; hit[l][1]++; if (r.hit3) hit[l][0]++; (conf[r.gold] ??= {})[l] = ((conf[r.gold] ??= {})[l] ?? 0) + 1; }
  const agree = ['localizado', 'ressalva', 'nao_localizado'].reduce((a, c) => a + (conf[c]?.[c] ?? 0), 0) / rs.length;
  console.log(name, 'counts', JSON.stringify(cnt), 'page-in-top3 rate per label', Object.entries(hit).map(([k, v]: any) => `${k}:${(v[0] / Math.max(1, v[1])).toFixed(2)}`).join(' '), 'agree w/ gold status', agree.toFixed(3));
  const locP = (conf.localizado?.localizado ?? 0) / Math.max(1, cnt.localizado); const goldLoc = Object.values(conf.localizado ?? {}).reduce((a: any, b: any) => a + b, 0) as number;
  console.log('   gold-localizado precision', locP.toFixed(3), 'recall', ((conf.localizado?.localizado ?? 0) / goldLoc).toFixed(3), JSON.stringify(conf));
}
for (const useSem of [false, true]) {
  const rows = build(useSem); const name = useSem ? 'lex+minilm' : 'lexical v2';
  const cvAuc: number[] = [];
  for (const test of [0, 1]) { const w = fitLR(rows.filter((r) => r.fold !== test), 'hit3'); cvAuc.push(auc(rows.filter((r) => r.fold === test && !r.short), w)); }
  console.log(name, 'held-out AUC(top3 page hit)', cvAuc.map((x) => x.toFixed(3)).join(' '));
  for (const [s, wk] of [[0.8, 0.5], [0.75, 0.45], [0.7, 0.4], [0.65, 0.35]]) {
    // held-out report: pool both folds, each scored by the model fit on the other
    const pooled: Row[] = []; const ws: number[][] = [];
    const wTest: Record<number, number[]> = { 0: fitLR(rows.filter((r) => r.fold !== 0), 'hit3'), 1: fitLR(rows.filter((r) => r.fold !== 1), 'hit3') };
    const lab = (r: Row) => { const p = prob(wTest[r.fold], r); return p >= s ? 'localizado' : p >= wk ? 'ressalva' : 'nao_localizado'; };
    const cnt: any = { localizado: 0, ressalva: 0, nao_localizado: 0 }, hit: any = { localizado: [0, 0], ressalva: [0, 0], nao_localizado: [0, 0] };
    let agree = 0; for (const r of rows) { const l = lab(r); cnt[l]++; hit[l][1]++; if (r.hit3) hit[l][0]++; if (l === r.gold) agree++; }
    console.log(`  held-out strong=${s} weak=${wk}`, JSON.stringify(cnt), Object.entries(hit).map(([k, v]: any) => `${k}:${(v[0] / Math.max(1, v[1])).toFixed(2)}`).join(' '), 'agree', (agree / rows.length).toFixed(3));
  }
  const w = fitLR(rows, 'hit3'); console.log('  all-data weights', JSON.stringify(w.map((x) => +x.toFixed(3))), 'top1/top3', (rows.filter((r) => r.hit1).length / rows.length).toFixed(3), (rows.filter((r) => r.hit3).length / rows.length).toFixed(3));
}
