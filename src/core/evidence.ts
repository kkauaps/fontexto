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
import { buildQuery, indexV2, lexicalCandidates, MATCH_PARAMS, windowText, type Candidate, type ClaimParts, type MatchParams } from './matching.js';
import { claimSpanFor, isLeadingNarrative, numbersAttributedTo } from './attribution.js';
import { authorsFromMarker, bestPassageFocus } from './passageFocus.js';
import { extractMarkersFromText, isSelfCitation, resolveMarker, splitSeparateAuthors, type Approximation, type MarkerReference } from './citations.js';
import type { CitationGraph, FileRecord, PublicationNode, Rect } from './model.js';
import { foldCjk, stripDiacritics } from './normalize.js';
import { extractReferenceEntries, isPageNumber, matchReference, referenceRanges, repeatedLines } from './references.js';
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
  /** `v1`: single-sentence weighted overlap; `v2`: claim clauses + BM25 windows + fuzzy matching (+ optional embeddings). */
  matcher: 'v1' | 'v2';
  /**
   * Thresholds on the v2 final score: `strong`/`weak` for lexical coverage alone, `strongSem`/`weakSem` for the
   * lexical/semantic blend. Calibrated on the internal gold set (see docs/matcher-evaluation.md).
   */
  v2: { strong: number; weak: number; strongSem: number; weakSem: number };
  /** Lexical stage parameters of the v2 matcher. */
  match: MatchParams;
  /**
   * Candidates are ranked by `(1-lambdaRank)*z(lex) + lambdaRank*z(cos)` (z-scores inside one occurrence) and labelled
   * by the absolute score `(1-lambda)*lex + lambda*clamp((cos-semFloor)/(semCeil-semFloor))` of the top candidate.
   */
  fusion: { lambdaRank: number; lambda: number; semFloor: number; semCeil: number };
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
  matcher: 'v2',
  v2: { strong: 0.3, weak: 0.1, strongSem: 0.3, weakSem: 0.14 },
  match: MATCH_PARAMS,
  fusion: { lambdaRank: 0.5, lambda: 0.5, semFloor: 0.3, semCeil: 0.8 },
};

export type EvidenceStatus = 'localizado' | 'ressalva' | 'nao_localizado';
export type EvidenceReason =
  | 'sem_pdf' // the cited publication has no PDF in the project
  | 'sem_texto' // the PDF has no extractable text (scanned) or failed to extract
  | 'frase_curta' // the citing sentence has too little searchable content
  | 'sem_passagem' // nothing in the PDF resembles the sentence
  | 'baixa_similaridade' // best passage only partially overlaps (ressalva)
  | 'numero_ausente' // numbers of the sentence are absent from the best passage (ressalva)
  | 'so_resumo' // the only close passage is in the abstract/front matter (note only)
  | 'pagina_citada' // the page given in the marker ("p. 12") does not exist in the PDF or has no similar passage (ressalva)
  | 'citacao_direta' // the quoted text ("...") of a direct citation is not in the source (ressalva)
  | 'fonte_sem_trecho'; // curated: source note of a table, whose support lives in the table rows themselves

export interface Passage {
  fileId: string;
  /** 1-based physical page of the best-matching sentence in the passage (the chunk may start on another page). */
  page: number;
  text: string;
  /** Exact best-matching sentence (anchors or sentence-level embeddings); highlighted in the card and in the PDF. */
  focus?: string;
  /** True when no sentence could be identified exactly (no anchors, no semantic model): the whole passage is highlighted. */
  focusApproximate?: boolean;
  /** Weighted overlap 0..1. */
  score: number;
  region: 'resumo' | 'corpo';
  /** True when the passage comes from imported, human-reviewed evidence (its `score` is then 1 and not a similarity). */
  curated?: boolean;
}

/** Marks an occurrence whose status and passages were taken from imported curated evidence instead of the automatic matcher. */
export interface CuratedMark {
  source: string;
  /** Status the automatic matcher gave (kept so both can be compared). */
  autoStatus?: EvidenceStatus;
  autoReason?: EvidenceReason;
  autoScore?: number;
  /** Table source note ("Fonte: ...") rather than a sentence of the running text. */
  sourceNote?: boolean;
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
  /** Clause around the marker (the part of the sentence the citation supports); absent for older reports. */
  localClaim?: string;
  /** Checkable numbers uniquely attributed to this citation (not every number in the sentence). */
  attributedNumbers?: string[];
  /** Neighbouring sentences (without markers), used as weak extra context. */
  context?: string;
  referenceFileId?: string;
  status?: EvidenceStatus;
  reason?: EvidenceReason;
  notes: string[];
  /** Best passage score, if any. */
  score?: number;
  /** One line, plain language: why the occurrence got its label (shown next to it). */
  why?: string;
  /** Set when the researcher overrode the label by hand (the automatic label stays in `auto`). */
  override?: { status: EvidenceStatus; at: string; auto?: EvidenceStatus; autoReason?: EvidenceReason; autoWhy?: string };
  passages: Passage[];
  curated?: CuratedMark;
  /** Set when the marker only matched its reference approximately (year typo, spelling, acronym, title word). */
  approx?: Approximation;
}

