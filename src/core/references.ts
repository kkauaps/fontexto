/**
 * Reference-list (bibliography) extraction from PDF text and matching of
 * reference entries to known publications.
 *
 * This is a heuristic, offline extractor. It keeps the raw entry text, the
 * physical page and the line rectangles reported by the PDF extractor, so every
 * `cites` edge can be traced back to the exact entry in the source PDF.
 * A GROBID-based extractor can replace `extractReferenceEntries` later without
 * changing the matching logic.
 */
import type { Rect, PublicationNode } from './model.js';
import { findDois, normalizeDoi, normalizeName, normalizeTitle, titleTokens } from './normalize.js';
import { joinLines, type PdfText, type TextLine } from './text.js';

export interface ReferenceEntry {
  /** Order inside the bibliography (0-based). */
  index: number;
  /** Label as printed, e.g. "[12]" or "12.", if numbered. */
  label?: string;
  text: string;
  /** Page of the first line of the entry. */
  page: number;
  /** Line rectangles on the first page of the entry (from the extractor). */
  rects: Rect[];
  pageSize: { width: number; height: number };
  dois: string[];
  years: number[];
}

/** Section number before a heading: "7 REFERÊNCIAS", "7. References", "VII – Bibliografía", "A.1 Anexo". */
const SECTION_NUMBER = String.raw`(?:(?:\d{1,2}(?:\.\d{1,2})*|[IVX]{1,5})(?:[.)]\s*|\s+|(?=\s*[-–—]))(?:[-–—]\s*)?)?`;

const HEADING_TERMS = [
  String.raw`references?(?:\s+(?:and\s+notes|cited))?`,
  String.raw`(?:list\s+of\s+)?references`,
  String.raw`reference\s+list`,
  String.raw`bibliography(?:\s+and\s+references)?`,
  String.raw`(?:literature|works|sources)\s+cited`,
  String.raw`cited\s+(?:literature|works)`,
  String.raw`(?:lista\s+de\s+)?refer[eêé]ncias?(?:\s+(?:bibliogr[aá]ficas?|consultadas|citadas|utilizadas))?`,
  String.raw`bibliograf[ií]as?(?:\s+(?:consultadas?|citadas?|b[aá]sicas?|utilizadas?))?`,
  String.raw`obras\s+(?:citadas|consultadas)`,
  String.raw`(?:fontes|fuentes)\s+(?:bibliogr[aá]ficas|consultadas)`,
  String.raw`bibliographie`,
  String.raw`r[ée]f[ée]rences(?:\s+bibliographiques)?`,
  String.raw`literatur(?:verzeichnis|angaben|liste)?`,
  String.raw`quellen(?:verzeichnis|angaben)?`,
  String.raw`riferimenti\s+bibliografici`,
  String.raw`(?:библиографический\s+)?список\s+(?:(?:использованн|цитируем|рекомендуем)(?:ой|ых)\s+)?(?:литературы|источников)(?:\s+и\s+литературы)?`,
  String.raw`библиографи(?:я|ческий\s+список)`,
  String.raw`литература`,
  String.raw`(?:主要)?参考文献`,
  String.raw`参考资料`,
  String.raw`引用文献`,
  String.raw`(?:引用|参考)\s*[・･]\s*(?:参考|引用)文献`,
  String.raw`文献(?:目録|一覧|リスト)`,
  String.raw`참고\s*문헌`,
];
const HEADING_RE = new RegExp(String.raw`^${SECTION_NUMBER}(?:${HEADING_TERMS.join('|')})\s*[:：.]?$`, 'iu');

const STOP_TERMS = [
  String.raw`appendix`,
  String.raw`appendices`,
  String.raw`ap[eêé]ndices?`,
  String.raw`anexos?`,
  String.raw`annex(?:es|e)?`,
  String.raw`anhang`,
  String.raw`anh[äa]nge`,
  String.raw`приложени[еяй]`,
  String.raw`附\s*[录錄]`,
  String.raw`付\s*録`,
  String.raw`supplementary(?:\s+(?:materials?|information|data))?`,
  String.raw`supporting\s+information`,
  String.raw`acknowledg(?:e)?ments?`,
  String.raw`agradecimentos?`,
  String.raw`agradecimientos`,
  String.raw`remerciements`,
  String.raw`danksagung`,
  String.raw`благодарност[ьи]`,
  String.raw`致\s*谢`,
  String.raw`謝\s*辞`,
  String.raw`author\s+contributions`,
  String.raw`funding`,
  String.raw`conflicts?\s+of\s+interest`,
  String.raw`competing\s+interests`,
  String.raw`declaration\s+of\s+(?:competing\s+interests?|interests?)`,
  String.raw`data\s+availability(?:\s+statement)?`,
  String.raw`abbreviations`,
  String.raw`biograph(?:y|ies)`,
  String.raw`about\s+the\s+authors?`,
  String.raw`sobre\s+(?:o|a|os|as)\s+autor(?:a|es|as)?`,
  String.raw`gloss[aá]rio`,
  String.raw`glossary`,
  String.raw`[ií]ndice\s+remissivo`,
  String.raw`index`,
  String.raw`索\s*引`,
];
/**
 * A heading that ends the bibliography (appendix, annex, acknowledgements, ...). It must look like a heading: the
 * term alone, with an optional designator ("ANEXO A", "Apêndice 2", "Приложение Б") and an optional title after a
 * dash or colon ("APÊNDICE A – Questionário"). "anexo da Portaria n. 12, 2010." inside an entry is not a heading.
 */
