/**
 * Phrase search over the text nodes of a rendered PDF page (pdf.js text layer).
 *
 * The text layer splits a line into many nodes and breaks words at line ends,
 * so a phrase is searched in a "squashed" form (letters and digits only,
 * lower-case, no accents/ligatures) and mapped back to node offsets. Pure
 * functions: the DOM part lives in `src/web/pdfRender.ts`.
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

function squashChar(ch: string): string {
  if (ch === '\u00ad') return '';
  const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let out = '';
  for (const c of base) if (!NON_ALNUM.test(c)) out += c;
  return out;
}

export const squash = (s: string) => [...s].map(squashChar).join('');

interface Squashed {
  text: string;
  /** For each squashed char, where it came from. */
  map: TextPosition[];
}

function squashSegments(segments: readonly string[]): Squashed {
  let text = '';
  const map: TextPosition[] = [];
  segments.forEach((seg, si) => {
    let offset = 0;
    for (const ch of seg) {
      const sq = squashChar(ch);
      for (let k = 0; k < sq.length; k++) {
        text += sq[k];
        map.push({ seg: si, offset });
      }
      offset += ch.length;
    }
  });
  return { text, map };
}

/**
 * Finds `phrase` in the text nodes. `nth` selects the n-th occurrence (0-based).
 * If the full phrase is not found, progressively shorter leading parts are tried
 * (never fewer than `minWords` words), so a passage that was cleaned differently
 * from the text layer still gets located.
 */
export function findPhrase(segments: readonly string[], phrase: string, opts: { nth?: number; minWords?: number } = {}): PhraseMatch | undefined {
  const words = phrase.split(/\s+/).filter((w) => squash(w).length > 0);
  if (words.length === 0) return undefined;
  const hay = squashSegments(segments);
  const minWords = Math.min(opts.minWords ?? 4, words.length);
  const counts = [...new Set([words.length, 24, 16, 12, 8, 6, minWords])].filter((n) => n <= words.length && n >= minWords).sort((a, b) => b - a);
  const nth = opts.nth ?? 0;
  for (const n of counts) {
    const needle = squash(words.slice(0, n).join(' '));
    if (!needle) continue;
    let from = 0;
    let found = -1;
    for (let k = 0; k <= nth; k++) {
      found = hay.text.indexOf(needle, from);
      if (found < 0) break;
      from = found + 1;
    }
    // for partial phrases only the first occurrence is meaningful
    if (found < 0 && n !== words.length) found = hay.text.indexOf(needle);
    if (found < 0) continue;
    const first = hay.map[found];
    const last = hay.map[found + needle.length - 1];
    const lastSeg = segments[last.seg];
    // end offset = after the matched character (surrogate-pair safe)
    const endOffset = last.offset + ([...lastSeg.slice(last.offset)][0]?.length ?? 1);
    return { start: first, end: { seg: last.seg, offset: endOffset }, exact: n === words.length, words: n };
  }
  return undefined;
}