/** Plain-language note for an approximate marker resolution (translated in the web UI by translateRuntime). */
export function approximationNote(a: Approximation): string {
  if (a.kind === 'year') return `A citação diz “${a.cited}”, mas a lista de referências traz “${a.listed}”; confira o ano.`;
  if (a.kind === 'name') return `A citação diz “${a.cited}”, mas a lista de referências traz “${a.listed}”; confira a grafia do nome.`;
  if (a.kind === 'acronym') return `“${a.cited}” foi ligada pela sigla a “${a.listed}”; confira.`;
  return `“${a.cited}” foi ligada pela primeira palavra do título à referência sem autor “${a.listed}”.`;
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
  /** Superscript digit runs (numeric citations), as offsets in `text`. */
  sups?: Span[];
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
  const sups: Span[] = [];
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
      if (l.sups?.length) {
        // `t` is `l.text` with whitespace collapsed; offsets are mapped through the collapse
        const raw = l.text.replace(/\u00ad/g, '');
        const map: number[] = [];
        let k = 0;
        for (let i = 0; i < raw.length; i++) {
          map[i] = k;
          if (!(/\s/.test(raw[i]) && (i === 0 || /\s/.test(raw[i - 1])))) k++;
        }
        map[raw.length] = k;
        const lead = raw.length - raw.trimStart().length;
        for (const [a, b] of l.sups) sups.push({ start: start + Math.max(0, (map[a] ?? 0) - lead), end: start + Math.max(0, (map[b] ?? k) - lead) });
      }
      lines.push({ page: p.page, index, start, end: text.length, rect: l.rect });
      prev = { rect: l.rect, text: t, page: p.page };
    });
  }
  return { text, lines, sups };
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

