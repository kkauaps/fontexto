import { prepare, candidatesOf } from './lab.mts';
import { MATCH_PARAMS } from '../../src/core/matching.ts';
import fs from 'node:fs';
const items = await prepare();
const mp = { ...MATCH_PARAMS, windowSizes: [1, 2, 3], topK: 24 };
const SM: any = JSON.parse(fs.readFileSync(`${process.env.MODELS_DIR ?? 'models-eval'}/sims-minilm.json`, 'utf8'));
const z = (a: number[]) => { const m = a.reduce((x, y) => x + y, 0) / a.length; const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length) || 1; return a.map((v) => (v - m) / sd); };
interface Row { fold: number; goldStatus: string; hit1: boolean; hit3: boolean; lex: number; sem: number; short: boolean; missingNum: boolean; resumo: boolean }
function rows(lamZ: number | null): Row[] {
  const out: Row[] = [];
  for (const it of items) {
    const c = candidatesOf(it, mp);
    const goldStatus = it.gold.status;
    if (!c.length) { out.push({ fold: it.fold, goldStatus, hit1: false, hit3: false, lex: 0, sem: 0, short: true, missingNum: false, resumo: false }); continue; }
    const sims = SM[it.occ.id]; const sem = c.map((_, i) => (sims.sent[i] + sims.local[i]) / 2);
    const zl = z(c.map((x) => x.lex)); const zs = z(sem);
    const rk = c.map((x, i) => ({ x, i, r: lamZ === null ? x.lex : (1 - lamZ) * zl[i] + lamZ * zs[i] })).sort((a, b) => b.r - a.r);
    const hit = (k: number) => rk.slice(0, k).some((o) => it.gold.pages.has(o.x.page));
    out.push({ fold: it.fold, goldStatus, hit1: hit(1), hit3: hit(3), lex: rk[0].x.lex, sem: sem[rk[0].i], short: false, missingNum: rk[0].x.missingNumbers.length > 0, resumo: rk[0].x.region === 'resumo' });
  }
  return out;
}
const label = (r: Row, f: (r: Row) => number, strong: number, weak: number, numbers: boolean) => { if (r.short) return 'nao_localizado'; const s = f(r); if (s < weak) return 'nao_localizado'; if (s >= strong && !(numbers && r.missingNum) && !r.resumo) return 'localizado'; return 'ressalva'; };
const CLS = ['localizado', 'ressalva', 'nao_localizado'];
function evalSet(rs: Row[], f: (r: Row) => number, strong: number, weak: number, numbers: boolean) {
  const conf: any = {}; for (const a of CLS) { conf[a] = {}; for (const b of CLS) conf[a][b] = 0; }
  for (const r of rs) conf[r.goldStatus][label(r, f, strong, weak, numbers)]++;
  const rec = CLS.map((c) => { const t = CLS.reduce((a, b) => a + conf[c][b], 0); return t ? conf[c][c] / t : NaN; }).filter((x) => !isNaN(x));
  const bal = rec.reduce((a, b) => a + b, 0) / rec.length;
  const agree = CLS.reduce((a, c) => a + conf[c][c], 0) / rs.length;
  const predLoc = rs.filter((r) => label(r, f, strong, weak, numbers) === 'localizado');
  const precHit = predLoc.length ? predLoc.filter((r) => r.hit3).length / predLoc.length : 0;
  const locP = predLoc.length ? predLoc.filter((r) => r.goldStatus === 'localizado').length / predLoc.length : 0;
  const locR = conf.localizado.localizado / rs.filter((r) => r.goldStatus === 'localizado').length;
  return { bal, agree, locP, locR, precHit, conf, nLoc: predLoc.length };
}
function fit(rs: Row[], mk: (p: number[]) => (r: Row) => number, grid: number[][], numbers: boolean) {
  let best: any;
  const thr = [...Array(40)].map((_, i) => 0.05 + i * 0.015);
  for (const p of grid) { const f = mk(p); for (const weak of thr) for (const strong of thr) { if (strong < weak) continue; const e = evalSet(rs, f, strong, weak, numbers); const obj = e.bal; if (!best || obj > best.obj) best = { obj, p, strong, weak }; } }
  return best;
}
const variants: [string, number | null, (p: number[]) => (r: Row) => number, number[][]][] = [
  ['lexical-only (v2)', null, () => (r) => r.lex, [[0]]],
  ['lex+minilm', 0.5, ([lam, fl, ce]) => (r) => (1 - lam) * r.lex + lam * Math.min(1, Math.max(0, (r.sem - fl) / (ce - fl))), [0.3, 0.5, 0.7].flatMap((l) => [0.2, 0.35, 0.5].flatMap((f) => [0.7, 0.85].map((c) => [l, f, c])))],
];
for (const [name, lamZ, mk, grid] of variants) {
  const all = rows(lamZ);
  const cv: any[] = [];
  for (const test of [0, 1]) {
    const tr = all.filter((r) => r.fold !== test), te = all.filter((r) => r.fold === test);
    const b = fit(tr, mk, grid, false);
    const e = evalSet(te, mk(b.p), b.strong, b.weak, false);
    cv.push({ n: te.length, ...e, params: b });
  }
  const tot = cv.reduce((a, c) => a + c.n, 0); const avg = (k: string) => cv.reduce((a, c) => a + c[k] * c.n, 0) / tot;
  console.log(name, 'HELD-OUT balAcc', avg('bal').toFixed(3), 'agree', avg('agree').toFixed(3), 'locP', avg('locP').toFixed(3), 'locR', avg('locR').toFixed(3), 'top3hit among localizado', avg('precHit').toFixed(3));
  console.log('  folds params', cv.map((c) => JSON.stringify({ p: c.params.p, s: +c.params.strong.toFixed(3), w: +c.params.weak.toFixed(3) })).join(' | '));
  const bAll = fit(all, mk, grid, false); const eAll = evalSet(all, mk(bAll.p), bAll.strong, bAll.weak, false);
  console.log('  ALL-DATA fit', JSON.stringify({ p: bAll.p, strong: +bAll.strong.toFixed(3), weak: +bAll.weak.toFixed(3) }), 'bal', eAll.bal.toFixed(3), 'agree', eAll.agree.toFixed(3), JSON.stringify(eAll.conf));
}
