/**
 * Curated (human-reviewed) citation evidence.
 *
 * The automatic matcher is lexical and conservative. A researcher who already reviewed every citation by hand
 * (page + quoted passage + verdict) can import that review; the imported evidence then replaces the automatic
 * verdict for the matching occurrences, is marked as "curadoria" in the UI and keeps the automatic verdict
 * next to it for comparison. Nothing here is generated: statuses, pages and passage texts come from the file.
 *
 * Supported sources: a JSON file in the `CuratedFile` format, or the interactive `index.html` produced for a
 * previous run (it embeds the data as `<script type="application/json" id="cit-data">`).
 *
 * Occurrences are paired with items by bibliography key and document order (the n-th citation of a key in the
 * article is the n-th item of that key). When the counts differ for a key, items are paired greedily by sentence
 * similarity instead, and anything below the similarity floor is left to the automatic matcher.
 */
import type { CitationOccurrence, EvidenceReason, EvidenceReport, EvidenceStatus, Passage } from './evidence.js';
import { summarizeOccurrences } from './evidence.js';
import type { CitationGraph, PublicationNode } from './model.js';

export interface CuratedPassage {
  /** 1-based physical PDF page. */
  page: number;
  text: string;
  region: 'corpo' | 'resumo';
}

export interface CuratedItem {
  /** Bibliography key (BibTeX) of the cited work. */
  key: string;
  status: EvidenceStatus;
  notes: string[];
  passages: CuratedPassage[];
  /** Citing sentence, only used to double-check the pairing. */
  sentence?: string;
  /** Table source note ("Fonte: ..."): support lives in the table rows. */
  sourceNote?: boolean;
}

export interface CuratedFile {
  version: 1;
  /** Human label of where the evidence comes from, e.g. "index.html (demo thesis)". */
  source: string;
  importedAt: string;
  items: CuratedItem[];
}

export interface CuratedApplyResult {
  items: number;
  applied: number;
  unmatchedItems: number;
  keysWithDifferentCounts: string[];
  lowSimilarity: number;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = (s: string) => new Set(fold(s).match(/[a-z0-9]{4,}/g) ?? []);
export function jaccard(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  let n = 0;
  for (const w of x) if (y.has(w)) n++;
  return n / (x.size + y.size - n);
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const SENT_SPLIT = /(?<=[\p{L}\d)\]%][.!?])\s+(?=\p{Lu})/u;

interface IndexRow {
  id: string;
  key: string;
  status: string;
  notes?: string[];
  quotes?: { page: number | null; text: string; region?: string }[];
}

/** Extracts the curated evidence embedded in an interactive index.html. */
export function parseCuratedIndexHtml(html: string, source: string, now = new Date().toISOString()): CuratedFile {
  const m = /<script type="application\/json" id="cit-data">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error('Este HTML não traz os dados das citações (bloco "cit-data").');
  const rows = JSON.parse(m[1]) as IndexRow[];
  if (!Array.isArray(rows)) throw new Error('Dados das citações em formato inesperado.');
  const sentences = new Map<string, string>();
  for (const a of html.matchAll(/data-id="(c\d+)"/g)) {
    const at = a.index ?? 0;
    const open = Math.max(html.lastIndexOf('<p', at), html.lastIndexOf('<td', at), html.lastIndexOf('<li', at));
    const closeCandidates = ['</p>', '</td>', '</li>'].map((t) => html.indexOf(t, at)).filter((i) => i >= 0);
    const close = closeCandidates.length ? Math.min(...closeCandidates) : html.length;
    const left = html.slice(Math.max(0, open), at).replace(/<[^>]+>/g, '');
    const right = html.slice(at, close).replace(/<[^>]+>/g, '');
    sentences.set(a[1], decode(`${left.split(SENT_SPLIT).pop() ?? ''} ${right.split(SENT_SPLIT)[0] ?? ''}`));
  }
  const items: CuratedItem[] = rows.map((r) => {
    const passages: CuratedPassage[] = (r.quotes ?? [])
      .filter((q) => q.page && q.page > 0 && q.text)
      .map((q) => ({ page: q.page as number, text: q.text, region: q.region === 'resumo' ? 'resumo' : 'corpo' }));
    const sourceNote = r.status === 'fonte';
    const status: EvidenceStatus = r.status === 'part' ? 'ressalva' : r.status === 'ok' ? 'localizado' : sourceNote ? (passages.length ? 'localizado' : 'nao_localizado') : 'nao_localizado';
    return { key: r.key, status, notes: r.notes ?? [], passages, sentence: sentences.get(r.id), sourceNote };
  });
  return { version: 1, source, importedAt: now, items };
}

export function parseCuratedJson(text: string): CuratedFile {
  const d = JSON.parse(text) as CuratedFile;
  if (!d || d.version !== 1 || !Array.isArray(d.items)) throw new Error('JSON de curadoria inválido (esperado version 1 e items).');
  for (const it of d.items) if (!it.key || !['localizado', 'ressalva', 'nao_localizado'].includes(it.status)) throw new Error(`Item de curadoria inválido: ${JSON.stringify(it).slice(0, 80)}`);
  return d;
}

/** Accepts either format by sniffing the content. */
export function parseCuratedUpload(text: string, name: string, now?: string): CuratedFile {
  const t = text.trimStart();
  if (t.startsWith('{')) return parseCuratedJson(text);
  return parseCuratedIndexHtml(text, name, now);
}

const bibKeyOf = (graph: CitationGraph, o: CitationOccurrence): string | undefined => {
  const pub = o.publicationId ? (graph.nodes[o.publicationId] as PublicationNode | undefined) : undefined;
  return pub?.bibKeys?.[0];
};

