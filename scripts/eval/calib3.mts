import { prepare, candidatesOf } from './lab.mts';
import { MATCH_PARAMS } from '../../src/core/matching.ts';
import fs from 'node:fs';
const items = await prepare();
const mp = { ...MATCH_PARAMS, windowSizes: [1, 2, 3], topK: 24 };
const SM: any = JSON.parse(fs.readFileSync(`${process.env.MODELS_DIR ?? 'models-eval'}/sims-minilm.json`, 'utf8'));
const z = (a: number[]) => { const m = a.reduce((x, y) => x + y, 0) / a.length; const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length) || 1; return a.map((v) => (v - m) / sd); };
interface Row { fold: number; gold: string; hit3: boolean; lex: number; sem: number; short: boolean; missing: boolean; resumo: boolean }
function build(): Row[] {
  return items.map((it) => {
    const c = candidatesOf(it, mp);
    if (!c.length) return { fold: it.fold, gold: it.gold.status, hit3: false, lex: 0, sem: 0, short: true, missing: false, resumo: false };
    const sims = SM[it.occ.id]; const sem = c.map((_, i) => (sims.sent[i] + sims.local[i]) / 2);
    const zl = z(c.map((x) => x.lex)), zs = z(sem);
    const rk = c.map((x, i) => ({ x, i, r: 0.5 * zl[i] + 0.5 * zs[i] })).sort((a, b) => b.r - a.r);
    return { fold: it.fold, gold: it.gold.status, hit3: rk.slice(0, 3).some((o) => it.gold.pages.has(o.x.page)), lex: rk[0].x.lex, sem: sem[rk[0].i], short: false, missing: rk[0].x.missingNumbers.length > 0, resumo: rk[0].x.region === 'resumo' };
  });
}
const rows = build();
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
const make = (lam: number, fl: number, ce: number) => (r: Row) => (1 - lam) * r.lex + lam * Math.min(1, Math.max(0, (r.sem - fl) / (ce - fl)));
function f1loc(rs: Row[], sc: (r: Row) => number, t: number) { let tp = 0, fp = 0, fn = 0; for (const r of rs) { const pred = !r.short && sc(r) >= t; const g = r.gold === 'localizado'; if (pred && g) tp++; else if (pred) fp++; else if (g) fn++; } return { f1: (2 * tp) / Math.max(1, 2 * tp + fp + fn), p: tp / Math.max(1, tp + fp), r: tp / Math.max(1, tp + fn) }; }
for (const [name, lam] of [['lex only', 0], ['lex+minilm .5', 0.5], ['lex+minilm .7', 0.7]] as const) {
  const sc = make(lam, 0.3, 0.8);
  const res: any[] = [];
  for (const test of [0, 1]) {
    const tr = rows.filter((r) => r.fold !== test), te = rows.filter((r) => r.fold === test);
    const verified = tr.filter((r) => !r.short && r.gold !== 'nao_localizado').map(sc);
    const weak = pct(verified, 0.05);
    let best = { t: 0, f1: -1 }; for (let t = 0.02; t < 0.9; t += 0.01) { const e = f1loc(tr, sc, t); if (e.f1 > best.f1) best = { t, f1: e.f1 }; }
    const e = f1loc(te, sc, best.t);
    const cnt = { localizado: 0, ressalva: 0, nao_localizado: 0 }; let agree = 0, hitLoc = [0, 0];
    for (const r of te) { const s = sc(r); const l = r.short || s < weak ? 'nao_localizado' : s >= best.t ? 'localizado' : 'ressalva'; (cnt as any)[l]++; if (l === r.gold) agree++; if (l === 'localizado') { hitLoc[1]++; if (r.hit3) hitLoc[0]++; } }
    res.push({ n: te.length, weak: +weak.toFixed(3), strong: +best.t.toFixed(2), ...e, cnt, agree: agree / te.length, hit: hitLoc });
  }
  console.log(name); for (const r of res) console.log('  fold', JSON.stringify(r));
}
console.log('--- PR curve (lex+minilm .5), all data');
{ const sc = make(0.5, 0.3, 0.8); for (let t = 0.1; t <= 0.6; t += 0.05) { const e = f1loc(rows, sc, t); const share = rows.filter((r) => !r.short && sc(r) >= t).length / rows.length; console.log(t.toFixed(2), 'share', share.toFixed(2), 'P', e.p.toFixed(2), 'R', e.r.toFixed(2)); } }
console.log('--- PR curve lex only');
{ const sc = make(0, 0.3, 0.8); for (let t = 0.1; t <= 0.6; t += 0.05) { const e = f1loc(rows, sc, t); const share = rows.filter((r) => !r.short && sc(r) >= t).length / rows.length; console.log(t.toFixed(2), 'share', share.toFixed(2), 'P', e.p.toFixed(2), 'R', e.r.toFixed(2)); } }