const STOP_RE = new RegExp(
  String.raw`^${SECTION_NUMBER}(${STOP_TERMS.join('|')})(?:\s*(?:\p{L}|\d{1,2}|[IVX]{1,4})(?![\p{L}\d])(?:\s*[-–—:.：]?\s*.{0,100})?|\s*(?:[-–—:.：]\s*.{0,100})?)$`,
  'iu',
);

/** "R E F E R Ê N C I A S" (letter-spaced headings) -> "REFERÊNCIAS". */
function collapseLetterSpacing(t: string): string {
  return /^(?:\S\s){3,}\S$/u.test(t) ? t.replace(/\s/g, '') : t;
}

/** True for a line that reads as a bibliography heading. */
export function isReferenceHeading(text: string): boolean {
  return HEADING_RE.test(collapseLetterSpacing(text.normalize('NFKC').trim()));
}

/** True for a heading that closes the bibliography (appendix, annex, acknowledgements, index, ...). */
export function isSectionStop(text: string): boolean {
  const t = collapseLetterSpacing(text.normalize('NFKC').trim());
  if (t.length >= 110 || /^\p{Ll}/u.test(t)) return false;
  // journal footer after the list: "Recebido: 01/05/2023 | Aprovado: 01/05/2023", "Received: … Accepted: …"
  if (/^(?:Recebido|Received|Recibido|Submetido|Submitted|Data de (?:recebimento|submissão)|Aceito|Aprovado|Accepted)\s*(?:em|en|on)?\s*:?\s*\d{1,2}[/.\-\s]/iu.test(t)) return true;
  const m = STOP_RE.exec(t);
  if (!m) return false;
  // "ANEXO A – Relatório de 2013" is a heading; "Annex to Regulation 12, 2010." (mixed case, ending like an entry) is not
  const caps = m[1] === m[1].toUpperCase() && /\p{Lu}/u.test(m[1]);
  return caps || !/\b(?:1[89]|20)\d{2}[a-z]?\)?\.$/.test(t);
}

const NUMBERED_PATTERNS: { re: RegExp; name: string }[] = [
  { re: /^\[(\d{1,3})\]\s*/, name: 'bracket' },
  { re: /^(\d{1,3})\.\s+(?=\S)/, name: 'dot' },
  { re: /^(\d{1,3})\s+(?=\p{Lu})/u, name: 'bare' },
];

const AUTHOR_START_RE = new RegExp(
  [
    // "Ronneberger, O.", "Kessel-Brandt, Lena", "van Dalen, J. J."
    String.raw`^(?:(?:van|von|de|da|der|den|dos|del|di|le)\s+)?\p{Lu}[\p{L}'’\-]+(?:\s\p{Lu}[\p{L}'’\-]+)?,\s*(?:\p{Lu}\.|\p{Lu}\p{Ll}+)`,
    // Vancouver: "Ronneberger O, Fischer P"
    String.raw`^\p{Lu}[\p{L}'’\-]+(?:\s\p{Lu}[\p{L}'’\-]+)?\s+\p{Lu}{1,3}[,.](?:\s|$)`,
    // ABNT: "SILVA, J." / "KESSEL-BRANDT, L."
    String.raw`^\p{Lu}{2,}[\p{Lu}'’\-]*(?:\s\p{Lu}{2,}[\p{Lu}'’\-]*)?,\s`,
    // ABNT corporate author: "CVAT.AI. CVAT documentation.", "OMS. Relatório ..."
    String.raw`^\p{Lu}{2,}(?:\.\p{Lu}{1,3})?\.\s+\p{Lu}`,
    // French/European author-year in capitals without comma: "BARJOT D. (2012)", "DI NEZZA E., PALATUCCI G."
    String.raw`^\p{Lu}{2,}[\p{Lu}'’\-]*(?:\s\p{Lu}{2,}[\p{Lu}'’\-]*)?\s\p{Lu}\.(?:\s?\p{Lu}\.)*[,\s(]`,
    // APA corporate author with the year on the same line: "World Health Organization. (2020)."
    String.raw`^\p{Lu}[\p{L}&,.'’\-\s]{2,120}?\(\s*(?:1[89]|20)\d{2}[a-z]?\s*\)\.`,
    // GB/T / CJK: "张三, 李四. 标题" or "张三。标题" or "张三等."
    String.raw`^[\p{Script=Han}]{2,4}(?:·[\p{Script=Han}]{1,4})?(?:\s*[,，、]\s*[\p{Script=Han}]{2,4}|\s*等|[.．。])`,
    // Japanese / Chinese author-year: "山田太郎（2010）", "佐藤・鈴木 (2019)", "スミス, J. (2015)"
    String.raw`^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー・･、，,\s]{2,24}?\s*[（(]\s*(?:1[89]|20)\d{2}`,
    // ABNT repeated author: "______. Outro título. 2010."
    String.raw`^_{2,}\s*\.?`,
    // ABNT authors in capitals joined by "&" or "e": "WEINDENFELD & NICOLSON."
    String.raw`^\p{Lu}{2,}[\p{Lu}'’\-]*\s*(?:&|\be\b|\band\b)\s*\p{Lu}{2,}`,
    // ABNT corporate author in capitals: "UNIVERSIDADE FEDERAL DO NORTE. Manual ...", "BRASIL. Lei n. 1"
    String.raw`^\p{Lu}{2,}(?:[\s\-]+(?:\p{Lu}{2,}[\p{Lu}'’\-]*|D[AEO]S?|E|OF|THE|AND|DEL?|LA|LOS|DU|DES|ET)){1,10}\.\s+\S`,
  ].join('|'),
  'u',
);

