/**
 * Matcher v2: finds, in the PDF of a cited work, the passages closest to the sentence that cites it.
 *
 * Stage 1 (this file, deterministic, offline): claim terms (cited clause > citing sentence > neighbouring sentences)
 * expanded PT->EN, BM25-style scoring over windows of 1-3 sentences, cognate normalisation and edit-distance-1 fuzzy
 * matching. It yields a ranked candidate list with a lexical coverage score in 0..1.
 * Stage 2 (optional, see semantic.ts): a multilingual sentence-embedding model re-ranks the candidates.
 *
 * Nothing here proves a claim: every result is a candidate for human review.
 */
import { GLOSSARY_V2, STOPWORDS, stemOf } from './lexicon.js';
import { stripDiacritics } from './normalize.js';
import type { IndexedSentence, ReferenceIndex } from './evidence.js';

export interface MatchParams {
  k1: number;
  b: number;
  windowSizes: number[];
  topK: number;
  /** Weight of terms of the clause around the citation marker. */
  localWeight: number;
  /** Weight of the other terms of the citing sentence. */
  sentenceWeight: number;
  /** Weight of terms that only occur in the neighbouring sentences. */
  contextWeight: number;
  /** Claim terms absent from the whole reference PDF count this much in the denominator. */
  absentWeight: number;
  /** Weight of a fuzzy (edit distance 1) hit. */
  fuzzyWeight: number;
  /** Weight of the glossary translation relative to the original term. */
  translationWeight: number;
  numberWeight: number;
  acronymWeight: number;
  /** 0..1: how much longer windows are penalised. */
  windowPenalty: number;
}

export const MATCH_PARAMS: MatchParams = {
  k1: 1.2,
  b: 0.5,
  windowSizes: [1, 2, 3],
  topK: 24,
  localWeight: 1,
  sentenceWeight: 0.7,
  contextWeight: 0.3,
  absentWeight: 0.3,
  fuzzyWeight: 0.6,
  translationWeight: 0.9,
  numberWeight: 2,
  acronymWeight: 2,
  windowPenalty: 0.04,
};

const TOKEN_RE = /\d+[.,]\d+|\d+|[A-Za-z][A-Za-z0-9+]*(?:-[A-Za-z0-9+]+)*/g;

export interface Token {
  /** Term key: stem, `#number` or `@acronym`. */
  t: string;
  kind: 'word' | 'number' | 'acronym';
}

export function tokenizeV2(input: string): Token[] {
  const s = stripDiacritics(input.replace(/\u00ad/g, '').replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl'));
  const out: Token[] = [];
  for (const m of s.matchAll(TOKEN_RE)) {
    const w = m[0];
    if (/^\d/.test(w)) {
      if (w.length >= 2) out.push({ t: '#' + w.replace(',', '.'), kind: 'number' });
      continue;
    }
    const parts = w.split('-');
    const acronym = /\d/.test(w) || (w.match(/[A-Z]/g) ?? []).length >= 2;
    if (acronym) out.push({ t: '@' + w.toLowerCase().replace(/-/g, ''), kind: 'acronym' });
    for (const p of parts) {
      const lw = p.toLowerCase();
      if (lw.length < 3 || STOPWORDS.has(lw) || /\d/.test(lw)) continue;
      out.push({ t: stemOf(lw), kind: 'word' });
    }
  }
  return out;
}

export interface SentenceTf {
  tf: Map<string, number>;
  len: number;
}

export interface IndexV2 {
  tf: SentenceTf[];
  df: Map<string, number>;
  /** Vocabulary of word stems by first two letters (fuzzy lookup). */
  vocab: Map<string, string[]>;
  avgLen: number;
  n: number;
}

const v2Cache = new WeakMap<ReferenceIndex, IndexV2>();

export function indexV2(index: ReferenceIndex): IndexV2 {
  const hit = v2Cache.get(index);
  if (hit) return hit;
  const tf: SentenceTf[] = [];
  const df = new Map<string, number>();
  let total = 0;
  for (const s of index.sentences) {
    const m = new Map<string, number>();
    let len = 0;
    for (const tok of tokenizeV2(s.text)) {
      m.set(tok.t, (m.get(tok.t) ?? 0) + 1);
      len++;
    }
    for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    tf.push({ tf: m, len });
    total += len;
  }
  const vocab = new Map<string, string[]>();
  for (const t of df.keys()) {
    if (t[0] === '#' || t[0] === '@' || t.length < 5) continue;
    const k = t.slice(0, 2);
    vocab.set(k, [...(vocab.get(k) ?? []), t]);
  }
  const out = { tf, df, vocab, avgLen: total / Math.max(1, tf.length), n: tf.length };
  v2Cache.set(index, out);
  return out;
}

function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length < b.length ? a.slice(i) === b.slice(i + 1) : a.slice(i + 1) === b.slice(i);
}

export interface QueryTerm {
  t: string;
  w: number;
}

/** Claim text parts, from most to least specific. */
export interface ClaimParts {
  /** Clause around the marker (may be empty). */
  local?: string;
  /** Citing sentence without markers. */
  sentence: string;
  /** Previous and next sentences. */
  context?: string;
}

const typeWeight = (k: Token['kind'], p: MatchParams) => (k === 'number' ? p.numberWeight : k === 'acronym' ? p.acronymWeight : 1);

