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

/**
 * Maps CJK radical and compatibility forms (common in PDF font encodings) to
 * the corresponding unified ideograph. Built from Unicode CJKRadicals.txt.
 * NFKC alone does not fold Kangxi / supplement radicals such as ⻜ (U+2EDC) to 飞.
 */
const CJK_RADICAL_FROM = [
  0x2F00, 0x2F01, 0x2F02, 0x2F03, 0x2F04, 0x2F05, 0x2F06, 0x2F07, 0x2F08, 0x2F09, 0x2F0A, 0x2F0B,
  0x2F0C, 0x2F0D, 0x2F0E, 0x2F0F, 0x2F10, 0x2F11, 0x2F12, 0x2F13, 0x2F14, 0x2F15, 0x2F16, 0x2F17,
  0x2F18, 0x2F19, 0x2F1A, 0x2F1B, 0x2F1C, 0x2F1D, 0x2F1E, 0x2F1F, 0x2F20, 0x2F21, 0x2F22, 0x2F23,
  0x2F24, 0x2F25, 0x2F26, 0x2F27, 0x2F28, 0x2F29, 0x2F2A, 0x2F2B, 0x2F2C, 0x2F2D, 0x2F2E, 0x2F2F,
  0x2F30, 0x2F31, 0x2F32, 0x2F33, 0x2F34, 0x2F35, 0x2F36, 0x2F37, 0x2F38, 0x2F39, 0x2F3A, 0x2F3B,
  0x2F3C, 0x2F3D, 0x2F3E, 0x2F3F, 0x2F40, 0x2F41, 0x2F42, 0x2F43, 0x2F44, 0x2F45, 0x2F46, 0x2F47,
  0x2F48, 0x2F49, 0x2F4A, 0x2F4B, 0x2F4C, 0x2F4D, 0x2F4E, 0x2F4F, 0x2F50, 0x2F51, 0x2F52, 0x2F53,
  0x2F54, 0x2F55, 0x2F56, 0x2F57, 0x2F58, 0x2F59, 0x2EA6, 0x2F5A, 0x2F5B, 0x2F5C, 0x2F5D, 0x2F5E,
  0x2F5F, 0x2F60, 0x2F61, 0x2F62, 0x2F63, 0x2F64, 0x2F65, 0x2F66, 0x2F67, 0x2F68, 0x2F69, 0x2F6A,
  0x2F6B, 0x2F6C, 0x2F6D, 0x2F6E, 0x2F6F, 0x2F70, 0x2F71, 0x2F72, 0x2F73, 0x2F74, 0x2F75, 0x2F76,
  0x2F77, 0x2EB0, 0x2F78, 0x2F79, 0x2F7A, 0x2F7B, 0x2F7C, 0x2F7D, 0x2F7E, 0x2F7F, 0x2F80, 0x2F81,
  0x2F82, 0x2F83, 0x2F84, 0x2F85, 0x2F86, 0x2F87, 0x2F88, 0x2F89, 0x2F8A, 0x2F8B, 0x2F8C, 0x2F8D,
  0x2F8E, 0x2F8F, 0x2F90, 0x2F91, 0x2F92, 0x2EC5, 0x2F93, 0x2F94, 0x2EC8, 0x2F95, 0x2F96, 0x2F97,
  0x2F98, 0x2F99, 0x2EC9, 0x2F9A, 0x2F9B, 0x2F9C, 0x2F9D, 0x2F9E, 0x2ECB, 0x2F9F, 0x2FA0, 0x2FA1,
  0x2FA2, 0x2FA3, 0x2FA4, 0x2FA5, 0x2FA6, 0x2ED0, 0x2FA7, 0x2ED3, 0x2FA8, 0x2ED4, 0x2FA9, 0x2FAA,
  0x2FAB, 0x2FAC, 0x2FAD, 0x2FAE, 0x2FAF, 0x2FB0, 0x2FB1, 0x2ED9, 0x2FB2, 0x2FB3, 0x2FB4, 0x2EDA,
  0x2FB5, 0x2EDB, 0x2FB6, 0x2EDC, 0x2FB7, 0x2EE0, 0x2FB8, 0x2FB9, 0x2FBA, 0x2EE2, 0x2FBB, 0x2FBC,
  0x2FBD, 0x2FBE, 0x2FBF, 0x2FC0, 0x2FC1, 0x2FC2, 0x2EE5, 0x2FC3, 0x2EE6, 0x2FC4, 0x2EE7, 0x2FC5,
  0x2FC6, 0x2EE8, 0x2FC7, 0x2FC8, 0x2EE9, 0x2FC9, 0x2FCA, 0x2FCB, 0x2FCC, 0x2EEA, 0x2FCD, 0x2FCE,
  0x2FCF, 0x2FD0, 0x2FD1, 0x2EEC, 0x2EEB, 0x2FD2, 0x2EEE, 0x2EED, 0x2FD3, 0x2EF0, 0x2EEF, 0x2FD4,
  0x2EF3, 0x2EF2, 0x2FD5,
];
const CJK_RADICAL_TO = [
  0x4E00, 0x4E28, 0x4E36, 0x4E3F, 0x4E59, 0x4E85, 0x4E8C, 0x4EA0, 0x4EBA, 0x513F, 0x5165, 0x516B,
  0x5182, 0x5196, 0x51AB, 0x51E0, 0x51F5, 0x5200, 0x529B, 0x52F9, 0x5315, 0x531A, 0x5338, 0x5341,
  0x535C, 0x5369, 0x5382, 0x53B6, 0x53C8, 0x53E3, 0x56D7, 0x571F, 0x58EB, 0x5902, 0x590A, 0x5915,
  0x5927, 0x5973, 0x5B50, 0x5B80, 0x5BF8, 0x5C0F, 0x5C22, 0x5C38, 0x5C6E, 0x5C71, 0x5DDB, 0x5DE5,
  0x5DF1, 0x5DFE, 0x5E72, 0x5E7A, 0x5E7F, 0x5EF4, 0x5EFE, 0x5F0B, 0x5F13, 0x5F50, 0x5F61, 0x5F73,
  0x5FC3, 0x6208, 0x6236, 0x624B, 0x652F, 0x6534, 0x6587, 0x6597, 0x65A4, 0x65B9, 0x65E0, 0x65E5,
  0x66F0, 0x6708, 0x6728, 0x6B20, 0x6B62, 0x6B79, 0x6BB3, 0x6BCB, 0x6BD4, 0x6BDB, 0x6C0F, 0x6C14,
  0x6C34, 0x706B, 0x722A, 0x7236, 0x723B, 0x723F, 0x4E2C, 0x7247, 0x7259, 0x725B, 0x72AC, 0x7384,
  0x7389, 0x74DC, 0x74E6, 0x7518, 0x751F, 0x7528, 0x7530, 0x758B, 0x7592, 0x7676, 0x767D, 0x76AE,
  0x76BF, 0x76EE, 0x77DB, 0x77E2, 0x77F3, 0x793A, 0x79B8, 0x79BE, 0x7A74, 0x7ACB, 0x7AF9, 0x7C73,
  0x7CF8, 0x7E9F, 0x7F36, 0x7F51, 0x7F8A, 0x7FBD, 0x8001, 0x800C, 0x8012, 0x8033, 0x807F, 0x8089,
  0x81E3, 0x81EA, 0x81F3, 0x81FC, 0x820C, 0x821B, 0x821F, 0x826E, 0x8272, 0x8278, 0x864D, 0x866B,
  0x8840, 0x884C, 0x8863, 0x897E, 0x898B, 0x89C1, 0x89D2, 0x8A00, 0x8BA0, 0x8C37, 0x8C46, 0x8C55,
  0x8C78, 0x8C9D, 0x8D1D, 0x8D64, 0x8D70, 0x8DB3, 0x8EAB, 0x8ECA, 0x8F66, 0x8F9B, 0x8FB0, 0x8FB5,
  0x9091, 0x9149, 0x91C6, 0x91CC, 0x91D1, 0x9485, 0x9577, 0x957F, 0x9580, 0x95E8, 0x961C, 0x96B6,
  0x96B9, 0x96E8, 0x9751, 0x975E, 0x9762, 0x9769, 0x97CB, 0x97E6, 0x97ED, 0x97F3, 0x9801, 0x9875,
  0x98A8, 0x98CE, 0x98DB, 0x98DE, 0x98DF, 0x9963, 0x9996, 0x9999, 0x99AC, 0x9A6C, 0x9AA8, 0x9AD8,
  0x9ADF, 0x9B25, 0x9B2F, 0x9B32, 0x9B3C, 0x9B5A, 0x9C7C, 0x9CE5, 0x9E1F, 0x9E75, 0x5364, 0x9E7F,
  0x9EA5, 0x9EA6, 0x9EBB, 0x9EC3, 0x9EC4, 0x9ECD, 0x9ED1, 0x9EF9, 0x9EFD, 0x9EFE, 0x9F0E, 0x9F13,
  0x9F20, 0x9F3B, 0x9F4A, 0x9F50, 0x6589, 0x9F52, 0x9F7F, 0x6B6F, 0x9F8D, 0x9F99, 0x7ADC, 0x9F9C,
  0x9F9F, 0x4E80, 0x9FA0,
];
const CJK_RADICAL_FOLD: Record<number, string> = Object.fromEntries(
  CJK_RADICAL_FROM.map((from, i) => [from, String.fromCodePoint(CJK_RADICAL_TO[i])]),
);