/** ABNT entry by title (no author): first word in capitals, "ESTUDO temático sobre ...", "MANUAL de normas". */
const TITLE_FIRST_RE = /^\p{Lu}{3,}[\p{Lu}'’\-]*\s+\p{Ll}/u;
const looksLikeEntryStart = (t: string) => AUTHOR_START_RE.test(t) || TITLE_FIRST_RE.test(t);

const YEAR_RE = /\b(1[89]\d{2}|20\d{2})[a-z]?\b/g;
const HAS_YEAR_RE = /\b(1[89]\d{2}|20\d{2})[a-z]?\b/;

export function isPageNumber(text: string) {
  return /^(?:page\s*)?\d{1,4}(?:\s*(?:of|\/|de)\s*\d{1,4})?$/i.test(text.trim());
}

/** Fraction of the page height, at the top and at the bottom, where running headers and footers are looked for. */
const MARGIN_BAND = 0.1;

/** Lines repeated on many pages (running headers/footers), with digits masked. */
export function repeatedLines(pdf: PdfText): Set<string> {
  // A running header/footer sits in the top or bottom margin band and at (almost) the same height on every page.
  // Body lines that repeat (e.g. "Journal of X, vol. #" continuing several reference entries) move around and must
  // never be dropped: they carry the year and the DOI of the entry.
  const counts = new Map<string, number>();
  for (const p of pdf.pages) {
    const seen = new Set<string>();
    for (const l of p.lines) {
      if (p.height && l.rect.y > p.height * MARGIN_BAND && l.rect.y + l.rect.h < p.height * (1 - MARGIN_BAND)) continue;
      const k = l.text.replace(/\d+/g, '#').trim().toLowerCase();
      if (k.length < 4) continue;
      const ky = `${k}\u0000${Math.round(l.rect.y / 6)}`;
      if (seen.has(ky)) continue;
      seen.add(ky);
      counts.set(ky, (counts.get(ky) ?? 0) + 1);
    }
  }
  const out = new Set<string>();
  if (pdf.pages.length < 3) return out;
  for (const [ky, c] of counts) if (c >= Math.max(3, pdf.pages.length * 0.4)) out.add(ky.split('\u0000')[0]);
  return out;
}

/** Every line that reads as a bibliography heading, in document order. */
function headingCandidates(pdf: PdfText): ReferenceStart[] {
  const out: ReferenceStart[] = [];
  for (const p of pdf.pages) {
    p.lines.forEach((l, idx) => {
      if (isReferenceHeading(l.text)) out.push({ page: p.page, line: idx });
    });
  }
  return out;
}

/**
 * Heading of the bibliography. When several lines read as one (the table of contents, a bibliography inside an
 * annexed project, one list per chapter), it is the start of the first section kept by `referenceSections`.
 */
export function findReferenceHeading(pdf: PdfText): ReferenceStart | undefined {
  return referenceSections(pdf, { fallback: false })[0]?.start;
}

export interface ReferenceStart {
  page: number;
  /** Heading line, or (when `implicit`) the first entry line. */
  line: number;
  /** True when no heading was found and the list was detected from the shape of the lines at the end of the text. */
  implicit?: boolean;
}

const TAIL_NUMBER_RE = /^(?:\[(\d{1,3})\]|(\d{1,3})\.)\s+\S/;

/**
 * Fallback for documents whose bibliography has no recognisable heading (or a heading in a language we do not know):
 * finds the last dense run of lines that look like reference entries (numbered "[n]"/"n." in order, or author-first
 * lines with a year close by) after the first fifth of the text. Returns the first entry of that run.
 */
export function findReferenceTail(pdf: PdfText): ReferenceStart | undefined {
  const repeated = repeatedLines(pdf);
  const lines: { page: number; line: number; text: string }[] = [];
  for (const p of pdf.pages) {
    p.lines.forEach((l, i) => {
      const t = l.text.normalize('NFKC').trim();
      if (!t || isPageNumber(t) || repeated.has(t.replace(/\d+/g, '#').toLowerCase())) return;
      lines.push({ page: p.page, line: i, text: t });
    });
  }
  if (lines.length < 6) return undefined;
  const yearNear = (i: number) => lines.slice(i, i + 4).some((l) => HAS_YEAR_RE.test(l.text));
  const starts: { i: number; n?: number }[] = [];
  lines.forEach((l, i) => {
    const m = TAIL_NUMBER_RE.exec(l.text);
    if (m && yearNear(i)) starts.push({ i, n: Number(m[1] ?? m[2]) });
    else if (AUTHOR_START_RE.test(l.text) && yearNear(i)) starts.push({ i });
  });
  if (starts.length < 3) return undefined;
  // Walk back from the last candidate while the gaps stay small: that is the trailing list.
  const MAX_GAP = 8;
  let first = starts.length - 1;
  while (first > 0 && starts[first].i - starts[first - 1].i <= MAX_GAP) first--;
  let run = starts.slice(first);
  // Numbered list: start at the entry numbered 1 (or 2) and keep the run only when the numbers mostly ascend.
  const numbered = run.filter((s) => s.n !== undefined);
  if (numbered.length >= run.length * 0.6) {
    const one = run.findIndex((s) => s.n !== undefined && s.n <= 2);
    if (one < 0) return undefined;
    run = run.slice(one);
    const ns = run.map((s) => s.n).filter((n): n is number => n !== undefined);
    let asc = 0;
    for (let k = 1; k < ns.length; k++) if (ns[k] === ns[k - 1] + 1) asc++;
    if (asc < Math.max(2, (ns.length - 1) * 0.6)) return undefined;
  }
  if (run.length < 3) return undefined;
  // The list must come after the opening of the text (not a title-page author list) and cover most of what follows it.
  const begin = run[0].i;
  if (begin < lines.length * 0.2) return undefined;
  const span = lines.length - begin;
  if (run.length / span < 0.12) return undefined;
  return { page: lines[begin].page, line: lines[begin].line, implicit: true };
}

/** Heading of the bibliography, or the detected start of a trailing reference list without a heading. */
export function findReferenceStart(pdf: PdfText): ReferenceStart | undefined {
  return referenceSections(pdf, { fallback: true })[0]?.start;
}

interface SectionLine extends TextLine {
  page: number;
  /** Index of the line on its page. */
  line: number;
}

interface Section {
  start: ReferenceStart;
  /** Exclusive end (page, line), undefined when the section runs to the end of the file. */
  end?: { page: number; line: number };
  lines: SectionLine[];
  groups: { lines: SectionLine[]; label?: string }[];
}

const posBefore = (a: { page: number; line: number }, b: { page: number; line: number }) => a.page < b.page || (a.page === b.page && a.line < b.line);

/**
 * Lines of a section from its heading (or first entry) up to the next heading that closes it: an appendix, annex,
 * acknowledgements, ... or another bibliography heading. Running headers, footers and page numbers are dropped.
 */
function readSection(pdf: PdfText, start: ReferenceStart, repeated: Set<string>): Pick<Section, 'start' | 'end' | 'lines'> {
  const out: SectionLine[] = [];
  for (const p of pdf.pages) {
    if (p.page < start.page) continue;
    const from = p.page === start.page ? start.line + (start.implicit ? 0 : 1) : 0;
    const minX = Math.min(...p.lines.map((l) => l.rect.x));
    // a running header/footer that repeatedLines cannot see (short documents): a line set off from the lines
    // around it by a wide gap (or out of reading order) and not aligned with the text (centred or flush right)
    const marginal = (i: number) => {
      const l = p.lines[i];
      if (l.rect.x - minX <= 40) return false;
      const far = (nb: TextLine | undefined) => !nb || Math.abs(nb.rect.y - l.rect.y) > Math.max(l.rect.h, nb.rect.h) * 2.2;
      return far(p.lines[i - 1]) && far(p.lines[i + 1]);
    };
    for (let i = from; i < p.lines.length; i++) {
      const l = p.lines[i];
      const t = l.text.trim();
      if (!t || isPageNumber(t)) continue;
      if (repeated.has(t.replace(/\d+/g, '#').toLowerCase())) continue;
      if (out.length > 0 && (isSectionStop(t) || isReferenceHeading(t))) return { start, end: { page: p.page, line: i }, lines: out };
      if (out.length > 0 && marginal(i)) continue;
      out.push({ ...l, page: p.page, line: i });
    }
  }
  return { start, lines: out };
}

/** Score of a section: entries that carry a year, a DOI or a URL (prose and table-of-contents lines rarely do). */
function sectionScore(groups: Section['groups']): number {
  return groups.filter(entryLike).length;
}

/** A group that reads as a reference entry: it starts like one (or is numbered) and carries a year, DOI or URL. */
function entryLike(g: Section['groups'][number]): boolean {
  // prose paragraphs (the body after a table-of-contents line) are long and do not start like an entry
  if (g.lines.length > 10) return false;
  const first = g.lines[0].text.trim();
  const t = g.lines.map((l) => l.text).join(' ');
  const anchored = HAS_YEAR_RE.test(t) || /\b10\.\d{4,9}\/|https?:\/\/|www\./i.test(t);
  if (g.label) return true;
  return anchored && (looksLikeEntryStart(first) || /^_{2,}/.test(first) || g.lines.length <= 4);
}

const groupKey = (g: Section['groups'][number]) => {
  const t = joinLines(g.lines.map((l) => l.text)).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const first = /^[^\s,.;(]+/u.exec(t.replace(/^\W+/u, ''))?.[0] ?? '';
  return `${first}|${HAS_YEAR_RE.exec(t)?.[1] ?? ''}`;
};

/**
 * The bibliography sections of a document.
 *
 * Every heading candidate is read and segmented; the one with the most entry-like groups wins (so the table of
 * contents, which also says "Referências", and the short list of an annexed research project lose to the real
 * list at the end). Other sections are kept too when they hold at least three entries that are mostly not repeats
 * of the ones already kept: theses made of articles carry one list per chapter. Sections come in document order.
 */
export function referenceSections(pdf: PdfText, opts: { fallback?: boolean } = {}): Section[] {
  const repeated = repeatedLines(pdf);
  const read = (start: ReferenceStart): Section => {
    const sec = readSection(pdf, start, repeated);
    const groups = segmentEntries(sec.lines);
    // the list is over when three groups in a row read as prose (a new chapter without a recognisable heading)
    let run = 0;
    for (let k = 0; k < groups.length; k++) {
      run = entryLike(groups[k]) ? 0 : run + 1;
      if (run === 3 && k - 2 > 0) {
        const cut = groups[k - 2].lines[0];
        return { start, end: { page: cut.page, line: cut.line }, lines: sec.lines.slice(0, sec.lines.indexOf(cut)), groups: groups.slice(0, k - 2) };
      }
    }
    return { ...sec, groups };
  };
  const candidates = headingCandidates(pdf).map(read).filter((s) => s.lines.length > 0);
  if (candidates.length === 0) {
    if (!opts.fallback) return [];
    const tail = findReferenceTail(pdf);
    return tail ? [read(tail)] : [];
  }
  const scored = candidates.map((s) => ({ s, score: sectionScore(s.groups) }));
  let best = scored[0];
  for (const c of scored) if (c.score >= best.score) best = c;
  const kept = [best];
  const keys = new Set(best.s.groups.map(groupKey));
  for (const c of [...scored].sort((x, y) => y.score - x.score)) {
    if (kept.includes(c) || c.score < 3 || c.score < c.s.groups.length * 0.6) continue;
    const ks = c.s.groups.map(groupKey);
    const repeats = ks.filter((k) => keys.has(k)).length;
    if (repeats > ks.length * 0.5) continue;
    kept.push(c);
    for (const k of ks) keys.add(k);
  }
  return kept.map((c) => c.s).sort((x, y) => (posBefore(x.start, y.start) ? -1 : 1));
}

/**
 * Location of the bibliography inside a PDF: from its heading up to the next
 * section that clearly follows it (appendix, acknowledgements, ...), if any.
 * `end` is exclusive and undefined when the list runs to the end of the file.
 * With several bibliography sections, this is the first one; `referenceRanges` lists them all.
 */
export function referenceSectionBounds(
  pdf: PdfText,
  opts: { fallback?: boolean } = {},
): { start: ReferenceStart; end?: { page: number; line: number } } | undefined {
  const s = referenceSections(pdf, opts)[0];
  return s ? { start: s.start, end: s.end } : undefined;
}

/** All bibliography sections as [start, end) ranges, and a predicate telling whether a line falls inside one. */
export function referenceRanges(pdf: PdfText, opts: { fallback?: boolean } = {}) {
  const ranges = referenceSections(pdf, opts).map((s) => ({ start: s.start, end: s.end }));
  const inside = (page: number, line: number) =>
    ranges.some((r) => !posBefore({ page, line }, r.start) && (!r.end || posBefore({ page, line }, r.end)));
  return { ranges, inside };
}

function detectNumbering(lines: SectionLine[]): RegExp | undefined {
  for (const { re } of NUMBERED_PATTERNS) {
    const nums: number[] = [];
    for (const l of lines.slice(0, 80)) {
      const m = re.exec(l.text.trim());
      if (m) nums.push(Number(m[1]));
    }
    // Require a short ascending run starting near 1 to avoid false positives.
    if (nums.length >= 2 && nums[0] <= 2 && nums[1] === nums[0] + 1) return re;
  }
  return undefined;
}

function parseYears(text: string): number[] {
  const out: number[] = [];
  const maxYear = new Date().getFullYear() + 1;
  for (const m of text.matchAll(YEAR_RE)) {
    const y = Number(m[1]);
    if (y <= maxYear && !out.includes(y)) out.push(y);
  }
  return out;
}

/** Same page and column, below the previous line: the vertical distance between them is meaningful. */
const sameFlow = (a: SectionLine, b: SectionLine) => a.page === b.page && b.rect.y > a.rect.y && Math.abs(a.rect.x - b.rect.x) < 120 && b.rect.y - a.rect.y < Math.max(a.rect.h, 8) * 5;

/**
 * Layout of a bibliography, read from the geometry of its lines:
 * - `gap`: entries are separated by a blank line (ABNT asks for it; Word lists usually have it), so a line
 *   that comes after a clearly larger vertical step than the line pitch starts a new entry;
 * - `hanging`: continuation lines are indented (APA, Chicago, MLA), so a line back at the left edge starts one.
 */
function sectionLayout(lines: SectionLine[]): { bigStep?: number; hanging: boolean } {
  const steps: number[] = [];
  for (let i = 1; i < lines.length; i++) if (sameFlow(lines[i - 1], lines[i])) steps.push(lines[i].rect.y - lines[i - 1].rect.y);
  let bigStep: number | undefined;
  if (steps.length >= 4) {
    const sorted = [...steps].sort((x, y) => x - y);
    const pitch = sorted[Math.floor(sorted.length * 0.25)];
    const limit = pitch * 1.4 + 1;
    const big = steps.filter((d) => d > limit).length;
    // a few big steps (2+) but not most of them: that is a blank line between entries
    // …and enough of them: two stray steps (a page break under a running-header fragment) are not a blank-line layout
    if (pitch > 0 && big >= Math.max(2, steps.length * 0.08) && big <= steps.length * 0.7) bigStep = limit;
  }
  // hanging indent: per page/column, lines sit on two x positions 5–40 pt apart, the inner one being continuation
  let indented = 0;
  let flush = 0;
  const left = new Map<string, number>();
  const col = (l: SectionLine) => `${l.page}|${Math.floor(l.rect.x / 250)}`;
  // read it where the list surely is: its first lines (prose of a next chapter may follow without a heading)
  const head = lines.slice(0, 30);
  for (const l of head) left.set(col(l), Math.min(left.get(col(l)) ?? Infinity, l.rect.x));
  for (const l of head) {
    const d = l.rect.x - (left.get(col(l)) ?? l.rect.x);
    if (d >= 5 && d <= 40) indented++;
    else if (d < 2) flush++;
  }
  const hanging = indented >= 3 && indented >= head.length * 0.2 && flush >= 2;
  return { bigStep, hanging };
}

/** How an entry usually ends: its year, a URL or DOI, an access date ("Acesso em: 10 jan. 2020."). */
const ENTRY_END_RE = /(?:\b(?:1[5-9]|20)\d{2}[a-z]?\)?|https?:\/\/\S+|\b10\.\d{4,9}\/\S+|>)\s*[.\]]?\s*$/;
/** Lines that continue an entry even when they start with a capital letter. */
const CONTINUATION_START_RE = /^(?:Dispon[ií]vel|Available|Acesso|Acessado|Accessed|Retrieved|Consultado|Recuperado|In:|In\s|En:|DOI|ISBN|ISSN|URL|https?:|www\.|Tese|Disserta|Thesis|Dissertation|Monografia|Trabalho de Conclus|\[|\(|Дата|Режим|URL:)/iu;

/** Splits the lines of a bibliography section into entries. */
function segmentEntries(all: SectionLine[]): { lines: SectionLine[]; label?: string }[] {
  // lone letters from a running header or a drop cap ("A", "f") are not part of any entry, and would skew the layout
  const lines = all.filter((l) => !/^\p{L}$/u.test(l.text.trim()));
  if (lines.length === 0) return [];
  const numbered = detectNumbering(lines);
  const layout = numbered ? { hanging: false } : sectionLayout(lines);
  const left = new Map<string, number>();
  const col = (l: SectionLine) => `${l.page}|${Math.floor(l.rect.x / 250)}`;
  for (const l of lines) left.set(col(l), Math.min(left.get(col(l)) ?? Infinity, l.rect.x));
  const widths = lines.map((l) => l.rect.w).sort((x, y) => x - y);
  const fullWidth = widths[Math.floor(widths.length * 0.9)] ?? 0;
  const groups: { lines: SectionLine[]; label?: string; hasYear: boolean }[] = [];
  let expected = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.text.trim();
    const current = groups[groups.length - 1];
    const prev = lines[i - 1];
    let start = false;
    let label: string | undefined;
    if (numbered) {
      const m = numbered.exec(t);
      if (m && (groups.length === 0 ? Number(m[1]) <= 2 : Number(m[1]) === expected + 1)) {
        start = true;
        label = m[0].trim();
        expected = Number(m[1]);
      }
    } else if (!current) {
      start = true;
    } else {
      const first = current.lines[0];
      const flow = prev && sameFlow(prev, line);
      // only the last line matters for how the entry ends (and joining every line again would be quadratic)
      const currentText = current.lines[current.lines.length - 1].text.trim();
      const currentComplete = current.hasYear || /[.>]\s*$/.test(currentText) || /https?:\/\/\S+$/.test(currentText);
      const atLeft = line.rect.x - (left.get(col(line)) ?? line.rect.x) < 2;
      if (layout.bigStep !== undefined && flow) {
        // blank line before it: new entry; same pitch: continuation
        start = line.rect.y - prev.rect.y > layout.bigStep;
      } else if (
        layout.bigStep !== undefined &&
        prev &&
        /^[\p{Lu}\p{Lo}_]/u.test(t) &&
        !CONTINUATION_START_RE.test(t) &&
        (looksLikeEntryStart(t) || (currentComplete && prev.rect.w < fullWidth * 0.8) || ENTRY_END_RE.test(currentText))
      ) {
        // page or column break (no vertical step to read): the entry before it is finished — it ends with its year,
        // a URL or an access date, or its last line stops short of the margin — and this line starts like an entry
        start = true;
      } else if (layout.hanging && (flow || currentComplete)) {
        start = atLeft && !/^\p{Ll}/u.test(t);
      } else {
        const sameColumn = first.page === line.page && Math.abs(first.rect.x - line.rect.x) < 120;
        const hangingIndent = sameColumn && line.rect.x > first.rect.x + 3;
        start = !hangingIndent && currentComplete && looksLikeEntryStart(t);
      }
    }
    if (start) groups.push({ lines: [line], label, hasYear: HAS_YEAR_RE.test(t) });
    else if (current) {
      current.lines.push(line);
      if (!current.hasYear && HAS_YEAR_RE.test(t)) current.hasYear = true;
    }
  }
  return groups.map(({ lines, label }) => ({ lines, label }));
}

/** Where a DOI (bare, "doi:" or a doi.org link) ends, with the period that closes the entry. */
const DOI_END_RE = /(?:https?:\/\/(?:dx\.)?doi\.org\/|\bdoi:?\s*)?10\.\d{4,9}\/[^\s"<>]+/giu;
/**
 * The start of another entry: "Surname, X." / "Surname-Name, X" (also OCR-damaged "Schinde1in", line-split "Subr- amanian"),
 * "SURNAME, X." / "UNITED NATIONS CHILDREN'S FUND (2016)", "S. SILVEIRA, Z.", "倪序南." / "Муршед, М.".
 */
const ENTRY_START_RE =
  /^(?:\p{Lu}[\p{L}\d'’]+(?:-\s?[\p{L}]+)*(?:\s+(?:de|da|do|dos|das|van|von|der|del|la|le)?\s*\p{Lu}[\p{L}'’]+)*,\s*\p{Lu}|\p{Lu}{2,}[\p{Lu}\s'’\-]*(?:,|\s\(\d{4})|\p{Lu}\.\s+\p{Lu}{2,}[\p{Lu}'’\-]*,|\p{Script=Han}{2,4}[.,，])/u;

/**
 * A DOI almost always closes an entry. When the PDF layout glued two entries together ("…DOI: 10.x/y. SILVA, J. Title…"),
 * the text after the DOI is cut off as its own entry if it starts like one and has a year. Without this the second
 * reference is never parsed, matched or looked up.
 */
export function splitGluedEntries(text: string): string[] {
  const out: string[] = [];
  let rest = text;
  for (let guard = 0; guard < 50; guard++) {
    let cut = -1;
    for (const m of rest.matchAll(DOI_END_RE)) {
      const end = (m.index ?? 0) + m[0].replace(/[.,;)\]]+$/u, '').length;
      const after = rest.slice(end).replace(/^[.,;)\]]*\s+/u, '');
      if (after.length >= 30 && ENTRY_START_RE.test(after) && HAS_YEAR_RE.test(after)) {
        cut = rest.length - after.length;
        break;
      }
    }
    if (cut < 0) break;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  out.push(rest);
  return out.filter((t) => t.length >= 15);
}

