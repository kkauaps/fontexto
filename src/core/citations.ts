/**
 * In-text citation markers ("(Silva et al., 2025)", "(SILVA; SOUZA, 2020)",
 * "Quintana et al. (2020)") and their resolution to bibliography records.
 *
 * A marker is resolved only when exactly one publication matches. Several
 * matches (e.g. two "Silva 2025" works) produce an `ambiguous` result that must
 * be reviewed; nothing is picked arbitrarily.
 */
import type { PublicationNode, Rect } from './model.js';
import { normalizeName, sameFamilyName } from './normalize.js';
import type { PdfText } from './text.js';

export interface MarkerReference {
  /** Surnames as written in the marker, in order. */
  authors: string[];
  etAl: boolean;
  year: number;
  /** e.g. "2025a" */
  yearLabel: string;
  /** Narrative form ("Silva et al. (2020)"), which may capture preceding capitalized words. */
  narrative?: boolean;
}

export interface CitationMarker extends MarkerReference {
  raw: string;
  page: number;
  rects: Rect[];
  pageSize: { width: number; height: number };
}

const NAME = String.raw`\p{Lu}[\p{L}'’.\-]*(?:\s+(?:(?:van|von|de|da|der|den|dos|del|di|le)\s+)?\p{Lu}[\p{L}'’.\-]*)?`;
const AUTHORS = String.raw`${NAME}(?:\s*[,;]\s*${NAME})*(?:\s*,?\s+(?:and|e|&)\s+${NAME})?(?:\s+et\s+al\.?)?`;
const NARRATIVE_RE = new RegExp(String.raw`(?<![\p{L}])(${AUTHORS})\s*[（(]((?:1[5-9]|20)\d{2}[a-z]?)(?:,\s*p+\.\s*[\d\-–]+)?[）)]`, 'gu');
/** Narrative CJK: 张三（2020） / 张三等（2020）. Up to 4 Han characters (resolveMarker drops a leading run-on). */
const HAN_NARRATIVE_RE = /([\p{Script=Han}]{1,4})(等)?\s*[（(]((?:1[5-9]|20)\d{2}[a-z]?)(?:[,，]\s*(?:p+\.\s*[\d\-–]+|第\s*\d{1,4}\s*页))?[）)]/gu;
const PAREN_RE = /[（(]([^()（）]{2,400})[）)]/g;
const YEAR_IN_SEGMENT = /(?<![\d])((?:1[5-9]|20)\d{2})([a-z])?(?![\d])/g;
const LEADING_NOISE = /^(?:e\.g\.,?|i\.e\.,?|see(?:\s+also)?|cf\.|ver|veja|conforme|segundo)\s+/i;

const HAN_AUTHOR = /^[\p{Script=Han}]{1,4}(?:·[\p{Script=Han}]{1,4})?$/u;
const isCitationAuthor = (a: string) =>
  HAN_AUTHOR.test(a) || (/^\p{Lu}/u.test(a) && a.split(/\s+/).length <= 4);


// A narrative name is often glued to a preceding conjunction (和张三（2020）).
const HAN_PARTICLE = /^(?:和|与|及|见|据|如|由|按|于|自|从|对|在|而|则|但|且|也|还|另|即|以|为|因|故|经|依|将|把|被|比|就|才|又|或|既)/;
function trimLeadingHanParticle(name: string): string {
  let t = name;
  while (t.length > 2 && HAN_PARTICLE.test(t)) t = t.slice(1);
  return t;
}

function parseAuthorPart(part: string): { authors: string[]; etAl: boolean } | undefined {
  let s = part.replace(LEADING_NOISE, '').trim().replace(/[,，、;；\s]+$/, '');
  const etAl = /(?:等|\bet\s+al\.?)/i.test(s);
  s = s.replace(/(?:等|\bet\s+al\.?)/gi, '').trim().replace(/[,，、;；\s]+$/, '');
  if (!s) return undefined;
  const authors = s
    .split(/\s*(?:[;；,，、]|&|\band\b|\be\b)\s*/)
    .map((a) => a.trim())
    .filter(Boolean);
  if (authors.length === 0 || authors.length > 6) return undefined;
  if (!authors.every(isCitationAuthor)) return undefined;
  return { authors, etAl };
}

