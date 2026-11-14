/**
 * Picks the sentence inside a multi-sentence passage that should be opened and
 * highlighted in the source PDF.
 *
 * Claims are often PT-BR while sources are often English, so ranking prefers
 * language-independent anchors (normalised numbers and percentages, author
 * surnames, acronyms and model names such as CNN or U-Net). When the
 * multilingual embedding model is on, sentence-level cosine similarity is the
 * next signal. Lexical overlap is only a tie-break: if there are no anchors
 * and no semantic scores, the passage is highlighted as a whole and labelled
 * approximate — the first sentence of the chunk is not pretended to be "the" match.
 */
import { checkableNumbers } from './attribution.js';
import { stripDiacritics } from './normalize.js';

export interface FocusSentence {
  text: string;
  page: number;
}

export interface PassageFocus {
  text: string;
  page: number;
  index: number;
  /** True when anchors or sentence-level embeddings uniquely identify the sentence. */
  exact: boolean;
}

export interface FocusOptions {
  /** Surnames of the cited work (from the marker). */
  authors?: string[];
  /** Sentence-level cosine similarity with the claim, keyed by sentence text (present when the semantic model ran). */
  sentenceSem?: ReadonlyMap<string, number>;
}

const SEM_FLOOR = 0.3;
const SEM_MARGIN = 0.04;

/** Numeric forms of a claim number, including comma/dot and % ↔ proportion. */
export function numberForms(n: string): string[] {
  const v = Number(n.replace(',', '.'));
  if (!Number.isFinite(v)) return [n];
  const out = new Set<string>();
  const add = (x: string) => {
    out.add(x);
    if (x.includes('.')) out.add(x.replace('.', ','));
  };
  add(n.replace(',', '.'));
  add(String(v));
  add(String(+(v * 100).toFixed(4)));
  add(String(+(v / 100).toFixed(6)));
  return [...out];
}

export function numbersInText(text: string): number[] {
  const out: number[] = [];
  const s = text.replace(/%/g, ' % ');
  for (const m of s.matchAll(/(?<![\w.])(\d+(?:[.,]\d+)?)(?![\w]|[.,]\d)/g)) {
    const v = Number(m[1].replace(',', '.'));
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

function numbersEquivalent(a: number, b: number): boolean {
  if (Math.abs(a - b) < 1e-9) return true;
  // 0.76 ↔ 76 (percent / proportion), with a little rounding slack
  const slack = (w: number) => 0.051 * Math.max(1, Math.abs(w) / 100);
  if (Math.abs(a * 100 - b) < slack(b) && (a < 1 || b >= 10)) return true;
  if (Math.abs(b * 100 - a) < slack(a) && (b < 1 || a >= 10)) return true;
  return false;
}

export function sentenceHasNumber(sentence: string, n: string): boolean {
  const target = Number(n.replace(',', '.'));
  if (!Number.isFinite(target)) return false;
  return numbersInText(sentence).some((v) => numbersEquivalent(v, target));
}

/**
 * Acronyms and model names: "CNN", "IoU", "SAM2", "U-Net", "Mask2Former", "DINOv2".
 * Folded form drops hyphens and case so "U-Net" matches "UNet" and "u-net".
 */
export function extractAcronyms(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b([A-Z]{2,}[A-Za-z0-9]*|[A-Z][A-Za-z]*-[A-Z0-9][A-Za-z0-9-]*|[A-Za-z]{1,4}[-]?(?:Net|NET|Former|ViT|GAN|LSTM|BERT)\w*|[A-Z]{2,}\d+[A-Za-z]?|[A-Za-z]+\d+[A-Za-z]?)\b/g)) {
    const fold = stripDiacritics(m[1]).toLowerCase().replace(/[-_]/g, '');
    if (fold.length >= 2 && !/^\d+$/.test(fold)) out.add(fold);
  }
  return [...out];
}

const AUTHOR_STOP = new Set('the and et al de da do dos das van von der den del di le la el of for in on at to by frente segundo conforme author authors autor autora autores'.split(' '));