/** Pairs occurrences with curated items. Returns occurrence id -> item. */
export function pairCurated(graph: CitationGraph, report: Pick<EvidenceReport, 'occurrences'>, curated: CuratedFile) {
  const occByKey = new Map<string, CitationOccurrence[]>();
  for (const o of report.occurrences) {
    if (o.resolution !== 'resolved') continue;
    const k = bibKeyOf(graph, o);
    if (k) occByKey.set(k, [...(occByKey.get(k) ?? []), o]);
  }
  const itemsByKey = new Map<string, CuratedItem[]>();
  for (const it of curated.items) itemsByKey.set(it.key, [...(itemsByKey.get(it.key) ?? []), it]);
  // The review may use other BibTeX keys than this project's .bib ("oquab2024dinov2" vs "oquab2024"): map each
  // curated key to the project's key with the same author+year stem, when that is unambiguous.
  const stem = (k: string) => /^[a-z]+\d{4}/.exec(k.toLowerCase())?.[0];
  const aliasOf = new Map<string, string>();
  for (const key of itemsByKey.keys()) {
    if (occByKey.has(key)) continue;
    const st = stem(key);
    const cands = st ? [...occByKey.keys()].filter((k) => stem(k) === st && !itemsByKey.has(k)) : [];
    if (cands.length === 1) aliasOf.set(key, cands[0]);
  }
  const pairs = new Map<string, CuratedItem>();
  const differing: string[] = [];
  let low = 0;
  for (const [key, items] of itemsByKey) {
    const occs = occByKey.get(aliasOf.get(key) ?? key) ?? [];
    if (occs.length === items.length) {
      occs.forEach((o, i) => {
        pairs.set(o.id, items[i]);
        const it = items[i];
        if (it.sentence && !it.sourceNote && jaccard(it.sentence, o.sentence) < 0.35) low++;
      });
      continue;
    }
    differing.push(key);
    const cand: { o: CitationOccurrence; it: CuratedItem; s: number }[] = [];
    for (const o of occs) for (const it of items) cand.push({ o, it, s: it.sentence ? jaccard(it.sentence, o.sentence) : 0 });
    cand.sort((a, b) => b.s - a.s);
    const usedO = new Set<string>();
    const usedI = new Set<CuratedItem>();
    for (const c of cand) {
      if (c.s < 0.5 || usedO.has(c.o.id) || usedI.has(c.it)) continue;
      usedO.add(c.o.id);
      usedI.add(c.it);
      pairs.set(c.o.id, c.it);
    }
  }
  // Items still unpaired (different keys, e.g. "cvatdocs" vs "cvatai2026"): pair by sentence similarity across all
  // unpaired occurrences of resolved references.
  const usedO = new Set(pairs.keys());
  const usedI = new Set(pairs.values());
  const rest: { o: CitationOccurrence; it: CuratedItem; s: number }[] = [];
  for (const it of curated.items) {
    if (usedI.has(it) || !it.sentence) continue;
    for (const o of report.occurrences) if (o.resolution === 'resolved' && !usedO.has(o.id)) rest.push({ o, it, s: jaccard(it.sentence, o.sentence) });
  }
  rest.sort((a, b) => b.s - a.s);
  for (const c of rest) {
    if (c.s < 0.5 || usedO.has(c.o.id) || usedI.has(c.it)) continue;
    usedO.add(c.o.id);
    usedI.add(c.it);
    pairs.set(c.o.id, c.it);
  }
  return { pairs, differing, low };
}

/** Returns a copy of the report with the curated evidence applied. */
export function applyCurated(graph: CitationGraph, report: EvidenceReport, curated: CuratedFile): { report: EvidenceReport; result: CuratedApplyResult } {
  const { pairs, differing, low } = pairCurated(graph, report, curated);
  const pageCount = (fileId: string | undefined) => (fileId ? graph.files[fileId]?.pageCount : undefined);
  const occurrences = report.occurrences.map((o): CitationOccurrence => {
    const it = pairs.get(o.id);
    if (!it) return o;
    const max = pageCount(o.referenceFileId);
    const passages: Passage[] = o.referenceFileId
      ? it.passages
          .filter((p) => !max || p.page <= max)
          .map((p) => ({ fileId: o.referenceFileId as string, page: p.page, text: p.text, score: 1, region: p.region, curated: true }))
      : [];
    // Corpo before resumo, like the reviewed index.
    passages.sort((a, b) => Number(a.region === 'resumo') - Number(b.region === 'resumo'));
    const noteOnly = it.sourceNote && passages.length === 0;
    const status: EvidenceStatus = noteOnly ? 'nao_localizado' : it.status;
    const reason: EvidenceReason | undefined = noteOnly ? 'fonte_sem_trecho' : undefined;
    return {
      ...o,
      status,
      reason,
      score: passages.length ? 1 : o.score,
      notes: [...it.notes, ...(it.sourceNote && passages.length ? ['Nota de fonte de quadro; trecho de apoio da curadoria.'] : [])],
      passages,
      curated: { source: curated.source, autoStatus: o.status, autoReason: o.reason, autoScore: o.score, sourceNote: it.sourceNote },
    };
  });
  const out: EvidenceReport = { ...report, occurrences, summary: summarizeOccurrences(occurrences) };
  return {
    report: out,
    result: { items: curated.items.length, applied: pairs.size, unmatchedItems: curated.items.length - pairs.size, keysWithDifferentCounts: differing, lowSimilarity: low },
  };
}