/** NFKC plus official CJK radical folding, used before name/title/quote comparison. */
export function foldCjk(input: string): string {
  const s = input.normalize('NFKC');
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    out += CJK_RADICAL_FOLD[cp] ?? ch;
  }
  return out;
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
  s = s.replace(/\((?:1[5-9]|20)\d{2}$/, '');
  if (!/^10\.\d{4,9}\/\S+$/.test(s)) return undefined;
  return s.toLowerCase();
}

/**
 * Reconstructs DOIs that PDF extractors split with zero-width spaces or gaps
 * ("h t t p s : / / d o i . o r g / 1 0 . 1 0 1 6 / j . m e d i a").
 */
export function reconstructSpacedDois(text: string): string {
  if (!text) return '';
  const s = text.replace(/\p{Cf}+/gu, '');
  const prefixRe = /(?:h\s*t\s*t\s*p\s*s?\s*:\s*\/\s*\/\s*)?(?:d\s*x\s*\.\s*)?d\s*o\s*i\s*(?:\s*\.\s*o\s*r\s*g\s*\/|\s*:\s*)/gi;
  let result = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = prefixRe.exec(s))) {
    result += s.slice(last, m.index);
    result += m[0].replace(/\s+/g, '');
    let i = m.index + m[0].length;
    let body = '';
    const isYearParen = (at: number) => {
      if (s[at] !== '(') return false;
      const compact = s.slice(at + 1).replace(/\s+/g, '');
      return /^(?:1[5-9]|20)\d{2}(?:\)|$|[^0-9])/.test(compact) && !/^(?:1[5-9]|20)\d{2}\d/.test(compact);
    };
    while (i < s.length) {
      if (/\s/.test(s[i])) {
        let j = i + 1;
        while (j < s.length && /\s/.test(s[j])) j++;
        if (j >= s.length || isYearParen(j) || !/[A-Za-z0-9.\-_/():;<>]/.test(s[j])) break;
        i = j;
        continue;
      }
      const ch = s[i];
      if (isYearParen(i)) break;
      if (!/[A-Za-z0-9.\-_/():;<>]/.test(ch)) break;
      if ((ch === '.' || ch === ',' || ch === ';') && body.length >= 8) {
        let j = i + 1;
        while (j < s.length && /\s/.test(s[j])) j++;
        const n = s[j];
        const continues = n !== undefined && (ch === '.' ? /[A-Za-z0-9/_-]/ : /[0-9/<>()-]/).test(n);
        if (!continues) break;
      }
      body += ch;
      i++;
      if (body.length > 200) break;
    }
    result += body;
    last = i;
    prefixRe.lastIndex = i;
  }
  return result + s.slice(last);
}