/** Surnames written in a citation marker, style-agnostic. */
export function authorsFromMarker(marker: string): string[] {
  const stripped = marker
    .replace(/\b(?:et\s+al\.?|p{1,2}\.\s*[\d\-–]+|(?:1[5-9]|20)\d{2}[a-z]?)\b/gi, ' ')
    .replace(/[^\p{L}\s'-]/gu, ' ');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of stripped.split(/\s+/)) {
    if (w.length < 3 || AUTHOR_STOP.has(w.toLowerCase())) continue;
    if (!/^\p{Lu}/u.test(w)) continue;
    const fold = stripDiacritics(w).toLowerCase();
    if (seen.has(fold)) continue;
    seen.add(fold);
    out.push(fold);
  }
  return out;
}

function sentenceHasAuthor(sentence: string, author: string): boolean {
  const fold = stripDiacritics(sentence).toLowerCase();
  return new RegExp(`(?<!\\p{L})${author.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\p{L})`, 'u').test(fold);
}

function sentenceHasAcronym(sentence: string, acr: string): boolean {
  return extractAcronyms(sentence).includes(acr) || stripDiacritics(sentence).toLowerCase().replace(/[-_]/g, '').includes(acr);
}

export function anchorScore(sentence: string, claim: string, authors: string[] = []): { score: number; hits: number } {
  const numbers = checkableNumbers(claim).map((n) => n.raw);
  const acronyms = extractAcronyms(claim);
  let score = 0;
  let hits = 0;
  for (const n of numbers) {
    if (sentenceHasNumber(sentence, n)) {
      score += 10;
      hits++;
    }
  }
  for (const a of acronyms) {
    if (sentenceHasAcronym(sentence, a)) {
      score += 6;
      hits++;
    }
  }
  for (const a of authors) {
    if (sentenceHasAuthor(sentence, a)) {
      score += 4;
      hits++;
    }
  }
  return { score, hits };
}

function lexicalOverlap(sentence: string, claim: string): number {
  const toks = (s: string) =>
    new Set(
      stripDiacritics(s)
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length >= 4)
        .map((w) => w.slice(0, 5)),
    );
  const c = toks(claim);
  if (c.size === 0) return 0;
  let n = 0;
  for (const t of toks(sentence)) if (c.has(t)) n++;
  return n;
}

/**
 * Best sentence in the window. `exact` is true only when anchors or the
 * semantic model identify it; otherwise the caller should highlight the whole
 * passage and label the card as approximate.
 */
export function bestPassageFocus(sentences: readonly FocusSentence[], claim: string, opts: FocusOptions = {}): PassageFocus | undefined {
  if (!sentences.length) return undefined;
  const authors = opts.authors ?? [];
  const anchors = sentences.map((s) => anchorScore(s.text, claim, authors));
  const lex = sentences.map((s) => lexicalOverlap(s.text, claim));
  const bestAnchor = Math.max(0, ...anchors.map((a) => a.score));

  if (bestAnchor > 0) {
    let best = 0;
    for (let i = 1; i < sentences.length; i++) {
      const d = anchors[i].score - anchors[best].score;
      if (d > 0 || (d === 0 && lex[i] > lex[best])) best = i;
    }
    const pick = sentences[best];
    return { text: pick.text, page: pick.page, index: best, exact: true };
  }

  const sem = opts.sentenceSem;
  if (sem && sem.size) {
    const scores = sentences.map((s) => sem.get(s.text) ?? -1);
    const best = scores.reduce((b, v, i) => (v > scores[b] ? i : b), 0);
    const second = scores.filter((_, i) => i !== best).reduce((m, v) => Math.max(m, v), -1);
    if (scores[best] >= SEM_FLOOR && (second < 0 || scores[best] - second >= SEM_MARGIN)) {
      const pick = sentences[best];
      return { text: pick.text, page: pick.page, index: best, exact: true };
    }
  }

  // No anchors and no (decisive) semantic model: do not pretend the first
  // sentence of the chunk is the match. The viewer highlights the whole passage.
  return { text: sentences[0].text, page: sentences[0].page, index: 0, exact: false };
}