/** Parses the content of a parenthetical citation into one or more references. */
export function parseParenthetical(content: string): MarkerReference[] {
  const out: MarkerReference[] = [];
  const rawSegments = content.split(/[;；]/).map((s) => s.trim());
  // ABNT joins co-authors with ';' ("SILVA; SOUZA, 2020"): merge segments without a year forward.
  const segments: string[] = [];
  let carry = '';
  for (const seg of rawSegments) {
    const merged = carry ? `${carry}; ${seg}` : seg;
    if (/(?<![\d])(?:1[5-9]|20)\d{2}[a-z]?(?![\d])/.test(seg)) {
      segments.push(merged);
      carry = '';
    } else carry = merged;
  }
  for (const seg0 of segments) {
    const seg = seg0.replace(/[,，]\s*(?:(?:p|pp|s)\.\s*[\d\-–, ]+|第\s*\d{1,4}(?:\s*[-–]\s*\d{1,4})?\s*页)$/i, '');
    const years = [...seg.matchAll(YEAR_IN_SEGMENT)];
    if (years.length === 0) continue;
    const authorPart = seg.slice(0, years[0].index);
    const parsed = parseAuthorPart(authorPart);
    if (!parsed) continue;
    for (const y of years) {
      out.push({ ...parsed, year: Number(y[1]), yearLabel: y[1] + (y[2] ?? '') });
    }
  }
  return out;
}

/**
 * "Autor (2026)", "Author (2026)", "Elaboração própria (2026)": the thesis author pointing at their own work
 * (typically the source line of a table or figure). It is not a citation of a bibliography entry and is never
 * reported as an unidentified reference.
 */
const SELF_AUTHOR_RE = /^(?:autor(?:a|es|as)?|author(?:s)?|o\s+autor|a\s+autora|elabora[cç][aã]o(?:\s+pr[oó]pria)?|own\s+work|nosso\s+trabalho)$/i;
export const isSelfCitation = (m: Pick<MarkerReference, 'authors' | 'etAl'>) => m.authors.length === 1 && SELF_AUTHOR_RE.test(m.authors[0].trim());

export function extractMarkersFromText(text: string, opts: { includeSelf?: boolean } = {}): (MarkerReference & { raw: string; start: number; end: number })[] {
  const out: (MarkerReference & { raw: string; start: number; end: number })[] = [];
  for (const m of text.matchAll(PAREN_RE)) {
    for (const ref of parseParenthetical(m[1])) {
      out.push({ ...ref, raw: m[0], start: m.index!, end: m.index! + m[0].length });
    }
  }
  for (const m of text.matchAll(NARRATIVE_RE)) {
    const parsed = parseAuthorPart(m[1]);
    if (!parsed) continue;
    const yearLabel = m[2];
    out.push({ ...parsed, narrative: true, year: Number(yearLabel.slice(0, 4)), yearLabel, raw: m[0], start: m.index!, end: m.index! + m[0].length });
  }
  for (const m of text.matchAll(HAN_NARRATIVE_RE)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (out.some((x) => x.start < end && start < x.end)) continue;
    const yearLabel = m[3];
    out.push({
      authors: [trimLeadingHanParticle(m[1])],
      etAl: Boolean(m[2]),
      narrative: true,
      year: Number(yearLabel.slice(0, 4)),
      yearLabel,
      raw: m[0],
      start,
      end,
    });
  }
  return out.filter((m) => opts.includeSelf || !isSelfCitation(m)).sort((a, b) => a.start - b.start);
}

/** Extracts markers page by page, keeping the rectangles of the lines that contain them. */
export function extractCitationMarkers(pdf: PdfText): CitationMarker[] {
  const out: CitationMarker[] = [];
  for (const p of pdf.pages) {
    const offsets: number[] = [];
    let text = '';
    for (const l of p.lines) {
      offsets.push(text.length);
      text += l.text + ' ';
    }
    for (const m of extractMarkersFromText(text)) {
      const rects: Rect[] = [];
      p.lines.forEach((l, i) => {
        const s = offsets[i];
        const e = s + l.text.length;
        if (s < m.end && e > m.start) rects.push(l.rect);
      });
      const { start: _s, end: _e, ...rest } = m;
      out.push({ ...rest, page: p.page, rects, pageSize: { width: p.width, height: p.height } });
    }
  }
  return out;
}