/** Finds DOIs inside free text (e.g. a reference entry or a PDF first page). */
export function findDois(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  // SICI-style DOIs carry <...> segments: 10.1002/(SICI)1097-4636(199704)35:1<129::AID-JBM13>3.0.CO;2-E
  const re = /\b(10\.\d{4,9}\/(?:[^\s"<>]|<[^\s"<>]{1,40}>)+)/gi;
  for (const hay of [text, reconstructSpacedDois(text)]) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(hay))) {
      const d = normalizeDoi(m[1]);
      if (d && !out.includes(d)) out.push(d);
    }
  }
  return out;
}

/** New-style (YYMM.nnnnn) or old-style (subject/0000000) arXiv identifiers in free text. */
export function findArxivIds(text: string): string[] {
  if (!text) return [];
  const hay = text.replace(/\p{Cf}+/gu, '');
  const out: string[] = [];
  const push = (id: string | undefined) => {
    const v = id?.replace(/v\d+$/i, '').toLowerCase();
    if (v && !out.includes(v)) out.push(v);
  };
  const re = /\barxiv(?:\.org\/(?:abs|pdf)\/|:?\s*)(\d{4}\.\d{4,5}(?:v\d+)?|[a-z\-]+\/\d{7}(?:v\d+)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(hay))) push(m[1]);
  // "Segment Anything. 2304.02643 (2023)" — bare new-style id, only when not already captured
  const bare = /(?<!\d)((?:0[7-9]|1\d|2[0-6])(?:0[1-9]|1[0-2])\.\d{4,5})(?:v\d+)?(?!\d)/g;
  while ((m = bare.exec(hay))) push(m[1]);
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
  let s = foldCjk(decodeLatex(String(input)));
  s = stripDiacritics(s).toLowerCase();
  s = s.replace(/&/g, ' and ');
  s = s.replace(/[‐-―\-_/]/g, ' ');
  s = s.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/** Significant tokens of a normalized title (stopwords removed, abbreviations expanded). */
