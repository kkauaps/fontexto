/**
 * Claim-to-citation attribution: which part of a sentence (and which numbers)
 * a citation actually supports.
 *
 * Style-agnostic: the caller only passes marker spans and whether each one is
 * narrative. That covers ABNT/APA parentheticals ("(Kang et al., 2026; Zhou et
 * al., 2025)"), narrative forms ("Ribal et al. (2025)"), numeric citations
 * ("[1]", "[2,5]") and superscripts — those last two are just non-narrative
 * spans. Nothing here is tuned to a particular sentence.
 *
 * A leading narrative citation owns the text after it until the next citation
 * or a clause boundary. A parenthetical (or a narrative that sits after the
 * claim) owns the clause immediately before it. Numbers inside a leading
 * narrative's span belong to it, even if a later parenthetical's default span
 * would also cover them. If a number cannot be attributed to exactly one span,
 * it is left unattributed so it does not produce a false "number not in the
 * PDF" ressalva.
 */
export interface MarkerSpan {
  start: number;
  end: number;
  /** Narrative form ("Silva et al. (2020)"). Parenthetical, numeric and superscripts leave this unset. */
  narrative?: boolean;
}

export interface TextSpan {
  start: number;
  end: number;
}

export interface ClaimSpan {
  from: number;
  to: number;
  text: string;
}

/**
 * Strong clause boundaries that often start a new claim. Weak joins such as
 * ", com" or ", sem" are intentionally not boundaries: they usually continue
 * the same citation's statement ("…com acurácia de 0,76, sem produzir máscaras").
 */
const CONNECTOR = String.raw`embora|porém|porem|entretanto|contudo|todavia|no\s+entanto|apesar\s+de|ainda\s+que|mesmo\s+que|ao\s+passo\s+que|enquanto\s+que|although|even\s+though|though|whereas|however|nevertheless|nonetheless|despite|in\s+spite\s+of|aunque|sin\s+embargo|no\s+obstante|cependant|toutefois|bien\s+que`;
const BOUNDARY_RE = new RegExp(String.raw`(?:;+)|(?:,?\s+)(?:${CONNECTOR})\b|,?\s+(?:mas|but)\s+`, 'gi');

function nextBoundary(text: string, from: number, to: number): number | undefined {
  if (from >= to) return undefined;
  const re = new RegExp(BOUNDARY_RE.source, 'gi');
  const slice = text.slice(from, to);
  const m = re.exec(slice);
  return m ? from + m.index : undefined;
}

function prevBoundary(text: string, from: number, to: number): number | undefined {
  if (from >= to) return undefined;
  const re = new RegExp(BOUNDARY_RE.source, 'gi');
  const slice = text.slice(from, to);
  let last: number | undefined;
  for (let m = re.exec(slice); m; m = re.exec(slice)) last = from + m.index;
  return last;
}

/** Unique marker intervals, left to right (several authors in one parenthetical share one interval). */
export function uniqueMarks(marks: readonly MarkerSpan[]): MarkerSpan[] {
  const byKey = new Map<string, MarkerSpan>();
  for (const m of marks) {
    const k = `${m.start}:${m.end}`;
    if (!byKey.has(k)) byKey.set(k, m);
  }
  return [...byKey.values()].sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * A narrative citation is "leading" (owns the text after it) when it opens the
 * claim: nothing before it, a short introductory phrase, or a reporting
 * preposition ("Segundo", "According to"). A narrative after the claim
 * ("…as shown by Silva et al. (2020)") owns the preceding clause instead.
 */
export function isLeadingNarrative(text: string, sent: TextSpan, mark: MarkerSpan): boolean {
  if (!mark.narrative) return false;
  const before = text.slice(sent.start, mark.start).trim();
  if (!before) return true;
  const words = before.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (words.length <= 6) return true;
  return /(?:segundo|conforme|de acordo com|following|according to|as shown by|as reported by|as described by|como mostram?|como relata(?:m|do)?|como descrito por)\s*[,:]?\s*$/i.test(before);
}

function cleanClaim(raw: string, removals: TextSpan[]): string {
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

function inner(text: string, from: number, to: number, marks: readonly MarkerSpan[]): string {
  return cleanClaim(
    text.slice(from, to),
    marks.filter((m) => m.start >= from && m.end <= to).map((m) => ({ start: m.start - from, end: m.end - from })),
  );
}

/** Offsets (in `text`) of the clause this citation supports. */
export function claimOffsets(text: string, sent: TextSpan, marks: readonly MarkerSpan[], target: MarkerSpan): { from: number; to: number } {
  const spans = uniqueMarks(marks);
  const leading = isLeadingNarrative(text, sent, target);
  if (leading) {
    const next = spans.find((m) => m.start >= target.end);
    let to = next?.start ?? sent.end;
    const bound = nextBoundary(text, target.end, to);
    if (bound !== undefined) to = bound;
    return { from: target.end, to };
  }
  const prev = [...spans].reverse().find((m) => m.end <= target.start);
  let from = prev?.end ?? sent.start;
  const bound = prevBoundary(text, from, target.start);
  if (bound !== undefined) from = bound;
  return { from, to: target.start };
}

/** The clause this citation supports, with markers stripped. */
export function claimSpanFor(text: string, sent: TextSpan, marks: readonly MarkerSpan[], target: MarkerSpan): ClaimSpan {
  const { from, to } = claimOffsets(text, sent, marks, target);
  return { from, to, text: inner(text, from, to, marks) };
}

/** Numbers of the claim worth checking: decimals and 3+ digit integers that are not years nor the cited pages. */
export function checkableNumbers(claim: string, pages: number[] = []): { raw: string; start: number; end: number }[] {
  const out: { raw: string; start: number; end: number }[] = [];
  const seen = new Set<string>();
  for (const m of claim.matchAll(/(?<![\w.,])(\d+(?:[.,]\d+)?)(?![\w]|[.,]\d)/g)) {
    const raw = m[1].replace(',', '.');
    const n = Number(raw);
    if (!raw.includes('.') && raw.length < 3) continue;
    if (!raw.includes('.') && n >= 1900 && n <= 2099) continue;
    if (pages.includes(n)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    const start = m.index!;
    out.push({ raw, start, end: start + m[1].length });
  }
  return out;
}

/**
 * Numbers uniquely attributed to `target`. Numbers that also fall in a leading
 * narrative's span go to that narrative; anything with zero or several owners
 * is omitted (no ressalva).
 */
export function numbersAttributedTo(text: string, sent: TextSpan, marks: readonly MarkerSpan[], target: MarkerSpan, pages: number[] = []): string[] {
  const spans = uniqueMarks(marks).map((m) => ({ m, ...claimOffsets(text, sent, marks, m) }));
  const sentence = text.slice(sent.start, sent.end);
  const owned: string[] = [];
  for (const n of checkableNumbers(sentence, pages)) {
    const a = sent.start + n.start;
    const b = sent.start + n.end;
    const hits = spans.filter((s) => a >= s.from && b <= s.to);
    const narrativeHits = hits.filter((s) => isLeadingNarrative(text, sent, s.m));
    const winners = narrativeHits.length ? narrativeHits : hits;
    const keys = new Set(winners.map((s) => `${s.m.start}:${s.m.end}`));
    if (keys.size !== 1) continue;
    if (keys.has(`${target.start}:${target.end}`)) owned.push(n.raw);
  }
  return owned;
}
