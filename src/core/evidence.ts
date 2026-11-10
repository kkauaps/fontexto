/**
 * Citation occurrences and lexical evidence retrieval (Phase 2).
 *
 * For every in-text citation of the main PDF the pipeline
 *   1. finds the *citing sentence* (sentence segmentation of the PDF text),
 *   2. resolves the marker to a bibliography publication (see citations.ts),
 *   3. searches the cited publication's own PDF for the passages that are
 *      lexically closest to the citing sentence, and
 *   4. labels the result `localizado`, `ressalva` or `nao_localizado`.
 *
 * Scientific-integrity notes
 *  - The score is a *weighted term overlap* (IDF-weighted, with numbers and
 *    acronyms weighted up and a small PT->EN glossary). It tells where a
 *    passage that talks about the same things is, NOT that the passage
 *    supports the claim. Every result is a `candidate` for human review.
 *  - Pages are physical PDF pages. Passage text is copied from the extracted
 *    text, never generated.
 *  - Nothing is invented: a missing PDF, a scanned PDF or a sentence without
 *    searchable content is reported as `nao_localizado` with the reason.
 *  - Deterministic: the same inputs always produce the same report.
 */
import { DEFAULT_GLOSSARY } from './glossary.js';
import { extractMarkersFromText, resolveMarker, type MarkerReference } from './citations.js';
import type { CitationGraph, FileRecord, PublicationNode, Rect } from './model.js';
import { stripDiacritics } from './normalize.js';
import { isPageNumber, referenceSectionBounds, repeatedLines } from './references.js';
import type { PdfText } from './text.js';

export const EVIDENCE_SCHEMA_VERSION = 1 as const;
export const REDACTED_TEXT = '[redacted: private document]';

/** Thresholds of the weighted-overlap score (share of the claim's weighted terms found in a passage). */
export interface EvidenceParams {
  /** score >= strong: `localizado`. */
  strong: number;
  /** weak <= score < strong: `ressalva`. Below: `nao_localizado`. */
  weak: number;
  /** Claims with fewer distinct searchable terms cannot be matched. */
  minClaimTerms: number;
  maxPassages: number;
  maxPassageChars: number;
  /** Passages scoring below this are not shown at all. */
  minShown: number;
  /** Weight multiplier (0..1) of claim terms that occur nowhere in the reference PDF (untranslatable words). */
  absentWeight: number;
  /** 0..1: how strongly long, term-dense passages are penalised (precision). */
  lengthPenalty: number;
  /** Credit the next sentence's terms too (claims often span two sentences in the source). */
  windowNext: boolean;
}

export const EVIDENCE_PARAMS: EvidenceParams = {
  strong: 0.3,
  weak: 0.16,
  minClaimTerms: 3,
  maxPassages: 3,
  maxPassageChars: 450,
  minShown: 0.1,
  absentWeight: 0.3,
  lengthPenalty: 0,
  windowNext: false,
};

export type EvidenceStatus = 'localizado' | 'ressalva' | 'nao_localizado';
export type EvidenceReason =
  | 'sem_pdf' // the cited publication has no PDF in the project
  | 'sem_texto' // the PDF has no extractable text (scanned) or failed to extract
  | 'frase_curta' // the citing sentence has too little searchable content
  | 'sem_passagem' // nothing in the PDF resembles the sentence
  | 'baixa_similaridade' // best passage only partially overlaps (ressalva)
  | 'numero_ausente' // numbers of the sentence are absent from the best passage (ressalva)
  | 'so_resumo'; // the only close passage is in the abstract/front matter (ressalva)

export interface Passage {
  fileId: string;
  /** 1-based physical page where the passage starts. */
  page: number;
  text: string;
  /** Weighted overlap 0..1. */
  score: number;
  region: 'resumo' | 'corpo';
}

export interface CitationOccurrence {
  /** Stable for a given main PDF: `o<offset>-<k>`. */
  id: string;
  /** Marker span id (several publications can share one parenthetical marker). */
  spanId: string;
  /** Marker text as printed, e.g. "(Velloran et al., 2025)". */
  marker: string;
  page: number;
  /** n-th occurrence (0-based) of the same marker text on this page; used to locate it in the PDF text layer. */
  nthOnPage: number;
  /** Line rectangles (PDF points, top-left origin) of the lines holding the marker, as reported by the extractor. */
  rects: Rect[];
  pageSize: { width: number; height: number };
  resolution: 'resolved' | 'ambiguous' | 'unresolved';
  publicationId?: string;
  candidates: string[];
  /** The citing sentence as printed (markers kept). */
  sentence: string;
  /** Text actually searched: sentence without markers (plus the next sentence for narrative citations). */
  claim: string;
  referenceFileId?: string;
  status?: EvidenceStatus;
  reason?: EvidenceReason;
  notes: string[];
  /** Best passage score, if any. */
  score?: number;
  passages: Passage[];
}