/**
 * How a marker was resolved when the text and the bibliography disagree slightly (a common slip in theses):
 * - `year`: the authors match one entry whose year has a one-digit typo ("Dias (1999)" for DIAS 1989), differs
 *   by one or two years ("Araújo e Sartori (2004)" for 2003), or is missing from the list;
 * - `name`: same year, the surname is spelled one letter off ("Picchini" for PICCHIONI);
 * - `acronym`: an organisation cited by its initials ("MDIC (2008)" for "Ministério do Desenvolvimento, Indústria e Comércio");
 * - `title`: an entry without author, cited by the first word of its title ("(ESTUDO..., 2007)").
 */
export interface Approximation {
  kind: 'year' | 'name' | 'acronym' | 'title';
  cited: string;
  listed: string;
}

export type MarkerResolution =
  | { status: 'resolved'; publicationId: string; approx?: Approximation }
  | { status: 'ambiguous'; candidates: string[] }
  | { status: 'unresolved'; candidates: [] };

export function resolveMarker(marker: MarkerReference, pubs: PublicationNode[]): MarkerResolution {
  // Narrative markers may capture preceding capitalized words ("Following Silva et al. (2020)",
  // "ImageNet, e Velloran et al. (2025)"): try the full form first, then drop leading words/names.
  // Parenthetical markers are never shifted: "(Silva; Souza, 2020)" must not resolve to Souza 2020.
  const variants: MarkerReference[] = [marker];
  if (marker.narrative) {
    const words = (marker.authors[0] ?? '').split(/\s+/).filter(Boolean);
    for (let i = 1; i < words.length; i++) variants.push({ ...marker, authors: [words.slice(i).join(' '), ...marker.authors.slice(1)] });
    for (let k = 1; k < marker.authors.length; k++) variants.push({ ...marker, authors: marker.authors.slice(k) });
    const first = marker.authors[0] ?? '';
    if (/^\p{Script=Han}+$/u.test(first) && first.length > 1) {
      for (let i = 1; i < first.length; i++) variants.push({ ...marker, authors: [first.slice(i), ...marker.authors.slice(1)] });
    }
  }
  for (const v of variants) {
    const res = resolveVariant(v, pubs);
    if (res.status !== 'unresolved') return res;
  }
  // nothing matches exactly: try the near misses, again from the full form to the shortest variant
  for (const v of variants) {
    const res = resolveApproximate(v, pubs);
    if (res) return res;
  }
  return { status: 'unresolved', candidates: [] };
}

/** Years that differ by one digit (1989/1999, 2000/2005) or by one or two (2003/2004). */
function nearYear(a: number, b: number): boolean {
  if (Math.abs(a - b) <= 2) return true;
  const x = String(a);
  const y = String(b);
  let diff = 0;
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) diff++;
  return diff === 1;
}

/** Damerau–Levenshtein distance is at most 1 (one letter added, dropped, changed or swapped). */
function oneEditApart(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  const [lo, hi] = a.length < b.length ? [a, b] : [b, a];
  return lo.slice(i) === hi.slice(i + 1);
}

const foldName = (s: string) => normalizeName(s).replace(/[^\p{L}]/gu, '');

/** Initials of the capitalised words of an organisation name: "Ministério do Desenvolvimento, Indústria e Comércio" -> "MDIC". */
const initialsOf = (name: string) =>
  name
    .split(/[\s,\-–]+/)
    .filter((w) => /^\p{Lu}/u.test(w))
    .map((w) => w[0])
    .join('')
    .toUpperCase();