const HAN_RUN = /\p{Script=Han}/u;

/** Significant tokens of a normalized title (stopwords removed, abbreviations expanded).
 *  Unspaced Chinese titles become character bigrams so close variants still overlap. */
export function titleTokens(input: string | undefined | null): string[] {
  const out: string[] = [];
  for (const raw of normalizeTitle(input).split(' ').filter(Boolean)) {
    const t = ABBREVIATIONS[raw] ?? raw;
    if (HAN_RUN.test(t)) {
      const chars = [...t];
      if (chars.length === 1) out.push(t);
      else for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i] + chars[i + 1]);
      continue;
    }
    if (!TITLE_STOPWORDS.has(t)) out.push(t);
  }
  return out;
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
  return foldCjk(stripDiacritics(decodeLatex(input)))
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
  if (na.replace(/[-\s]/g, '') === nb.replace(/[-\s]/g, '')) return true;
  // Chinese: a 1–2 character family (张, 欧阳) matches the full name that starts with it (张三, 欧阳修).
  const han = (s: string) => /^\p{Script=Han}+$/u.test(s);
  if (han(na) && han(nb)) {
    const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
    // Japanese full names run to 5 characters (山田 / 山田太一郎)
    if (shorter.length >= 1 && shorter.length <= 2 && longer.length <= (shorter.length === 2 ? 5 : 4) && longer.startsWith(shorter)) return true;
  }
  return false;
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