export interface EvidenceSummary {
  occurrences: number;
  /** Occurrences whose marker resolved to a publication. */
  resolved: number;
  unresolved: number;
  ambiguous: number;
  localizado: number;
  ressalva: number;
  nao_localizado: number;
  /** Subsets of `nao_localizado`/`ressalva` by cause. */
  semPdf: number;
  semTexto: number;
  frasesCurtas: number;
}

export interface EvidenceReport {
  schemaVersion: typeof EVIDENCE_SCHEMA_VERSION;
  projectId: string;
  builtAt: string;
  mainFileId?: string;
  /** Plain-language description of what the labels mean (shown in the UI). */
  method: string;
  params: EvidenceParams;
  summary: EvidenceSummary;
  occurrences: CitationOccurrence[];
}

export const EVIDENCE_METHOD =
  'Rótulos automáticos por sobreposição lexical ponderada entre a frase que cita e as passagens do PDF da referência ' +
  '(numerais, siglas e termos raros pesam mais; há um pequeno glossário PT→EN). "Localizado" indica que há uma passagem ' +
  'sobre os mesmos termos, não que ela comprove a afirmação: toda passagem é candidata e precisa de revisão humana.';

// ---------------------------------------------------------------------------
// Text flow: PDF lines -> one string with exact line offsets
// ---------------------------------------------------------------------------

const PARA = '\u2029';

export interface FlowLine {
  page: number;
  /** Index of the line in `PageText.lines`. */
  index: number;
  start: number;
  end: number;
  rect: Rect;
}

export interface Flow {
  text: string;
  lines: FlowLine[];
}

const HEADING_LINE = /^(?:\d+(?:\.\d+)*\.?\s+)?\p{Lu}[\p{Lu}\d\s\-–:,/&()]{3,}$/u;
const NUMBERED_HEADING = /^\d+(?:\.\d+)+\.?\s+\S/;
const isHeading = (t: string) => t.length < 90 && !/[.,;:]$/.test(t) && (HEADING_LINE.test(t) || NUMBERED_HEADING.test(t));

/**
 * Concatenates the text lines of a PDF in reading order. Hyphenated line
 * breaks are merged and paragraph breaks (U+2029) are inserted at headings and
 * large vertical gaps so sentence segmentation does not run across them.
 * `skip` removes lines (running headers, bibliography).
 */
export function buildFlow(pdf: PdfText, skip?: (page: number, lineIndex: number) => boolean): Flow {
  const repeated = repeatedLines(pdf);
  let text = '';
  const lines: FlowLine[] = [];
  let prev: { rect: Rect; text: string; page: number } | undefined;
  for (const p of pdf.pages) {
    p.lines.forEach((l, index) => {
      const t = l.text.replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim();
      if (!t || isPageNumber(t)) return;
      if (repeated.has(t.replace(/\d+/g, '#').toLowerCase())) return;
      if (skip?.(p.page, index)) return;
      const heading = isHeading(t);
      const gap = prev && prev.page === p.page ? l.rect.y - (prev.rect.y + prev.rect.h) : 0;
      const bigGap = Boolean(prev && prev.page === p.page && gap > Math.max(6, l.fontSize * 0.9));
      const paragraph = !prev || heading || isHeading(prev.text) || bigGap;
      // "segmenta-|tion" -> "segmentation"; "DI-|NOv2" -> "DINOv2"; "Maier-|Hein" keeps its hyphen.
      const dehyphenate = !paragraph && ((/\p{Ll}-$/u.test(text) && /^\p{Ll}/u.test(t)) || (/(?<!\p{L})\p{Lu}{1,3}-$/u.test(text) && /^\p{Lu}/u.test(t)));
      const hyphenJoin = !paragraph && !dehyphenate && /\p{L}-$/u.test(text) && /^\p{L}/u.test(t);
      if (text) {
        if (dehyphenate) text = text.slice(0, -1);
        else text += paragraph ? PARA : hyphenJoin ? '' : ' ';
      }
      if ((dehyphenate || hyphenJoin) && lines.length) lines[lines.length - 1].end = text.length;
      const start = text.length;
      text += t;
      lines.push({ page: p.page, index, start, end: text.length, rect: l.rect });
      prev = { rect: l.rect, text: t, page: p.page };
    });
  }
  return { text, lines };
}

