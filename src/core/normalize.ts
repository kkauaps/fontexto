import type { Author } from './model.js';

const LATEX_ACCENTS: Record<string, string> = {
  "'": '́',
  '`': '̀',
  '^': '̂',
  '"': '̈',
  '~': '̃',
  '=': '̄',
  '.': '̇',
  c: '̧',
  v: '̌',
  u: '̆',
  H: '̋',
  k: '̨',
};

const LATEX_SYMBOLS: Record<string, string> = {
  ss: 'ß',
  o: 'ø',
  O: 'Ø',
  ae: 'æ',
  AE: 'Æ',
  oe: 'œ',
  OE: 'Œ',
  aa: 'å',
  AA: 'Å',
  l: 'ł',
  L: 'Ł',
  i: 'ı',
  '&': '&',
  '%': '%',
  _: '_',
  $: '$',
  '#': '#',
};

/** Converts common LaTeX markup found in .bib files to plain Unicode text. */
export function decodeLatex(input: string): string {
  let s = input;
  // Accents: {\'e}, \'{e}, \'e, {\c c}, \c{c}
  s = s.replace(/\\([`'^"~=.])\s*\{?\s*([A-Za-z]|\\i|\\j)\s*\}?/g, (_m, acc: string, ch: string) => {
    const base = ch === '\\i' ? 'i' : ch === '\\j' ? 'j' : ch;
    return (base + LATEX_ACCENTS[acc]).normalize('NFC');
  });
  s = s.replace(/\\([cvuHk])\s*\{\s*([A-Za-z])\s*\}/g, (_m, acc: string, ch: string) => (ch + LATEX_ACCENTS[acc]).normalize('NFC'));
  s = s.replace(/\\([cvuHk])\s+([A-Za-z])/g, (_m, acc: string, ch: string) => (ch + LATEX_ACCENTS[acc]).normalize('NFC'));
  s = s.replace(/\\(ss|ae|AE|oe|OE|aa|AA|o|O|l|L|i)(?![A-Za-z])\s*/g, (_m, sym: string) => LATEX_SYMBOLS[sym] ?? sym);
  s = s.replace(/\\([&%_$#])/g, '$1');
  s = s.replace(/--/g, '–');
  // Formatting commands: \emph{x}, \textit{x}, \textbf{x}, \mkbibquote{x}
  s = s.replace(/\\[A-Za-z]+\*?\s*\{([^{}]*)\}/g, '$1');
  s = s.replace(/\\[A-Za-z]+\*?/g, '');
  s = s.replace(/[{}]/g, '');
  s = s.replace(/~/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/** Removes diacritics: "Pölönen" -> "Polonen". */
export function stripDiacritics(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[øØ]/g, 'o')
    .replace(/[łŁ]/g, 'l')
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe');
}

/**
 * Normalizes a DOI to its canonical lowercase form without resolver prefix.
 * Returns undefined when the input does not look like a DOI.
 */
export function normalizeDoi(input: string | undefined | null): string | undefined {
  if (!input) return undefined;
  let s = decodeLatex(String(input)).trim();
  s = s.replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, '');
  s = s.replace(/^doi:\s*/i, '');
  s = s.replace(/\s+/g, '');
  s = s.replace(/[.,;:)\]}>"']+$/, '');
  if (!/^10\.\d{4,9}\/\S+$/.test(s)) return undefined;
  return s.toLowerCase();
}

/** Finds DOIs inside free text (e.g. a reference entry or a PDF first page). */
export function findDois(text: string): string[] {
  const out: string[] = [];
  const re = /\b(10\.\d{4,9}\/[^\s"<>]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const d = normalizeDoi(m[1]);
    if (d && !out.includes(d)) out.push(d);
  }
  return out;
}

const TITLE_STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'and', 'or', 'in', 'on', 'for', 'to', 'with', 'by', 'at', 'from', 'via',
  'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'na', 'no', 'para', 'por', 'com', 'um', 'uma', 'o', 'os', 'as',
]);

/** Common abbreviations normalized so that "Int. J." and "International Journal" compare equal. */
const ABBREVIATIONS: Record<string, string> = {
  int: 'international',
  intl: 'international',
  j: 'journal',
  jour: 'journal',
  conf: 'conference',
  proc: 'proceedings',
  trans: 'transactions',
  med: 'medical',
  comput: 'computer',
  vis: 'vision',
  img: 'image',
  seg: 'segmentation',
  nat: 'nature',
  rev: 'review',
  vs: 'versus',
  '&': 'and',
};

/**
 * Normalizes a title for comparison: decode LaTeX, strip diacritics,
 * lowercase, unify dashes/quotes, drop punctuation, collapse whitespace.
 */
export function normalizeTitle(input: string | undefined | null): string {
  if (!input) return '';
  let s = decodeLatex(String(input));
  s = stripDiacritics(s).toLowerCase();
  s = s.replace(/&/g, ' and ');
  s = s.replace(/[‐-―\-_/]/g, ' ');
  s = s.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/** Significant tokens of a normalized title (stopwords removed, abbreviations expanded). */
export function titleTokens(input: string | undefined | null): string[] {
  return normalizeTitle(input)
    .split(' ')
    .filter(Boolean)
    .map((t) => ABBREVIATIONS[t] ?? t)
    .filter((t) => !TITLE_STOPWORDS.has(t));
}

/** Sørensen–Dice coefficient over token multisets (0..1). */
export function tokenDice(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const t of a) counts.set(t, (counts.get(t) ?? 0) + 1);
  let inter = 0;
  for (const t of b) {
    const c = counts.get(t) ?? 0;
    if (c > 0) {
      inter++;
      counts.set(t, c - 1);
    }
  }
  return (2 * inter) / (a.length + b.length);
}

/** Similarity of two titles in 0..1. */
export function titleSimilarity(a: string | undefined, b: string | undefined): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  return tokenDice(titleTokens(a), titleTokens(b));
}

/** Normalized family name used for comparisons ("Van Dalen" -> "van dalen"). */
export function normalizeName(input: string | undefined): string {
  if (!input) return '';
  return stripDiacritics(decodeLatex(input))
    .toLowerCase()
    .replace(/[‐-―]/g, '-')
    .replace(/[^\p{L}\p{N}\s.-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Compares family names tolerating particles ("van Dalen" vs "Dalen"). */
export function sameFamilyName(a: string | undefined, b: string | undefined): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const strip = (s: string) => s.replace(/^(?:van der|van den|van de|von der|van|von|de la|de|da|dos|das|del|della|di|du|le|la)\s+/, '');
  if (strip(na) === strip(nb)) return true;
  // Hyphen/space variants: "Kessel-Brandt" vs "Kessel Brandt"
  return na.replace(/[-\s]/g, '') === nb.replace(/[-\s]/g, '');
}

/** Parses a single BibTeX-style name ("Last, First" or "First Last"). */
export function parseAuthor(raw: string): Author {
  const trimmed = raw.trim();
  // Corporate author protected by braces: {CVAT.ai}, {the Wound Description Working Group}
  if (/^\{.*\}$/.test(trimmed)) {
    const name = decodeLatex(trimmed);
    return { raw: name, family: name, organization: true };
  }
  const text = decodeLatex(trimmed);
  if (text.includes(',')) {
    const [family, ...rest] = text.split(',');
    const given = rest.join(',').trim();
    return { raw: text, family: family.trim(), given: given || undefined };
  }
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { raw: text, family: parts[0] };
  // Keep lowercase particles with the family name: "Ludwig van Beethoven".
  let i = parts.length - 1;
  while (i > 0 && /^(van|von|de|da|der|den|dos|das|del|della|di|du|le|la)$/.test(parts[i - 1])) i--;
  return { raw: text, family: parts.slice(i).join(' '), given: parts.slice(0, i).join(' ') || undefined };
}

/** Splits a BibTeX author field on top-level " and ". */
export function parseAuthorList(field: string | undefined): Author[] {
  if (!field) return [];
  const out: string[] = [];
  let depth = 0;
  let current = '';
  const tokens = field.split(/(\s+and\s+|[{}])/);
  for (const tok of tokens) {
    if (tok === '{') depth++;
    if (tok === '}') depth--;
    if (depth === 0 && /^\s+and\s+$/.test(tok)) {
      out.push(current);
      current = '';
    } else {
      current += tok;
    }
  }
  if (current.trim()) out.push(current);
  return out.map(parseAuthor).filter((a) => a.family.length > 0 && normalizeName(a.family) !== 'others');
}

/** Extracts the first 4-digit year (1500..2099) and an optional suffix ("2025a"). */
export function parseYear(input: string | undefined | null): { year?: number; label?: string } {
  if (!input) return {};
  const m = /\b(1[5-9]\d{2}|20\d{2})([a-z])?\b/.exec(String(input));
  if (!m) return {};
  return { year: Number(m[1]), label: m[2] ? m[1] + m[2] : undefined };
}

/** Short hash (FNV-1a, 32 bit) used for deterministic ids. Not cryptographic. */
export function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