const START_CHAR = /[\p{Lu}\p{Script=Han}\d(\[“"‘'「『•¿¡]/u;

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
    const cjkEnd = c === '。' || c === '！' || c === '？';
    if (!cjkEnd && c !== '.' && c !== '!' && c !== '?' && c !== '…') continue;
    // include closing quotes/brackets after the punctuation
    let j = i + 1;
    while (j < n && /["”’')\]」』]/.test(text[j])) j++;
    if (j >= n) continue;
    // Latin sentence ends need a space before the next sentence; CJK may use none or optional spaces.
    if (!cjkEnd && !/\s/.test(text[j])) continue;
    if (cjkEnd) {
      let k = j;
      while (k < n && /\s/.test(text[k]) && text[k] !== PARA) k++;
      if (k >= n || text[k] === PARA) continue;
      if (!START_CHAR.test(text[k])) continue;
      push(segStart, j);
      segStart = k;
      i = k - 1;
      continue;
    }
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
  const s = foldCjk(stripDiacritics(input.replace(/\u00ad/g, '').replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl')));
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
  // Chinese has no spaces between words: index Han runs as character bigrams (same idea as open-access title matching).
  for (const m of s.matchAll(/\p{Script=Han}+/gu)) {
    const w = m[0];
    if (w.length === 1) out.push(w);
    else for (let i = 0; i + 1 < w.length; i++) out.push(w.slice(i, i + 2));
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
  pageCount: number;
  /** [physical page, printed page number] read from page-number lines (top/bottom of the page). */
  printedPages?: [number, number][];
}

const INTRO_RE = /^(?:(?:1|I)\.?\s*)?(?:introduction|introdu[cç][aã]o|introducci[oó]n)\b/i;

/** Sentence index of a (reference) PDF. The bibliography section is excluded. */
export function buildReferenceIndex(pdf: PdfText): ReferenceIndex {
  const { inside } = referenceRanges(pdf);
  const flow = buildFlow(pdf, inside);
  const introLine = flow.lines.find((l) => l.page <= 2 && INTRO_RE.test(flow.text.slice(l.start, l.end).trim()));
  const introOffset = introLine?.start ?? 0;
  const sentences: IndexedSentence[] = [];
  const df = new Map<string, number>();
  for (const sp of segmentSentences(flow.text)) {
    const text = flow.text.slice(sp.start, sp.end).replace(/\s+/g, ' ');
    const minLen = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(text) ? 12 : 25;
    if (text.length < minLen) continue;
    const page = pageAt(flow, sp.start);
    const tokens = new Set(tokenize(text));
    const region: 'resumo' | 'corpo' = introOffset > 0 && sp.start < introOffset ? 'resumo' : 'corpo';
    sentences.push({ i: sentences.length, page, text, region, tokens });
    for (const t of tokens) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const printedPages: [number, number][] = [];
  for (const p of pdf.pages) {
    const edge = [...p.lines.slice(0, 3), ...p.lines.slice(-3)];
    const num = edge.map((l) => l.text.trim()).find((t) => /^\d{1,4}$/.test(t));
    if (num) printedPages.push([p.page, Number(num)]);
  }
  return { sentences, df, hasText: sentences.length > 0, pageCount: pdf.pageCount ?? pdf.pages.length, printedPages };
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
  /** Receives the v2 candidates of every occurrence that has a reference text (used by the semantic re-rank). */
  onPending?: (pm: PendingMatch) => void;
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

export function summarizeOccurrences(occurrences: CitationOccurrence[]): EvidenceSummary {
  const summary: EvidenceSummary = { occurrences: 0, resolved: 0, unresolved: 0, ambiguous: 0, localizado: 0, ressalva: 0, nao_localizado: 0, semPdf: 0, semTexto: 0, frasesCurtas: 0 };
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
  return summary;
}

export function computeEvidence(input: ComputeEvidenceInput): EvidenceReport {
  const { graph, texts } = input;
  const params: EvidenceParams = { ...EVIDENCE_PARAMS, ...input.params };
  const mainFile = Object.values(graph.files).find((f) => f.role === 'main');
  const mainText = mainFile ? texts[mainFile.id] : undefined;
  const occurrences: CitationOccurrence[] = [];

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
    const { inside } = referenceRanges(mainText, { fallback: true });
    const flow = buildFlow(mainText, inside);
    const sentences = segmentSentences(flow.text);
    // self markers ("Fonte: Autor (2026)") stay in the list so they are cut out of claims, but never become occurrences
    const markers: (ReturnType<typeof extractMarkersFromText>[number] & { numericPub?: string | null })[] = extractMarkersFromText(flow.text, { includeSelf: true });
    // Numbered reference lists (IEEE, Vancouver): "[3]", "[2,5]", "[2]–[4]", "[1-3]" point at entry labels.
    markers.push(...numericMarkers(flow.text, mainText, bibPubs, flow.sups));
    markers.sort((a, b) => a.start - b.start);
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
      const group = bySpan
        .get(start)!
        .filter((m) => !isSelfCitation(m))
        .flatMap((m) => (m.numericPub !== undefined ? [m] : splitSeparateAuthors(m, bibPubs)));
      if (group.length === 0) continue;
      const first = group[0];
      const page = pageAt(flow, first.start);
      const rawKey = `${page}|${first.raw}`;
      const nthOnPage = seenRaw.get(rawKey) ?? 0;
      seenRaw.set(rawKey, nthOnPage + 1);
      // Numeric markers ("[3]", superscripts) are too short to be found again by text search in the viewer (any "3"
      // matches), so they get a box narrowed to their share of the line instead of the whole line.
      const numeric = /^[[(]?\d/.test(first.raw);
      const rects = flow.lines
        .filter((l) => l.page === page && l.start < first.end && l.end > first.start)
        .map((l) => {
          if (!numeric) return l.rect;
          const len = Math.max(1, l.end - l.start);
          const a = Math.max(first.start, l.start) - l.start;
          const b = Math.min(first.end, l.end) - l.start;
          return { x: l.rect.x + (l.rect.w * a) / len, y: l.rect.y, w: Math.max(6, (l.rect.w * (b - a)) / len), h: l.rect.h };
        });
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
      const inSentence = markers.filter((m) => m.start >= sentSpan.start && m.end <= sentSpan.end);
      // Leading narrative ("Velloran et al. (2025) propose ..."): the content is often in the next sentence.
      if (isLeadingNarrative(flow.text, sentSpan, first) && si >= 0 && si + 1 < sentences.length && flow.text.slice(sentences[si].end, sentences[si + 1].start).indexOf(PARA) === -1) {
        const nx = sentences[si + 1];
        claim = `${claim} ${cleanClaim(flow.text.slice(nx.start, nx.end), markers.filter((m) => m.start >= nx.start && m.end <= nx.end).map((m) => ({ start: m.start - nx.start, end: m.end - nx.start })))}`.trim();
      }
      const localClaim = displaySentence(claimSpanFor(flow.text, sentSpan, inSentence, first).text);
      const attributedNumbers = numbersAttributedTo(flow.text, sentSpan, inSentence, first, citedPages(first.raw) ?? []);
      const around = (j: number) => {
        if (j < 0 || j >= sentences.length) return '';
        const lo = Math.min(j, si);
        const hi = Math.max(j, si);
        if (flow.text.slice(sentences[lo].end, sentences[hi].start).includes(PARA)) return '';
        const sp = sentences[j];
        return cleanClaim(flow.text.slice(sp.start, sp.end), markers.filter((m) => m.start >= sp.start && m.end <= sp.end).map((m) => ({ start: m.start - sp.start, end: m.end - sp.start })));
      };
      const context = si >= 0 ? displaySentence(`${around(si - 1)} ${around(si + 1)}`) : '';
      let k = 0;
      for (const m of group) {
        const res: ReturnType<typeof resolveMarker> =
          m.numericPub !== undefined ? (m.numericPub ? { status: 'resolved', publicationId: m.numericPub } : { status: 'unresolved', candidates: [] }) : resolveMarker(m as MarkerReference, bibPubs);
        const occ: CitationOccurrence = {
          id: `o${first.start}-${k++}`,
          spanId: `s${first.start}`,
          marker: group.length === 1 && first.narrative && res.status === 'resolved' ? trimNarrativeMarker(first.raw, graph.nodes[res.publicationId] as PublicationNode) : first.raw,
          page,
          nthOnPage,
          rects,
          pageSize: pageSize.get(page) ?? { width: 0, height: 0 },
          resolution: res.status === 'resolved' ? 'resolved' : res.status,
          publicationId: res.status === 'resolved' ? res.publicationId : undefined,
          candidates: res.status === 'ambiguous' ? res.candidates : [],
          sentence: displaySentence(sentenceRaw),
          claim: displaySentence(claim),
          localClaim: localClaim || undefined,
          attributedNumbers,
          context: context || undefined,
          notes: [],
          passages: [],
        };
        if (res.status === 'resolved') {
          const pub = graph.nodes[res.publicationId] as PublicationNode;
          scoreOccurrence(occ, pub, graph, texts, indexFor, claimTermsCache, params, input.onPending);
          occ.why ??= occ.notes[0];
          if ('approx' in res && res.approx) {
            occ.approx = res.approx;
            occ.notes.unshift(approximationNote(res.approx));
          }
        } else occ.why = res.status === 'ambiguous' ? 'Mais de uma referência da lista combina com esta citação; escolha a certa.' : 'Nenhuma referência da lista tem este autor e ano.';
        occurrences.push(occ);
      }
    }
  }

  const summary = summarizeOccurrences(occurrences);
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

/**
 * Numeric in-text citations, used only when the document's own reference list is numbered. Each number is mapped
 * to the publication its numbered entry matches (DOI/title/author+year, see `matchReference`). Bracket markers
 * always count; bare parenthesised numbers "(3)" only when the text has no bracket marker at all and many of them.
 * A bracket with a number outside 1..N (e.g. the interval "[0, 1]") is not a citation.
 */
export function numericMarkers(text: string, mainText: PdfText, pubs: PublicationNode[], sups: Span[] = []) {
  const entries = extractReferenceEntries(mainText).filter((e) => e.label);
  if (entries.length < 2) return [];
  const byNumber = new Map<number, string | null>();
  for (const e of entries) {
    const n = Number(/\d+/.exec(e.label!)?.[0]);
    const m = matchReference(e, pubs);
    byNumber.set(n, m.status === 'confirmed' || m.status === 'weak' ? m.publicationId : null);
  }
  const max = Math.max(...byNumber.keys());
  const expand = (body: string): number[] | undefined => {
    const out: number[] = [];
    for (const part of body.split(/\s*[,，、;；]\s*/)) {
      const r = /^(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?$/.exec(part.trim());
      if (!r) return undefined;
      const a = Number(r[1]);
      const b = r[2] ? Number(r[2]) : a;
      if (a < 1 || b > max || b < a || b - a > 30) return undefined;
      for (let i = a; i <= b; i++) out.push(i);
    }
    return out.length ? out : undefined;
  };
  type M = { raw: string; start: number; end: number; nums: number[] };
  const found: M[] = [];
  for (const m of text.matchAll(/\[(\d{1,3}(?:\s*[-–—,，、;；]\s*\d{1,3})*)\](?:\s*[-–—]\s*\[(\d{1,3})\])?/g)) {
    let nums = expand(m[1]);
    if (!nums) continue;
    if (m[2]) {
      const to = Number(m[2]);
      const from = nums[nums.length - 1];
      if (to > from && to <= max && to - from <= 30) for (let i = from + 1; i <= to; i++) nums.push(i);
      else nums = nums.slice();
    }
    found.push({ raw: m[0], start: m.index!, end: m.index! + m[0].length, nums });
  }
  // Superscripts only count when the paper does not use [n] (otherwise they are affiliations/footnotes), and
  // never before the body starts (author affiliations "Kang¹, Oh²" sit above the abstract/introduction).
  const head = /(?:^|\n)\s*(?:\d+\.?\s*)?(?:abstract|resumo|summary|introduction|introdução|background)\b/i.exec(text.slice(0, Math.floor(text.length * 0.3)));
  const bodyStart = head ? head.index : 0;
  for (const sp of found.length >= 3 ? [] : sups) {
    if (sp.start < bodyStart) continue;
    const raw = text.slice(sp.start, sp.end).replace(/\s+/g, '').replace(/[,;]$/, '');
    const nums = /^\d/.test(raw) ? expand(raw.replace(/[−]/g, '-')) : undefined;
    if (nums && !found.some((f) => f.start < sp.end && sp.start < f.end)) found.push({ raw: text.slice(sp.start, sp.start + raw.length), start: sp.start, end: sp.start + raw.length, nums });
  }
  if (found.length === 0) {
    const paren: M[] = [];
    for (const m of text.matchAll(/\((\d{1,3}(?:\s*[-–,]\s*\d{1,3})*)\)/g)) {
      const nums = expand(m[1]);
      if (nums) paren.push({ raw: m[0], start: m.index!, end: m.index! + m[0].length, nums });
    }
    if (paren.length >= 3) found.push(...paren);
  }
  return found.flatMap((f) =>
    [...new Set(f.nums)].map((n) => ({ authors: [] as string[], etAl: false, year: 0, yearLabel: '', raw: f.raw, start: f.start, end: f.end, numericPub: byNumber.get(n) ?? null })),
  );
}

function scoreOccurrence(
  occ: CitationOccurrence,
  pub: PublicationNode,
  graph: CitationGraph,
  texts: Record<string, PdfText>,
  indexFor: (fileId: string) => ReferenceIndex | undefined,
  termsCache: Map<string, Set<string>>,
  params: EvidenceParams,
  collect?: (pm: PendingMatch) => void,
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
  if (params.matcher === 'v2') {
    const parts = claimPartsOf(occ);
    const query = buildQuery(parts, params.match);
    // neighbouring sentences only help ranking; the cited sentence itself must carry searchable content
    const own = buildQuery({ local: parts.local, sentence: parts.sentence }, params.match);
    if (own.filter((q) => q.t[0] !== '#' || q.t.length > 3).length < params.minClaimTerms) {
      occ.status = 'nao_localizado';
      occ.reason = 'frase_curta';
      occ.notes.push('A frase que cita tem pouco conteúdo pesquisável (por exemplo, só o nome do autor); não há como buscar a passagem.');
      return;
    }
    const candidates = lexicalCandidates(index, query, params.match, params.maxPassageChars);
    const pm: PendingMatch = { occId: occ.id, fileId, index, parts, candidates };
    collect?.(pm);
    finalizeV2(occ, pm, params);
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

export const claimPartsOf = (occ: Pick<CitationOccurrence, 'claim' | 'localClaim' | 'context'>): ClaimParts => ({ local: occ.localClaim, sentence: occ.claim, context: occ.context });

/** A v2 occurrence waiting for its final label (and, optionally, a semantic re-rank of its candidates). */
export interface PendingMatch {
  occId: string;
  fileId: string;
  index: ReferenceIndex;
  parts: ClaimParts;
  candidates: Candidate[];
  /** Sentence-level cosine similarity with the claim, filled when the multilingual model has run. */
  sentenceSem?: Map<string, number>;
}

const zscores = (a: number[]) => {
  const m = a.reduce((x, y) => x + y, 0) / (a.length || 1);
  const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length || 1)) || 1;
  return a.map((v) => (v - m) / sd);
};

/**
 * Orders the candidates (lexical only, or lexical + cosine similarity when `sem` is present) and sets `score`
 * (absolute 0..1 value used by the thresholds). Returns whether embeddings took part.
 */
export function fuseCandidates(cands: Candidate[], params: EvidenceParams): boolean {
  const semantic = cands.length > 0 && cands.every((c) => c.sem !== undefined);
  const { lambdaRank, lambda, semFloor, semCeil } = params.fusion;
  if (!semantic) {
    for (const c of cands) c.score = c.lex;
    cands.sort((a, b) => b.lex - a.lex || a.len - b.len || a.start - b.start);
    return false;
  }
  const zl = zscores(cands.map((c) => c.lex));
  const zs = zscores(cands.map((c) => c.sem as number));
  const rank = new Map(cands.map((c, i) => [c, (1 - lambdaRank) * zl[i] + lambdaRank * zs[i]]));
  for (const c of cands) c.score = (1 - lambda) * c.lex + lambda * Math.min(1, Math.max(0, ((c.sem as number) - semFloor) / (semCeil - semFloor)));
  cands.sort((a, b) => (rank.get(b) as number) - (rank.get(a) as number) || a.start - b.start);
  return true;
}

/** Page cited in a marker: "(Silva, 2020, p. 12)", "(SILVA, 2020, p. 12-14)". */
export function citedPages(marker: string): number[] | undefined {
  const m =
    /\bp(?:p|ág|ag)?\.\s*(\d{1,4})(?:\s*[-–]\s*(\d{1,4}))?/i.exec(marker) ||
    /第\s*(\d{1,4})\s*(?:[-–至到]\s*(\d{1,4}))?\s*页/.exec(marker) ||
    /页\s*(\d{1,4})(?:\s*[-–]\s*(\d{1,4}))?/.exec(marker);
  if (!m) return undefined;
  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  if (b < a || b - a > 30) return [a];
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

const foldQuote = (s: string) => foldCjk(stripDiacritics(s)).toLowerCase().replace(/[\u00ad-]/g, '').replace(/[^\p{L}\p{N}]+/gu, '').trim();

/** Direct quotations (4+ words between quotes) in a sentence. */
export function directQuotes(sentence: string): string[] {
  const out: string[] = [];
  for (const m of sentence.matchAll(/[“"«「『]([^”"»」』]{8,600})[”"»」』]/g)) {
    const t = m[1].trim();
    const compact = t.replace(/\s+/g, '');
    const words = t.split(/\s+/).filter(Boolean);
    if (/\p{Script=Han}/u.test(compact) ? compact.length >= 8 : words.length >= 4) out.push(t);
  }
  return out;
}

/** Numbers of the claim worth checking: decimals and 3+ digit integers that are not years nor the cited pages. */
function checkableNumbers(claim: string, pages: number[] = []): string[] {
  const out = new Set<string>();
  for (const m of stripDiacritics(claim).matchAll(/(?<![\w.,])(\d+(?:[.,]\d+)?)(?![\w]|[.,]\d)/g)) {
    const raw = m[1].replace(',', '.');
    const n = Number(raw);
    if (!raw.includes('.') && raw.length < 3) continue;
    if (!raw.includes('.') && n >= 1900 && n <= 2099) continue;
    if (pages.includes(n)) continue;
    out.add(raw);
  }
  return [...out];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * Labels an occurrence from its candidates.
 *
 * "Ressalva" is reserved for a concrete, checkable problem, each with its own reason:
 *  - the page given in the marker does not exist in the source PDF, or holds nothing similar (`pagina_citada`);
 *  - a direct quotation is not in the source (`citacao_direta`);
 *  - a number attributed to this citation (decimal, or 3+ digits, not a year) occurs nowhere in the source (`numero_ausente`).
 * A passage below the similarity floor is "não localizado". Anything else that matched is "localizado", with its
 * similarity shown: a low similarity is common across languages (PT text citing EN sources) and is NOT a defect of
 * the citation, so it no longer produces a ressalva (that rule flagged 45 of 56 citations wrongly on the internal gold set).
 */
export function finalizeV2(occ: CitationOccurrence, pm: PendingMatch, params: EvidenceParams) {
  const cands = pm.candidates;
  const semantic = fuseCandidates(cands, params);
  const th = semantic ? { strong: params.v2.strongSem, weak: params.v2.weakSem } : { strong: params.v2.strong, weak: params.v2.weak };
  let ordered = cands;
  occ.notes = [];
  occ.reason = undefined;
  const S = pm.index.sentences;
  const x = indexV2(pm.index);

  // 1. direct quotations are checked literally
  const quotes = directQuotes(occ.sentence ?? occ.claim ?? '');
  let quoteOk: boolean | undefined;
  if (quotes.length && !/tradu[cç][aã]o\s+(?:nossa|livre)/i.test(occ.sentence ?? '')) {
    const flow = foldQuote(S.map((s) => s.text).join(' '));
    const missing = quotes.filter((q) => !flow.includes(foldQuote(q)));
    quoteOk = missing.length === 0;
    if (quoteOk) {
      const q = foldQuote(quotes[0]);
      const hit = S.findIndex((s, i) => foldQuote(s.text + ' ' + (S[i + 1]?.text ?? '')).includes(q.slice(0, 60)));
      if (hit >= 0) {
        const c: Candidate = { start: hit, len: 1, lex: 1, page: S[hit].page, region: S[hit].region, text: windowText(S, hit, 2, params.maxPassageChars), missingNumbers: [], matchedTerms: 1, score: 1 };
        ordered = [c, ...cands.filter((o) => o.start !== hit)];
      }
    }
  }

  // 2. cited page ("p. 12"): physical page from the printed page numbers of the PDF when they can be read
  const pages = citedPages(occ.marker ?? '');
  let pageProblem: string | undefined;
  if (pages && S.length) {
    const printed = printedPageMap(pm.index);
    const physical = printed.size ? pages.map((p) => printed.get(p)).filter((p): p is number => p !== undefined) : pages.filter((p) => p <= pm.index.pageCount);
    const label = pages.length > 1 ? `p. ${pages[0]}–${pages[pages.length - 1]}` : `p. ${pages[0]}`;
    if (physical.length === 0 && printed.size) {
      const nums = [...printed.keys()];
      pageProblem = `A página citada (${label}) não existe no PDF da fonte (numeração ${Math.min(...nums)}–${Math.max(...nums)}).`;
    } else if (physical.length) {
      const all = lexicalCandidates(pm.index, buildQuery(pm.parts, params.match), { ...params.match, topK: 400 }, params.maxPassageChars);
      const onPage = all.filter((c) => physical.includes(c.page)).sort((a, b) => b.lex - a.lex)[0];
      if (onPage && onPage.lex >= th.weak) {
        onPage.score = semantic ? Math.max(onPage.lex, onPage.score) : onPage.lex;
        ordered = [onPage, ...ordered.filter((o) => o.start !== onPage.start)];
        occ.notes.push(`Há um trecho parecido na página citada (${label}).`);
      } else if (ordered[0] && ordered[0].score >= th.weak) {
        pageProblem = `Na página citada (${label}) não há trecho parecido; o mais parecido está na p. ${ordered[0].page} do PDF (similaridade ${pct(ordered[0].score)}).`;
      }
    } else occ.notes.push(`Não foi possível conferir a página citada (${label}): o PDF não traz a numeração impressa.`);
  }

  const claimForFocus = occ.localClaim || occ.claim || '';
  occ.passages = ordered
    .slice(0, params.maxPassages)
    .filter((c, i) => i === 0 || c.score >= params.minShown)
    .map((c) => {
      const window = S.slice(c.start, c.start + c.len);
      const focus = bestPassageFocus(window, claimForFocus, { authors: authorsFromMarker(occ.marker ?? ''), sentenceSem: pm.sentenceSem });
      if (focus?.exact) {
        return { fileId: pm.fileId, page: focus.page, text: c.text, focus: focus.text, score: round(c.score), region: c.region };
      }
      return { fileId: pm.fileId, page: c.page, text: c.text, focusApproximate: window.length > 1, score: round(c.score), region: c.region };
    });
  const best = ordered[0];
  occ.score = best ? round(best.score) : 0;

  // 3. numbers that occur nowhere in the source
  // 0,8588 in the text is often 85.88% in the source (and vice versa); rounding to 1-2 decimals is accepted too
  const present = (n: string) => {
    const v = Number(n);
    const forms = [n, String(+(v * 100).toFixed(4)), String(+(v / 100).toFixed(6))];
    if ([...x.df.keys()].some((t) => t[0] === '#' && forms.some((f) => t === '#' + f))) return true;
    if (!n.includes('.')) return false;
    return [...x.df.keys()].some((t) => {
      if (t[0] !== '#' || !t.includes('.')) return false;
      const u = Number(t.slice(1));
      return [v, v * 100, v / 100].some((w) => Math.abs(u - w) < 0.051 * Math.max(1, Math.abs(w) / 100) && u.toString().length >= 3);
    });
  };
  // Only numbers uniquely attributed to this citation (never every number in the sentence).
  const toCheck = occ.attributedNumbers ?? checkableNumbers(occ.localClaim ?? '', pages);
  const absent = toCheck.filter((n) => !present(n));

  if (quoteOk === false) {
    occ.status = 'ressalva';
    occ.reason = 'citacao_direta';
    occ.why = 'O trecho entre aspas não aparece literalmente no PDF da fonte.';
  } else if (pageProblem) {
    occ.status = 'ressalva';
    occ.reason = 'pagina_citada';
    occ.why = pageProblem;
  } else if (!best || best.score < th.weak) {
    occ.status = 'nao_localizado';
    occ.reason = 'sem_passagem';
    occ.why = best ? `Nenhum trecho parecido no PDF (melhor similaridade ${pct(best.score)}, mínimo ${pct(th.weak)}).` : 'Nenhum trecho do PDF tem termos em comum com a frase.';
    occ.notes.push('Nenhuma passagem do PDF tem sobreposição suficiente com a frase.');
    return;
  } else if (absent.length) {
    occ.status = 'ressalva';
    occ.reason = 'numero_ausente';
    occ.why = `${absent.length > 1 ? 'Os números' : 'O número'} ${absent.join(', ')} da frase não ${absent.length > 1 ? 'aparecem' : 'aparece'} em nenhum lugar do PDF da fonte.`;
  } else {
    occ.status = 'localizado';
    occ.why = quoteOk ? `Citação direta encontrada literalmente na p. ${best.page}.` : `Trecho com ${pct(best.score)} de similaridade na p. ${best.page}${best.score < th.strong ? ' (similaridade baixa: confira o trecho)' : ''}.`;
  }
  if (occ.status === 'ressalva' && occ.why) occ.notes.unshift(occ.why);
  if (best && best.missingNumbers.length && !absent.length && occ.reason !== 'numero_ausente') occ.notes.push(`Número(s) da frase que estão no PDF, mas não neste trecho: ${best.missingNumbers.join(', ')}.`);
  if (best?.region === 'resumo') occ.notes.push('A passagem mais próxima está no resumo/início do artigo; confira o corpo do texto.');
}

/** Printed page number -> physical page, read from the page-number lines at the top/bottom of each page. */
export function printedPageMap(index: ReferenceIndex): Map<number, number> {
  const m = new Map<number, number>();
  for (const [phys, printed] of index.printedPages ?? []) if (!m.has(printed)) m.set(printed, phys);
  // only trust a numbering that advances with the pages (offset constant for most pages)
  const offsets = new Map<number, number>();
  for (const [printed, phys] of m) offsets.set(printed - phys, (offsets.get(printed - phys) ?? 0) + 1);
  const [bestOffset, votes] = [...offsets].sort((a, b) => b[1] - a[1])[0] ?? [0, 0];
  if (votes < Math.max(2, m.size * 0.5)) return new Map();
  const out = new Map<number, number>();
  for (let phys = 1; phys <= index.pageCount; phys++) out.set(phys + bestOffset, phys);
  return out;
}

// ---------------------------------------------------------------------------
// Manual labels
// ---------------------------------------------------------------------------

/** Applies the researcher's own labels (they win over the automatic and curated ones; the automatic label is kept). */
export function applyOverrides(report: EvidenceReport, overrides: Record<string, { status: EvidenceStatus; at: string }> | undefined): EvidenceReport {
  if (!overrides || Object.keys(overrides).length === 0) return report;
  const occurrences = report.occurrences.map((o) => {
    const ov = overrides[o.id];
    if (!ov) return o;
    return { ...o, status: ov.status, override: { status: ov.status, at: ov.at, auto: o.status, autoReason: o.reason, autoWhy: o.why } };
  });
  return { ...report, occurrences, summary: summarizeOccurrences(occurrences) };
}

/** Same as applyOverrides, on a report that may already carry overrides (they are undone first). */
export function reapplyOverrides(report: EvidenceReport, overrides: Record<string, { status: EvidenceStatus; at: string }> | undefined): EvidenceReport {
  const occurrences = report.occurrences.map((o) => {
    if (!o.override) return o;
    const { override, ...rest } = o;
    return { ...rest, status: override.auto, reason: override.autoReason, why: override.autoWhy };
  });
  const base = { ...report, occurrences, summary: summarizeOccurrences(occurrences) };
  return applyOverrides(base, overrides);
}

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
      localClaim: mainPrivate ? undefined : o.localClaim,
      context: mainPrivate ? undefined : o.context,
      rects: mainPrivate ? [] : o.rects,
      notes: o.notes,
      passages: o.passages.map((p) => ({ ...p, text: isPrivate(p.fileId) ? REDACTED_TEXT : p.text, focus: isPrivate(p.fileId) ? undefined : p.focus, focusApproximate: isPrivate(p.fileId) ? undefined : p.focusApproximate })),
    })),
  };
}

/**
 * A narrative marker may have caught the words before the name ("Nele, V Nasser e Egler (2023)", "Marres. Bragato,
 * Nicolas e Sampaio (2012)"): shown from the cited surname on. Spelling slips keep working ("Bragato" for "Bragatto").
 */
export function trimNarrativeMarker(raw: string, pub: PublicationNode | undefined): string {
  const fold = (x: string) => stripDiacritics(x).toLowerCase();
  const PARTICLE = /^(?:de|da|do|dos|das|van|von|der|den|del|di|le|la)$/;
  // any author of the work counts: a text may list them in another order ("Almada, Jesus e Amaral" for JESUS; ALMADA)
  const names = (pub?.authors ?? []).flatMap((a) => fold(`${a.family} ${a.given ?? ''}`).split(/[\s.\-]+/)).filter((w) => w.length >= 3 && !PARTICLE.test(w));
  if (!names.length) return raw;
  const words = [...raw.matchAll(/\p{L}[\p{L}'’\-]*/gu)];
  for (let k = 0; k < words.length; k++) {
    const f = fold(words[k][0]);
    const hit = names.some((n) => {
      let c = 0;
      while (c < f.length && c < n.length && f[c] === n[c]) c++;
      return f === n || c >= Math.min(5, n.length);
    });
    if (!hit) continue;
    const at = k > 0 && PARTICLE.test(fold(words[k - 1][0])) ? words[k - 1].index! : words[k].index!;
    return at ? raw.slice(at) : raw;
  }
  return raw;
}
