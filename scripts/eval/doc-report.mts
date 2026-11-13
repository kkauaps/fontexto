/**
 * Runs the browser pipeline (CoreStore) on a real document and prints what a user would see: references extracted,
 * citations resolved, the three labels, and (with a curated index.html) the agreement with the human review.
 *
 *   MAIN=paper.pdf [REFS=dir-with-pdfs] [BIB=refs.bib] [GOLD=index.html] [CACHE=dir] [OUT=report.json] \
 *     npx tsx scripts/eval/doc-report.mts
 *
 * Nothing is written to the repository; the documents are read from wherever they are.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CoreStore, MemoryDriver } from '../../src/core/coreStore.ts';
import { pairCurated, parseCuratedIndexHtml } from '../../src/core/curated.ts';
import type { PublicationNode } from '../../src/core/model.ts';
import { extractPdfText } from '../../src/server/pdfText.ts';
import type { PdfText } from '../../src/core/text.ts';

const env = process.env;
if (!env.MAIN) throw new Error('MAIN=paper.pdf is required');
const cacheDir = env.CACHE ?? '/tmp/fontexto-text-cache';
mkdirSync(cacheDir, { recursive: true });
async function cachedText(data: Uint8Array): Promise<PdfText> {
  const key = createHash('sha256').update(data).digest('hex').slice(0, 24);
  const f = path.join(cacheDir, `${key}.json`);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const t = await extractPdfText(data);
  writeFileSync(f, JSON.stringify(t));
  return t;
}

const store = new CoreStore({ driver: new MemoryDriver(), extractText: cachedText });
const p = (await store.createProject('eval', 'eval')).id;
await store.addFile(p, { data: readFileSync(env.MAIN), originalName: path.basename(env.MAIN), role: 'main' });
if (env.BIB) await store.addFile(p, { data: readFileSync(env.BIB), originalName: path.basename(env.BIB) });
const refFiles = env.REFS ? readdirSync(env.REFS).filter((f) => /\.pdf$/i.test(f) && f !== path.basename(env.MAIN!)) : [];
for (const f of refFiles) await store.addFile(p, { data: readFileSync(path.join(env.REFS!, f)), originalName: f, role: 'reference' });
await store.ensureExtracted(p);
let extracted: Awaited<ReturnType<CoreStore['extractReferencesFromMain']>> | undefined;
if (!env.BIB) extracted = await store.extractReferencesFromMain(p);
const graph = await store.rebuild(p);
const ev = await store.getEvidence(p);

const pubs = Object.values(graph.nodes).filter((n): n is PublicationNode => n.kind === 'publication' && n.inMainBibliography);
const linked = new Set(graph.fileLinks.filter((l) => l.status === 'matched' || l.status === 'manual').map((l) => l.publicationId));
const out: Record<string, unknown> = {
  references: extracted ? { entries: extracted.references.length, withAuthorYear: extracted.usable, withTitle: extracted.references.filter((r) => r.title).length, withDoi: extracted.references.filter((r) => r.doi).length } : 'from .bib',
  bibliographyPublications: pubs.length,
  refPdfs: refFiles.length,
  pdfsLinked: graph.fileLinks.filter((l) => l.status === 'matched' || l.status === 'manual').length,
  pdfsUnlinked: graph.fileLinks.filter((l) => !(l.status === 'matched' || l.status === 'manual')).map((l) => graph.files[l.fileId]?.originalName + ' -> ' + l.status),
  pubsWithoutPdf: pubs.filter((x) => !linked.has(x.id) && !x.fileIds.length).map((x) => x.bibtexKey ?? x.title),
  summary: ev.summary,
  reasons: ev.occurrences.reduce<Record<string, number>>((a, o) => ((a[`${o.status}:${o.reason ?? '-'}`] = (a[`${o.status}:${o.reason ?? '-'}`] ?? 0) + 1), a), {}),
};
if (env.GOLD) {
  const curated = parseCuratedIndexHtml(readFileSync(env.GOLD, 'utf8'), 'gold');
  const { pairs } = pairCurated(graph, ev, curated);
  const conf: Record<string, Record<string, number>> = {};
  const falseRessalva: unknown[] = [];
  for (const o of ev.occurrences) {
    const g = pairs.get(o.id);
    if (!g || g.sourceNote) continue;
    (conf[g.status] ??= {})[o.status ?? 'none'] = (conf[g.status][o.status ?? 'none'] ?? 0) + 1;
    if (g.status === 'localizado' && o.status === 'ressalva') falseRessalva.push({ id: o.id, marker: o.marker, score: o.score, reason: o.reason, notes: o.notes, goldPages: g.passages.map((x) => x.page), autoPages: o.passages.map((x) => x.page) });
  }
  const n = Object.values(conf).reduce((s, r) => s + Object.values(r).reduce((a, b) => a + b, 0), 0);
  const agree = ['localizado', 'ressalva', 'nao_localizado'].reduce((s, k) => s + (conf[k]?.[k] ?? 0), 0);
  const autoRessalva = Object.values(conf).reduce((s, r) => s + (r.ressalva ?? 0), 0);
  out.gold = { paired: n, agreement: +(agree / n).toFixed(3), confusion_goldRow_autoCol: conf, ressalvaAuto: autoRessalva, ressalvaWrong: autoRessalva - (conf.ressalva?.ressalva ?? 0), falseRessalvaWhereGoldLocalizado: falseRessalva.length };
  if (env.OUT) writeFileSync(env.OUT.replace(/\.json$/, '.false-ressalva.json'), JSON.stringify(falseRessalva, null, 1));
}
if (env.OUT) writeFileSync(env.OUT, JSON.stringify({ out, references: extracted?.references, occurrences: ev.occurrences.map((o) => ({ id: o.id, marker: o.marker, page: o.page, resolution: o.resolution, pub: o.publicationId, status: o.status, reason: o.reason, score: o.score, notes: o.notes, claim: o.localClaim ?? o.claim })) }, null, 1));
console.log(JSON.stringify(out, null, 1));