/** Weighted query terms (with PT->EN translations) of a claim. */
export function buildQuery(parts: ClaimParts, p: MatchParams = MATCH_PARAMS): QueryTerm[] {
  const w = new Map<string, number>();
  const add = (t: string, v: number) => {
    if (v > (w.get(t) ?? 0)) w.set(t, v);
  };
  const feed = (text: string | undefined, base: number) => {
    if (!text) return;
    for (const tok of tokenizeV2(text)) {
      const v = base * typeWeight(tok.kind, p);
      add(tok.t, v);
      if (tok.kind === 'word') for (const en of GLOSSARY_V2.get(tok.t) ?? []) add(en, v * p.translationWeight);
    }
  };
  feed(parts.context, p.contextWeight);
  feed(parts.sentence, p.sentenceWeight);
  feed(parts.local, p.localWeight);
  return [...w].map(([t, v]) => ({ t, w: v }));
}

export interface Candidate {
  /** First sentence index and number of sentences of the window. */
  start: number;
  len: number;
  /** Lexical coverage 0..1 (weighted share of claim terms present, length-normalised). */
  lex: number;
  /** Page of the first sentence of the window that matches a claim term. */
  page: number;
  region: 'resumo' | 'corpo';
  text: string;
  /** Claim numbers (>= 2 digits or decimals) missing from the window. */
  missingNumbers: string[];
  /** Matched claim term share of the best single sentence in the window. */
  matchedTerms: number;
  /** Cosine similarity with the claim (stage 2), when computed. */
  sem?: number;
  /** Final score used for ranking and labelling. */
  score: number;
}

const idf = (df: number | undefined, n: number) => Math.log(1 + (n - (df ?? 0) + 0.5) / ((df ?? 0) + 0.5));

export function windowText(S: IndexedSentence[], start: number, len: number, maxChars: number): string {
  const t = S.slice(start, start + len).map((s) => s.text).join(' ');
  return t.length > maxChars ? t.slice(0, maxChars - 1).trimEnd() + '…' : t;
}

/** Stage 1: ranked candidate windows of one reference. */
export function lexicalCandidates(index: ReferenceIndex, query: QueryTerm[], p: MatchParams = MATCH_PARAMS, maxChars = 450): Candidate[] {
  const S = index.sentences;
  const x = indexV2(index);
  if (!x.n || !query.length) return [];
  // resolve terms against the reference vocabulary (exact, fuzzy or absent)
  const terms: { t: string; w: number; idf: number; denom: number }[] = [];
  for (const q of query) {
    let t = q.t;
    let w = q.w;
    let known = x.df.has(t);
    if (!known && t.length >= 5 && t[0] !== '#' && t[0] !== '@') {
      const near = (x.vocab.get(t.slice(0, 2)) ?? []).filter((v) => withinOneEdit(t, v)).sort((a, b) => (x.df.get(b) ?? 0) - (x.df.get(a) ?? 0))[0];
      if (near) {
        t = near;
        w *= p.fuzzyWeight;
        known = true;
      }
    }
    const i = idf(x.df.get(t), x.n);
    terms.push({ t, w, idf: i, denom: known ? w * i : w * i * p.absentWeight });
  }
  const denom = terms.reduce((a, q) => a + q.denom, 0) || 1;
  const numbers = query.filter((q) => q.t[0] === '#' && (q.t.length > 3 || q.t.includes('.'))).map((q) => q.t);
  const out: Candidate[] = [];
  for (const L of p.windowSizes) {
    for (let i = 0; i + L <= x.n; i++) {
      if (L > 1 && S[i + L - 1].region !== S[i].region) continue;
      let dl = 0;
      for (let k = 0; k < L; k++) dl += x.tf[i + k].len;
      if (dl === 0) continue;
      const norm = 1 - p.b + (p.b * dl) / (x.avgLen * L);
      let sum = 0;
      let matched = 0;
      for (const q of terms) {
        let tf = 0;
        for (let k = 0; k < L; k++) tf += x.tf[i + k].tf.get(q.t) ?? 0;
        if (!tf) continue;
        matched++;
        sum += q.w * q.idf * Math.min(1, (tf * (p.k1 + 1)) / (tf + p.k1 * norm));
      }
      if (!sum) continue;
      const lex = (sum / denom) * (1 - p.windowPenalty * (L - 1));
      let firstPage = S[i].page;
      for (let k = 0; k < L; k++) {
        if (terms.some((q) => x.tf[i + k].tf.has(q.t))) {
          firstPage = S[i + k].page;
          break;
        }
      }
      const miss = numbers.filter((n) => {
        for (let k = 0; k < L; k++) if (x.tf[i + k].tf.has(n)) return false;
        return true;
      });
      out.push({
        start: i,
        len: L,
        lex,
        page: firstPage,
        region: S[i].region,
        text: '',
        missingNumbers: miss.map((n) => n.slice(1)),
        matchedTerms: matched / terms.length,
        score: lex,
      });
    }
  }
  out.sort((a, b) => b.lex - a.lex || a.len - b.len || a.start - b.start);
  // keep the best non-overlapping windows
  const taken: Candidate[] = [];
  for (const c of out) {
    if (taken.some((o) => c.start < o.start + o.len && o.start < c.start + c.len)) continue;
    taken.push(c);
    if (taken.length >= p.topK) break;
  }
  for (const c of taken) c.text = windowText(S, c.start, c.len, maxChars);
  return taken;
}