export function extractReferenceEntries(pdf: PdfText): ReferenceEntry[] {
  const sections = referenceSections(pdf, { fallback: true });
  const page = (n: number) => pdf.pages.find((p) => p.page === n)!;
  const out: ReferenceEntry[] = [];
  for (const sec of sections) {
    for (const g of sec.groups) {
      // NFKC: CJK fonts often map to Kangxi radicals (⽂ for 文), and ligatures (ﬁ) break words
      let text = joinLines(g.lines.map((l) => l.text)).normalize('NFKC');
      if (g.label && text.startsWith(g.label)) text = text.slice(g.label.length).trim();
      if (text.length < 15) continue;
      const first = g.lines[0];
      const p = page(first.page);
      // a lone line in the top/bottom margin with nothing of an entry (a running header on a short document,
      // where repeatedLines cannot tell it from the body)
      const inMargin = p.height > 0 && (first.rect.y < p.height * MARGIN_BAND || first.rect.y + first.rect.h > p.height * (1 - MARGIN_BAND));
      if (g.lines.length === 1 && inMargin && !HAS_YEAR_RE.test(text) && !/\b10\.\d{4,9}\/|https?:\/\/|www\./i.test(text)) continue;
      const pieces = g.label ? [text] : splitGluedEntries(text);
      for (const [k, piece] of pieces.entries()) {
        out.push({
          index: out.length,
          label: k === 0 ? g.label : undefined,
          text: piece,
          page: first.page,
          rects: g.lines.filter((l) => l.page === first.page).map((l) => l.rect),
          pageSize: { width: p.width, height: p.height },
          dois: findDois(piece),
          years: parseYears(piece),
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Matching reference entries to publications
// ---------------------------------------------------------------------------

export type ReferenceMatchLevel = 'confirmed' | 'weak';

export interface ReferenceCandidate {
  publicationId: string;
  level: ReferenceMatchLevel;
  matchedBy: string[];
}

export type ReferenceMatch =
  | { status: 'confirmed'; publicationId: string; matchedBy: string[]; byDoi: boolean }
  | { status: 'weak'; publicationId: string; matchedBy: string[] }
  | { status: 'ambiguous'; candidates: string[] }
  | { status: 'none' };

function containsPhrase(haystack: string, needle: string) {
  return needle.length > 0 && ` ${haystack} `.includes(` ${needle} `);
}

/** First author segment of a reference entry ("Chen, L.-C., Zhu, Y." -> "Chen"; "Wen-Hsiu Chen, Yuki Zhu" -> "Wen-Hsiu Chen"). */
export function firstAuthorSegment(text: string): string {
  const stripped = text.replace(/^\s*(?:\[[^\]]*\]|\d{1,3}\.)\s*/, '');
  return (stripped.split(/,|;|\band\b|&|\(/)[0] ?? '').slice(0, 60);
}

export function scoreReference(entry: Pick<ReferenceEntry, 'text' | 'dois' | 'years'>, pub: PublicationNode): ReferenceCandidate | undefined {
  const doi = normalizeDoi(pub.doi);
  if (doi && entry.dois.includes(doi)) return { publicationId: pub.id, level: 'confirmed', matchedBy: ['doi'] };
  const doiConflict = Boolean(doi && entry.dois.length > 0);

  const normEntry = normalizeTitle(entry.text);
  const normTitle = normalizeTitle(pub.title);
  const pubTokens = titleTokens(pub.title);
  const entryTokens = new Set(titleTokens(entry.text));
  const family = pub.authors[0] ? normalizeTitle(normalizeName(pub.authors[0].family)) : '';
  const head = normalizeTitle(firstAuthorSegment(entry.text));
  const authorOk = family ? containsPhrase(head, family) || head.replace(/ /g, '').includes(family.replace(/ /g, '')) : undefined;
  const yearOk = pub.year !== undefined && entry.years.length > 0 ? entry.years.includes(pub.year) : undefined;

  const matchedBy: string[] = [];
  if (authorOk) matchedBy.push('first_author');
  if (yearOk) matchedBy.push('year');

  const phrase = containsPhrase(normEntry, normTitle);
  const coverage = pubTokens.length ? pubTokens.filter((t) => entryTokens.has(t)).length / pubTokens.length : 0;
  const longTitle = pubTokens.length >= 6;

  if (phrase) {
    if (authorOk === false && !longTitle) return undefined; // short phrase inside another work's title
    const contradicted = authorOk === false || yearOk === false;
    if (!doiConflict && !contradicted && (pubTokens.length >= 3 || (authorOk && yearOk))) {
      return { publicationId: pub.id, level: 'confirmed', matchedBy: ['title', ...matchedBy] };
    }
    return { publicationId: pub.id, level: 'weak', matchedBy: ['title', ...matchedBy] };
  }
  if (coverage >= 0.85 && pubTokens.length >= 3 && authorOk && yearOk && !doiConflict) {
    return { publicationId: pub.id, level: 'confirmed', matchedBy: ['title_tokens', ...matchedBy] };
  }
  if (coverage >= 0.6 && pubTokens.length >= 3 && authorOk) {
    return { publicationId: pub.id, level: 'weak', matchedBy: ['partial_title', ...matchedBy] };
  }
  if (authorOk && yearOk && (pubTokens.length === 0 || coverage >= 0.3)) {
    // Same first author + year is NOT an identity; it is only a hint for review.
    return { publicationId: pub.id, level: 'weak', matchedBy };
  }
  return undefined;
}

export function matchReference(entry: Pick<ReferenceEntry, 'text' | 'dois' | 'years'>, pubs: PublicationNode[]): ReferenceMatch {
  const candidates = pubs.map((p) => scoreReference(entry, p)).filter((c): c is ReferenceCandidate => Boolean(c));
  const byDoi = candidates.filter((c) => c.matchedBy[0] === 'doi');
  if (byDoi.length === 1) return { status: 'confirmed', publicationId: byDoi[0].publicationId, matchedBy: ['doi'], byDoi: true };
  if (byDoi.length > 1) return { status: 'ambiguous', candidates: byDoi.map((c) => c.publicationId) };
  const confirmed = candidates.filter((c) => c.level === 'confirmed');
  if (confirmed.length === 1) return { status: 'confirmed', publicationId: confirmed[0].publicationId, matchedBy: confirmed[0].matchedBy, byDoi: false };
  if (confirmed.length > 1) return { status: 'ambiguous', candidates: confirmed.map((c) => c.publicationId) };
  if (candidates.length === 1) return { status: 'weak', publicationId: candidates[0].publicationId, matchedBy: candidates[0].matchedBy };
  if (candidates.length > 1) return { status: 'ambiguous', candidates: candidates.map((c) => c.publicationId) };
  return { status: 'none' };
}