/** Page of a character offset in the flow. */
export function pageAt(flow: Flow, offset: number): number {
  let lo = 0;
  let hi = flow.lines.length - 1;
  let best = flow.lines[0]?.page ?? 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (flow.lines[mid].start <= offset) {
      best = flow.lines[mid].page;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Sentence segmentation
// ---------------------------------------------------------------------------

const ABBREVIATIONS = new Set([
  'al', 'fig', 'figs', 'tab', 'tabs', 'eq', 'eqs', 'p', 'pp', 'v', 'vol', 'n', 'no', 'nr', 'ed', 'eds', 'cf', 'vs', 'dr', 'dra', 'prof', 'profa', 'sr', 'sra',
  'st', 'ltd', 'inc', 'co', 'cia', 'etc', 'aprox', 'ex', 'apud', 'org', 'cap', 'sec', 'secs', 'ibid', 'jr', 'approx', 'resp', 'obs', 'min', 'max', 'ref', 'refs',
  'dept', 'univ', 'proc', 'ch', 'sect', 'art', 'arts', 'inc', 'lit', 'ca', 'jan', 'fev', 'mar', 'abr', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez', 'feb', 'apr',
  'aug', 'sep', 'sept', 'oct', 'dec', 'u.s', 'e.g', 'i.e',
]);

export interface Span {
  start: number;
  end: number;
}

const START_CHAR = /[\p{Lu}\d(\[“"‘'•¿¡]/u;

/** Sentence spans (trimmed, never empty) of `text`. Breaks at U+2029 and at sentence-final punctuation. */
export function segmentSentences(text: string): Span[] {
  const spans: Span[] = [];
  let segStart = 0;
  const push = (s: number, e: number) => {
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
    if (e > s) spans.push({ start: s, end: e });
  };
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (c === PARA) {
      push(segStart, i);
      segStart = i + 1;
      continue;
    }
    if (c !== '.' && c !== '!' && c !== '?' && c !== '…') continue;
    // include closing quotes/brackets after the punctuation
    let j = i + 1;
    while (j < n && /["”’')\]]/.test(text[j])) j++;
    if (j >= n) continue;
    if (!/\s/.test(text[j])) continue;
    let k = j;
    while (k < n && /\s/.test(text[k]) && text[k] !== PARA) k++;
    if (k >= n || text[k] === PARA) continue; // paragraph break handles it
    if (!START_CHAR.test(text[k])) continue;
    if (c === '.') {
      // word before the dot
      let w = i - 1;
      while (w >= 0 && /[\p{L}.]/u.test(text[w])) w--;
      const word = text.slice(w + 1, i);
      const lower = word.toLowerCase();
      if (ABBREVIATIONS.has(lower)) continue;
      if (/^\p{Lu}$/u.test(word) && text[w] !== undefined) continue; // initial: "J. Smith"
      if (/\./.test(word)) continue; // "e.g." "i.e." "U.S."
    }
    push(segStart, j);
    segStart = k;
    i = k - 1;
  }
  push(segStart, n);
  return spans;
}

// ---------------------------------------------------------------------------
// Tokens and scoring
// ---------------------------------------------------------------------------

const TOKEN_RE = /\d+[.,]\d+|\d+|[A-Za-z][A-Za-z0-9\-+]*/g;

/**
 * Search terms of a text:
 *  - numbers: `#85.88`
 *  - words of 5+ letters: their first 5 letters (cheap stemming that also matches PT/EN cognates);
 *    shorter words only through the glossary
 *  - the glossary equivalent of each stem
 *  - acronyms / alphanumerics (>=2 capitals or a digit): `@sam2`
 */
export function tokenize(input: string, glossary: Readonly<Record<string, string>> = DEFAULT_GLOSSARY): string[] {
  const s = stripDiacritics(input.replace(/\u00ad/g, '').replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl'));
  const out: string[] = [];
  for (const m of s.matchAll(TOKEN_RE)) {
    const w = m[0];
    if (/^\d/.test(w)) {
      out.push('#' + w.replace(',', '.'));
      continue;
    }
    const lw = w.toLowerCase();
    if (lw.length >= 5) {
      const key5 = lw.slice(0, 5);
      out.push(key5);
      const g = glossary[key5];
      if (g) out.push(g);
    } else {
      const g = glossary[lw];
      if (g) out.push(g);
    }
    if (/\d/.test(w) || (w.match(/[A-Z]/g) ?? []).length >= 2) out.push('@' + lw);
  }
  return out;
}

export interface IndexedSentence {
  /** Position in the sentence array. */
  i: number;
  page: number;
  text: string;
  region: 'resumo' | 'corpo';
  tokens: Set<string>;
}

export interface ReferenceIndex {
  sentences: IndexedSentence[];
  df: Map<string, number>;
  hasText: boolean;
}

const INTRO_RE = /^(?:(?:1|I)\.?\s*)?(?:introduction|introdu[cç][aã]o|introducci[oó]n)\b/i;

/** Sentence index of a (reference) PDF. The bibliography section is excluded. */
export function buildReferenceIndex(pdf: PdfText): ReferenceIndex {
  const bounds = referenceSectionBounds(pdf);
  const flow = buildFlow(pdf, (page, line) => {
    if (!bounds) return false;
    const after = page > bounds.start.page || (page === bounds.start.page && line >= bounds.start.line);
    const before = bounds.end ? page < bounds.end.page || (page === bounds.end.page && line < bounds.end.line) : true;
    return after && before;
  });
  const introLine = flow.lines.find((l) => l.page <= 2 && INTRO_RE.test(flow.text.slice(l.start, l.end).trim()));
  const introOffset = introLine?.start ?? 0;
  const sentences: IndexedSentence[] = [];
  const df = new Map<string, number>();
  for (const sp of segmentSentences(flow.text)) {
    const text = flow.text.slice(sp.start, sp.end).replace(/\s+/g, ' ');
    if (text.length < 25) continue;
    const page = pageAt(flow, sp.start);
    const tokens = new Set(tokenize(text));
    const region: 'resumo' | 'corpo' = introOffset > 0 && sp.start < introOffset ? 'resumo' : 'corpo';
    sentences.push({ i: sentences.length, page, text, region, tokens });
    for (const t of tokens) df.set(t, (df.get(t) ?? 0) + 1);
  }
  return { sentences, df, hasText: sentences.length > 0 };
}

const typeWeight = (t: string) => (t[0] === '#' ? 3 : t[0] === '@' ? 2 : 1);

/** IDF weight of a claim term in this reference; terms absent from the whole PDF count at `absentWeight`. */
const weightOf = (t: string, df: Map<string, number>, n: number, absentWeight: number) => {
  const d = df.get(t);
  return Math.log(1 + n / (1 + (d ?? 0))) * typeWeight(t) * (d === undefined ? absentWeight : 1);
};

export interface RankedPassage {
  index: number;
  score: number;
  /** Share of the claim covered by the sentence alone (tie-breaker: the window also credits its neighbour). */
  own: number;
  /** Claim numbers (>= 2 digits or decimals) missing from the passage window. */
  missingNumbers: string[];
}

/** Ranks the sentences (each with its successor) of `index` against the claim terms. */
export function rankPassages(index: ReferenceIndex, claimTerms: Set<string>, params: EvidenceParams = EVIDENCE_PARAMS): RankedPassage[] {
  const max = params.maxPassages;
  const S = index.sentences;
  const N = S.length;
  if (N === 0 || claimTerms.size === 0) return [];
  const w = (t: string) => weightOf(t, index.df, N, params.absentWeight);
  const total = [...claimTerms].reduce((a, t) => a + w(t), 0) || 1;
  const scored: RankedPassage[] = [];
  const numbers = [...claimTerms].filter((t) => t[0] === '#' && (t.length > 3 || t.includes('.')));
  for (let i = 0; i < N; i++) {
    const next = params.windowNext && i + 1 < N && S[i + 1].region === S[i].region ? S[i + 1].tokens : undefined;
    let sum = 0;
    let ownSum = 0;
    for (const t of claimTerms) {
      if (S[i].tokens.has(t)) {
        sum += w(t);
        ownSum += w(t);
      } else if (next?.has(t)) sum += w(t);
    }
    if (sum === 0) continue;
    const missingNumbers = numbers.filter((t) => !S[i].tokens.has(t) && !next?.has(t)).map((t) => t.slice(1));
    let score = sum / total;
    if (params.lengthPenalty > 0) {
      let passageWeight = 0;
      for (const t of S[i].tokens) passageWeight += w(t);
      if (next) for (const t of next) if (!S[i].tokens.has(t)) passageWeight += w(t);
      const precision = passageWeight > 0 ? sum / passageWeight : 0;
      score *= 1 - params.lengthPenalty + params.lengthPenalty * Math.min(1, precision / 0.35);
    }
    scored.push({ index: i, score, own: ownSum / total, missingNumbers });
  }
  // best first; on near ties prefer body over abstract/front matter
  scored.sort((a, b) => {
    const ra = S[a.index].region === 'resumo' ? 0.03 : 0;
    const rb = S[b.index].region === 'resumo' ? 0.03 : 0;
    return b.score - rb - (a.score - ra) || b.own - a.own || a.index - b.index;
  });
  const out: RankedPassage[] = [];
  for (const c of scored) {
    if (out.some((o) => Math.abs(o.index - c.index) <= 1)) continue;
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

function passageText(index: ReferenceIndex, i: number, maxChars: number): string {
  const S = index.sentences;
  let t = S[i].text;
  if (i + 1 < S.length && S[i + 1].region === S[i].region && t.length < 200) t += ' ' + S[i + 1].text;
  return t.length > maxChars ? t.slice(0, maxChars - 1).trimEnd() + '…' : t;
}

// ---------------------------------------------------------------------------
// Occurrences in the main document
// ---------------------------------------------------------------------------

function cleanClaim(raw: string, removals: Span[]): string {
  let out = '';
  let pos = 0;
  for (const r of removals) {
    out += raw.slice(pos, r.start) + ' ';
    pos = r.end;
  }
  out += raw.slice(pos);
  return out
    .replace(/\(\s*[;,]*\s*\)/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const displaySentence = (s: string) => s.replace(/\s+/g, ' ').trim();

export interface ComputeEvidenceInput {
  projectId: string;
  now: string;
  graph: CitationGraph;
  /** Extracted text per file id (only files with status ok). */
  texts: Record<string, PdfText>;
  /** Optional cache of reference indexes keyed by `fileId:sha256`. */
  cache?: Map<string, ReferenceIndex>;
  params?: Partial<EvidenceParams>;
}

/** The PDF of a publication: file links first, then the files merged into the node. */
export function referenceFileFor(graph: CitationGraph, pub: PublicationNode, texts: Record<string, PdfText>): { fileId?: string; failed?: FileRecord } {
  const ids = [
    ...graph.fileLinks.filter((l) => l.publicationId === pub.id && (l.status === 'matched' || l.status === 'manual')).map((l) => l.fileId),
    ...pub.fileIds,
  ].filter((id, i, a) => a.indexOf(id) === i && graph.files[id] && graph.files[id].role !== 'bibtex');
  const withText = ids.find((id) => texts[id]);
  if (withText) return { fileId: withText };
  const failed = ids.map((id) => graph.files[id]).find(Boolean);
  return failed ? { failed } : {};
}

export function computeEvidence(input: ComputeEvidenceInput): EvidenceReport {
  const { graph, texts } = input;
  const params: EvidenceParams = { ...EVIDENCE_PARAMS, ...input.params };
  const mainFile = Object.values(graph.files).find((f) => f.role === 'main');
  const mainText = mainFile ? texts[mainFile.id] : undefined;
  const occurrences: CitationOccurrence[] = [];
  const emptySummary = (): EvidenceSummary => ({ occurrences: 0, resolved: 0, unresolved: 0, ambiguous: 0, localizado: 0, ressalva: 0, nao_localizado: 0, semPdf: 0, semTexto: 0, frasesCurtas: 0 });

  const indexFor = (fileId: string): ReferenceIndex | undefined => {
    const t = texts[fileId];
    if (!t) return undefined;
    const key = `${fileId}:${graph.files[fileId]?.sha256 ?? ''}`;
    const hit = input.cache?.get(key);
    if (hit) return hit;
    const idx = buildReferenceIndex(t);
    input.cache?.set(key, idx);
    return idx;
  };

  if (mainFile && mainText) {
    const bibPubs = Object.values(graph.nodes).filter((n): n is PublicationNode => n.kind === 'publication' && n.inMainBibliography);
    const bounds = referenceSectionBounds(mainText);
    const flow = buildFlow(mainText, (page, line) => {
      if (!bounds) return false;
      const after = page > bounds.start.page || (page === bounds.start.page && line >= bounds.start.line);
      const before = bounds.end ? page < bounds.end.page || (page === bounds.end.page && line < bounds.end.line) : true;
      return after && before;
    });
    const sentences = segmentSentences(flow.text);
    const markers = extractMarkersFromText(flow.text);
    const pageSize = new Map(mainText.pages.map((p) => [p.page, { width: p.width, height: p.height }]));
    const claimTermsCache = new Map<string, Set<string>>();

    // markers grouped by span (one parenthetical may hold several references)
    const bySpan = new Map<number, typeof markers>();
    for (const m of markers) bySpan.set(m.start, [...(bySpan.get(m.start) ?? []), m]);
    const seenRaw = new Map<string, number>(); // `${page}|${raw}` -> count
    const sentenceIndexAt = (offset: number) => {
      let lo = 0;
      let hi = sentences.length - 1;
      let best = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (sentences[mid].start <= offset) {
          best = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      return best;
    };

    for (const start of [...bySpan.keys()].sort((a, b) => a - b)) {
      const group = bySpan.get(start)!;
      const first = group[0];
      const page = pageAt(flow, first.start);
      const rawKey = `${page}|${first.raw}`;
      const nthOnPage = seenRaw.get(rawKey) ?? 0;
      seenRaw.set(rawKey, nthOnPage + 1);
      const rects = flow.lines.filter((l) => l.page === page && l.start < first.end && l.end > first.start).map((l) => l.rect);
      const si = sentenceIndexAt(first.start);
      const sentSpan = si >= 0 ? sentences[si] : { start: first.start, end: first.end };
      const sentenceRaw = flow.text.slice(sentSpan.start, sentSpan.end);
      // markers inside the sentence are removed from the claim
      const inside = markers
        .filter((m) => m.start >= sentSpan.start && m.end <= sentSpan.end)
        .map((m) => ({ start: m.start - sentSpan.start, end: m.end - sentSpan.start }))
        .sort((a, b) => a.start - b.start)
        .filter((r, i, a) => i === 0 || r.start >= a[i - 1].end);
      let claim = cleanClaim(sentenceRaw, inside);
      // Narrative citation at the start of the sentence ("Velloran et al. (2025) propose ..."): the content is often in the next sentence.
      if (first.narrative && first.start - sentSpan.start < 60 && si >= 0 && si + 1 < sentences.length && flow.text.slice(sentences[si].end, sentences[si + 1].start).indexOf(PARA) === -1) {
        const nx = sentences[si + 1];
        claim = `${claim} ${cleanClaim(flow.text.slice(nx.start, nx.end), markers.filter((m) => m.start >= nx.start && m.end <= nx.end).map((m) => ({ start: m.start - nx.start, end: m.end - nx.start })))}`.trim();
      }
      let k = 0;
      for (const m of group) {
        const res = resolveMarker(m as MarkerReference, bibPubs);
        const occ: CitationOccurrence = {
          id: `o${first.start}-${k++}`,
          spanId: `s${first.start}`,
          marker: first.raw,
          page,
          nthOnPage,
          rects,
          pageSize: pageSize.get(page) ?? { width: 0, height: 0 },
          resolution: res.status === 'resolved' ? 'resolved' : res.status,
          publicationId: res.status === 'resolved' ? res.publicationId : undefined,
          candidates: res.status === 'ambiguous' ? res.candidates : [],
          sentence: displaySentence(sentenceRaw),
          claim: displaySentence(claim),
          notes: [],
          passages: [],
        };
        if (res.status === 'resolved') {
          const pub = graph.nodes[res.publicationId] as PublicationNode;
          scoreOccurrence(occ, pub, graph, texts, indexFor, claimTermsCache, params);
        }
        occurrences.push(occ);
      }
    }
  }

  const summary = emptySummary();
  for (const o of occurrences) {
    summary.occurrences++;
    if (o.resolution === 'resolved') summary.resolved++;
    else if (o.resolution === 'ambiguous') summary.ambiguous++;
    else summary.unresolved++;
    if (o.status) summary[o.status]++;
    if (o.reason === 'sem_pdf') summary.semPdf++;
    if (o.reason === 'sem_texto') summary.semTexto++;
    if (o.reason === 'frase_curta') summary.frasesCurtas++;
  }
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    projectId: input.projectId,
    builtAt: input.now,
    mainFileId: mainFile?.id,
    method: EVIDENCE_METHOD,
    params,
    summary,
    occurrences,
  };
}

function scoreOccurrence(
  occ: CitationOccurrence,
  pub: PublicationNode,
  graph: CitationGraph,
  texts: Record<string, PdfText>,
  indexFor: (fileId: string) => ReferenceIndex | undefined,
  termsCache: Map<string, Set<string>>,
  params: EvidenceParams,
) {
  const { fileId, failed } = referenceFileFor(graph, pub, texts);
  if (!fileId) {
    occ.status = 'nao_localizado';
    if (failed) {
      occ.reason = 'sem_texto';
      occ.notes.push(`O PDF "${failed.originalName}" não tem texto extraível (${failed.extraction.status}).`);
    } else {
      occ.reason = 'sem_pdf';
      occ.notes.push('O PDF desta referência não foi enviado. Envie-o em "PDFs das referências" para localizar o trecho.');
    }
    return;
  }
  occ.referenceFileId = fileId;
  const index = indexFor(fileId)!;
  if (!index.hasText) {
    occ.status = 'nao_localizado';
    occ.reason = 'sem_texto';
    occ.notes.push('O PDF da referência não tem texto extraível.');
    return;
  }
  let terms = termsCache.get(occ.claim);
  if (!terms) {
    terms = new Set(tokenize(occ.claim));
    termsCache.set(occ.claim, terms);
  }
  if (terms.size < params.minClaimTerms) {
    occ.status = 'nao_localizado';
    occ.reason = 'frase_curta';
    occ.notes.push('A frase que cita tem pouco conteúdo pesquisável (por exemplo, só o nome do autor); não há como buscar a passagem.');
    return;
  }
  const ranked = rankPassages(index, terms, params);
  occ.passages = ranked
    .filter((r) => r.score >= params.minShown)
    .map((r) => ({ fileId, page: index.sentences[r.index].page, text: passageText(index, r.index, params.maxPassageChars), score: round(r.score), region: index.sentences[r.index].region }));
  const best = ranked[0];
  if (!best || best.score < params.weak) {
    occ.status = 'nao_localizado';
    occ.reason = 'sem_passagem';
    occ.score = best ? round(best.score) : 0;
    occ.notes.push('Nenhuma passagem do PDF tem sobreposição suficiente com a frase.');
    return;
  }
  occ.score = round(best.score);
  const bestRegion = index.sentences[best.index].region;
  if (best.score >= params.strong && best.missingNumbers.length === 0 && bestRegion === 'corpo') {
    occ.status = 'localizado';
    return;
  }
  occ.status = 'ressalva';
  if (best.score < params.strong) {
    occ.reason = 'baixa_similaridade';
    occ.notes.push('A melhor passagem cobre só parte dos termos da frase.');
  } else if (best.missingNumbers.length) {
    occ.reason = 'numero_ausente';
    occ.notes.push(`Número(s) da frase ausente(s) da passagem: ${best.missingNumbers.join(', ')}.`);
  } else {
    occ.reason = 'so_resumo';
    occ.notes.push('A passagem mais próxima está no resumo/início do artigo; confira o corpo do texto.');
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000;

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

/** Copy that is safe to share: text from private files is removed, pages/labels/statuses stay. */
export function redactEvidenceForSharing(report: EvidenceReport, files: Record<string, Pick<FileRecord, 'visibility'>>): EvidenceReport {
  const isPrivate = (id: string | undefined) => id === undefined || files[id]?.visibility !== 'shareable';
  const mainPrivate = isPrivate(report.mainFileId);
  return {
    ...report,
    occurrences: report.occurrences.map((o) => ({
      ...o,
      marker: mainPrivate ? REDACTED_TEXT : o.marker,
      sentence: mainPrivate ? REDACTED_TEXT : o.sentence,
      claim: mainPrivate ? REDACTED_TEXT : o.claim,
      rects: mainPrivate ? [] : o.rects,
      notes: o.notes,
      passages: o.passages.map((p) => ({ ...p, text: isPrivate(p.fileId) ? REDACTED_TEXT : p.text })),
    })),
  };
}
