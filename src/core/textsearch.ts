/**
 * Phrase search over the text nodes of a rendered PDF page (pdf.js text layer).
 *
 * The text layer splits a line into many nodes and breaks words at line ends,
 * so a phrase is searched in a "squashed" form (letters and digits only,
 * lower-case, no accents/ligatures) and mapped back to node offsets. Words are
 * kept as tokens so a search for "the wound" cannot start mid-word inside
 * "breathe wound". Hyphenated line breaks ("segmen-" + "tion") stay one word.
 * Pure functions: the DOM part lives in `src/web/pdfRender.ts`.
 */

export interface TextPosition {
  /** Index of the text node. */
  seg: number;
  /** Character offset inside that node. */
  offset: number;
}

export interface PhraseMatch {
  start: TextPosition;
  /** `offset` is exclusive. */
  end: TextPosition;
  /** True when the whole phrase matched; false when only a leading part of it did. */
  exact: boolean;
  /** Words of the phrase that were matched. */
  words: number;
}

const NON_ALNUM = /[^\p{L}\p{N}]/u;
const WORD_SEP = '\u001e';

function squashChar(ch: string): string {
  if (ch === '\u00ad') return '';
  const base = ch.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  let out = '';
  for (const c of base) if (!NON_ALNUM.test(c)) out += c;
  return out;
}

export const squash = (s: string) => [...s].map(squashChar).join('');

interface Squashed {
  text: string;
  /** For each squashed char (including word separators), where it came from. Separators map to the following word, or the previous if at the end. */
  map: (TextPosition | undefined)[];
}

function isJoinHyphen(ch: string, nextAlnumWithoutSpace: boolean): boolean {
  return (ch === '-' || ch === '\u00ad' || ch === '\u2010' || ch === '\u2011') && nextAlnumWithoutSpace;
}

function lookaheadAlnum(segments: readonly string[], si: number, oi: number): { alnum: boolean; spaceBefore: boolean } {
  let space = false;
  for (let s = si; s < segments.length; s++) {
    const from = s === si ? oi : 0;
    const seg = segments[s];
    for (let i = from; i < seg.length; i++) {
      const ch = seg[i];
      if (/\s/.test(ch)) {
        space = true;
        continue;
      }
      if (ch === '\u00ad') continue;
      if (squashChar(ch)) return { alnum: true, spaceBefore: space };
      // other punctuation: treat as a gap unless it's a join hyphen we'll handle at the call site
      if (ch === '-' || ch === '\u2010' || ch === '\u2011') continue;
      space = true;
    }
  }
  return { alnum: false, spaceBefore: space };
}

function squashSegments(segments: readonly string[]): Squashed {
  let text = '';
  const map: (TextPosition | undefined)[] = [];
  let atWord = false;
  const pushSep = () => {
    if (atWord) {
      text += WORD_SEP;
      map.push(undefined);
      atWord = false;
    }
  };
  segments.forEach((seg, si) => {
    let offset = 0;
    const chars = [...seg];
    for (let ci = 0; ci < chars.length; ci++) {
      const ch = chars[ci];
      const next = lookaheadAlnum(segments, si, offset + ch.length);
      if (isJoinHyphen(ch, next.alnum && !next.spaceBefore)) {
        offset += ch.length;
        continue;
      }
      const sq = squashChar(ch);
      if (!sq) {
        pushSep();
        offset += ch.length;
        continue;
      }
      if (!atWord && text.length) {
        // already pushed sep, or start
      }
      for (let k = 0; k < sq.length; k++) {
        text += sq[k];
        map.push({ seg: si, offset });
      }
      atWord = true;
      offset += ch.length;
    }
  });
  return { text, map };
}

function wordBounded(hay: string, start: number, len: number): boolean {
  const before = start === 0 || hay[start - 1] === WORD_SEP;
  const after = start + len === hay.length || hay[start + len] === WORD_SEP;
  return before && after;
}

/**
 * Finds `phrase` in the text nodes. `nth` selects the n-th occurrence (0-based).
 * If the full phrase is not found, progressively shorter leading parts are tried
 * (never fewer than `minWords` words), so a passage that was cleaned differently
 * from the text layer still gets located. Matches are word-bounded: they cannot
 * start or end inside another word.
 */
export function findPhrase(segments: readonly string[], phrase: string, opts: { nth?: number; minWords?: number } = {}): PhraseMatch | undefined {
  const words = phrase.split(/\s+/).filter((w) => squash(w).length > 0);
  if (words.length === 0) return undefined;
  const hay = squashSegments(segments);
  const minWords = Math.min(opts.minWords ?? 4, words.length);
  const counts = [...new Set([words.length, 24, 16, 12, 8, 6, minWords])].filter((n) => n <= words.length && n >= minWords).sort((a, b) => b - a);
  const nth = opts.nth ?? 0;
  const mapPos = (i: number, which: 'start' | 'end'): TextPosition | undefined => {
    if (which === 'start') {
      for (let k = i; k < hay.map.length; k++) if (hay.map[k]) return hay.map[k];
    } else {
      for (let k = i; k >= 0; k--) if (hay.map[k]) return hay.map[k];
    }
    return undefined;
  };
  for (const n of counts) {
    const needle = words.slice(0, n).map((w) => squash(w)).filter(Boolean).join(WORD_SEP);
    if (!needle) continue;
    let from = 0;
    let found = -1;
    for (let k = 0; k <= nth; k++) {
      found = hay.text.indexOf(needle, from);
      while (found >= 0 && !wordBounded(hay.text, found, needle.length)) {
        found = hay.text.indexOf(needle, found + 1);
      }
      if (found < 0) break;
      from = found + 1;
    }
    if (found < 0 && n !== words.length) {
      found = hay.text.indexOf(needle);
      while (found >= 0 && !wordBounded(hay.text, found, needle.length)) {
        found = hay.text.indexOf(needle, found + 1);
      }
    }
    if (found < 0) continue;
    const first = mapPos(found, 'start');
    const last = mapPos(found + needle.length - 1, 'end');
    if (!first || !last) continue;
    const lastSeg = segments[last.seg];
    const endOffset = last.offset + ([...lastSeg.slice(last.offset)][0]?.length ?? 1);
    return { start: first, end: { seg: last.seg, offset: endOffset }, exact: n === words.length, words: n };
  }
  return undefined;
}
