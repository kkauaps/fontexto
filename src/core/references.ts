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

const HEADING_RE =
  /^(?:(?:\d{1,2}|[IVX]{1,5})\.?\s*)?(references?(?:\s+and\s+notes)?|bibliography|refer[eêé]ncias?(?:\s+bibliogr[aá]ficas?)?|literature\s+cited|works\s+cited|cited\s+literature|sources\s+cited|bibliograf[ií]as?|bibliographie|r[ée]f[ée]rences(?:\s+bibliographiques)?|literatur(?:verzeichnis|angaben|liste)?|quellen(?:verzeichnis|angaben)?|riferimenti\s+bibliografici|список\s+(?:использованн(?:ой|ых)\s+)?(?:литературы|источников)|библиографи(?:я|ческий\s+список)|литература|参考文献|参考资料|引用文献)\s*[:：]?$/iu;

const STOP_RE =
  /^(?:(?:\d{1,2}|[A-Z]|[IVX]{1,5})\.?\s*)?(appendix|appendices|ap[eê]ndices?|anexos?|supplementary|supporting information|acknowledg(?:e)?ments?|agradecimentos|author contributions|funding|conflicts? of interest|competing interests|declaration of|data availability|abbreviations|biograph(?:y|ies)|about the authors?|annexes?|anhang|anh[äa]nge|danksagung|remerciements|agradecimientos|ap[ée]ndices?|приложени[ея]|благодарност[ьи]|附录|致谢)(?![\p{L}])/iu;

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
  ].join('|'),
  'u',
);

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

export function findReferenceHeading(pdf: PdfText): { page: number; line: number } | undefined {
  let found: { page: number; line: number } | undefined;
  for (const p of pdf.pages) {
    p.lines.forEach((l, idx) => {
      if (HEADING_RE.test(l.text.normalize('NFKC').trim())) found = { page: p.page, line: idx };
    });
  }
  return found;
}

/**
 * Location of the bibliography inside a PDF: from its heading up to the next
 * section that clearly follows it (appendix, acknowledgements, ...), if any.
 * `end` is exclusive and undefined when the list runs to the end of the file.
 */
export function referenceSectionBounds(pdf: PdfText): { start: { page: number; line: number }; end?: { page: number; line: number } } | undefined {
  const start = findReferenceHeading(pdf);
  if (!start) return undefined;
  const repeated = repeatedLines(pdf);
  let seen = false;
  for (const p of pdf.pages) {
    if (p.page < start.page) continue;
    const from = p.page === start.page ? start.line + 1 : 0;
    for (let i = from; i < p.lines.length; i++) {
      const t = p.lines[i].text.trim();
      if (!t || isPageNumber(t)) continue;
      if (repeated.has(t.replace(/\d+/g, '#').toLowerCase())) continue;
      if (t.length < 80 && STOP_RE.test(t) && seen) return { start, end: { page: p.page, line: i } };
      seen = true;
    }
  }
  return { start };
}

interface SectionLine extends TextLine {
  page: number;
}

function sectionLines(pdf: PdfText, start: { page: number; line: number }): SectionLine[] {
  const repeated = repeatedLines(pdf);
  const out: SectionLine[] = [];
  for (const p of pdf.pages) {
    if (p.page < start.page) continue;
    const from = p.page === start.page ? start.line + 1 : 0;
    for (let i = from; i < p.lines.length; i++) {
      const l = p.lines[i];
      const t = l.text.trim();
      if (!t || isPageNumber(t)) continue;
      if (repeated.has(t.replace(/\d+/g, '#').toLowerCase())) continue;
      if (t.length < 80 && STOP_RE.test(t) && out.length > 0) return out;
      out.push({ ...l, page: p.page });
    }
  }
  return out;
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

export function extractReferenceEntries(pdf: PdfText): ReferenceEntry[] {
  const heading = findReferenceHeading(pdf);
  if (!heading) return [];
  const lines = sectionLines(pdf, heading);
  if (lines.length === 0) return [];

  const numbered = detectNumbering(lines);
  const groups: { lines: SectionLine[]; label?: string }[] = [];
  let expected = 0;

  for (const line of lines) {
    const t = line.text.trim();
    const current = groups[groups.length - 1];
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
      const sameColumn = first.page === line.page && Math.abs(first.rect.x - line.rect.x) < 120;
      const hangingIndent = sameColumn && line.rect.x > first.rect.x + 3;
      const currentText = joinLines(current.lines.map((l) => l.text));
      const currentComplete = HAS_YEAR_RE.test(currentText) || /\.\s*$/.test(currentText);
      start = !hangingIndent && currentComplete && AUTHOR_START_RE.test(t);
    }
    if (start) groups.push({ lines: [line], label });
    else if (current) current.lines.push(line);
  }

  const page = (n: number) => pdf.pages.find((p) => p.page === n)!;
  return groups
    .map((g, index) => {
      // NFKC: CJK fonts often map to Kangxi radicals (⽂ for 文), and ligatures (ﬁ) break words
      let text = joinLines(g.lines.map((l) => l.text)).normalize('NFKC');
      if (g.label && text.startsWith(g.label)) text = text.slice(g.label.length).trim();
      const first = g.lines[0];
      const p = page(first.page);
      return {
        index,
        label: g.label,
        text,
        page: first.page,
        rects: g.lines.filter((l) => l.page === first.page).map((l) => l.rect),
        pageSize: { width: p.width, height: p.height },
        dois: findDois(text),
        years: parseYears(text),
      } satisfies ReferenceEntry;
    })
    .filter((e) => e.text.length >= 15);
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