const firstTitleWord = (title: string | undefined) => foldName(/^[\p{L}'’\-]+/u.exec(title ?? '')?.[0] ?? '');

function resolveApproximate(marker: MarkerReference, pubs: PublicationNode[]): MarkerResolution | undefined {
  const first = marker.authors[0];
  if (!first) return undefined;
  const pick = (cands: PublicationNode[], kind: Approximation['kind'], listed: (p: PublicationNode) => string): MarkerResolution | undefined =>
    cands.length === 1 ? { status: 'resolved', publicationId: cands[0].id, approx: { kind, cited: `${marker.authors.map((a) => a.replace(/^(?:\p{Ll}+\s+)+/u, '')).join(', ')}${marker.etAl ? ' et al.' : ''} (${marker.yearLabel})`, listed: listed(cands[0]) } } : undefined;
  const label = (p: PublicationNode) => `${p.authors.map((a) => a.family).slice(0, 2).join(', ')}${p.authors.length > 2 ? ' et al.' : ''}${p.year ? ` (${p.year})` : ''}`;

  // every named author matches (in order); the year is a near miss or missing
  const authorsMatch = (p: PublicationNode) =>
    marker.authors.every((a, k) => p.authors[k] && sameFamilyName(p.authors[k].family, a)) && (marker.etAl || marker.authors.length > 1 || p.authors.length <= 2);
  const byAuthors = pubs.filter(authorsMatch);
  if (byAuthors.length > 0 && !byAuthors.some((p) => p.year === marker.year)) {
    const near = byAuthors.filter((p) => p.year === undefined || nearYear(p.year, marker.year));
    const res = pick(near, 'year', label);
    if (res) return res;
  }

  // surname one letter off, same year (names of 5+ letters only)
  const f = foldName(first);
  if (f.length >= 5) {
    const near = pubs.filter((p) => p.year === marker.year && p.authors[0] && foldName(p.authors[0].family).length >= 5 && oneEditApart(foldName(p.authors[0].family), f));
    const res = pick(near, 'name', label);
    if (res) return res;
  }

  // organisation cited by its initials
  if (/^\p{Lu}{2,8}$/u.test(first) && marker.authors.length === 1) {
    const near = pubs.filter((p) => {
      const fam = p.authors[0]?.family ?? '';
      const ini = initialsOf(fam);
      return fam.split(/\s+/).length >= 2 && ini.length >= first.length && ini.startsWith(first) && (p.year === undefined || p.year === marker.year);
    });
    const res = pick(near, 'acronym', (p) => p.authors[0].family);
    if (res) return res;
  }

  // entry without an author, cited by the first word of its title
  if (marker.authors.length === 1) {
    const near = pubs.filter((p) => p.authors.length === 0 && p.year === marker.year && firstTitleWord(p.title) === f);
    const res = pick(near, 'title', (p) => p.title ?? '');
    if (res) return res;
  }
  return undefined;
}

function resolveVariant(marker: MarkerReference, pubs: PublicationNode[]): MarkerResolution {
  const first = marker.authors[0];
  let candidates = pubs.filter((p) => p.year === marker.year && p.authors[0] && sameFamilyName(p.authors[0].family, first));
  if (candidates.length === 0) return { status: 'unresolved', candidates: [] };

  // Year suffix ("2025a") only disambiguates when the bibliography uses suffixes too.
  if (marker.yearLabel.length > 4) {
    const bySuffix = candidates.filter((p) => p.yearLabel === marker.yearLabel);
    if (bySuffix.length > 0) candidates = bySuffix;
  }
  if (!marker.etAl && marker.authors.length > 1) {
    const second = marker.authors[1];
    const bySecond = candidates.filter((p) => p.authors[1] && sameFamilyName(p.authors[1].family, second));
    if (bySecond.length > 0) candidates = bySecond;
  }
  if (!marker.etAl && marker.authors.length === 1) {
    const solo = candidates.filter((p) => p.authors.length === 1);
    if (solo.length === 1 && candidates.length > 1) candidates = solo;
  }
  if (marker.etAl) {
    const many = candidates.filter((p) => p.authors.length >= 3);
    if (many.length > 0) candidates = many;
  }
  if (candidates.length === 1) return { status: 'resolved', publicationId: candidates[0].id };
  return { status: 'ambiguous', candidates: candidates.map((c) => c.id) };
}

export const markerKey = (m: MarkerReference) => `${normalizeName(m.authors[0])}|${m.yearLabel}|${m.etAl ? 'etal' : m.authors.length}`;
