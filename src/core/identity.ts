/**
 * Bibliographic identity resolution (deduplication).
 *
 * Priority: normalized DOI. Without DOI, combine normalized title, first author
 * and year. Same first author + same year alone is NEVER enough to merge: such
 * pairs become `ambiguous` and are sent to the researcher for confirmation.
 */
import type { Author, IdentityReview } from './model.js';
import { normalizeDoi, normalizeTitle, sameFamilyName, titleSimilarity } from './normalize.js';

export interface IdentityFields {
  doi?: string;
  title?: string;
  authors: Author[];
  year?: number;
}

export type IdentityVerdict = 'same' | 'distinct' | 'ambiguous';

export interface IdentityComparison {
  verdict: IdentityVerdict;
  /** Heuristic similarity score (0..1); not a calibrated probability. */
  score: number;
  reasons: string[];
}

export const TITLE_SAME_THRESHOLD = 0.95;
export const TITLE_AMBIGUOUS_THRESHOLD = 0.75;

function firstAuthorMatch(a: IdentityFields, b: IdentityFields): boolean | undefined {
  const fa = a.authors[0]?.family;
  const fb = b.authors[0]?.family;
  if (!fa || !fb) return undefined;
  return sameFamilyName(fa, fb);
}

export function compareIdentity(a: IdentityFields, b: IdentityFields): IdentityComparison {
  const doiA = normalizeDoi(a.doi);
  const doiB = normalizeDoi(b.doi);
  const tSim = titleSimilarity(a.title, b.title);
  const author = firstAuthorMatch(a, b);
  const yearDiff = a.year !== undefined && b.year !== undefined ? Math.abs(a.year - b.year) : undefined;

  if (doiA && doiB) {
    if (doiA === doiB) return { verdict: 'same', score: 1, reasons: ['doi'] };
    if (tSim >= TITLE_SAME_THRESHOLD && author !== false) {
      return {
        verdict: 'ambiguous',
        score: tSim,
        reasons: ['different_doi', 'same_title', 'possible_version_or_preprint'],
      };
    }
    return { verdict: 'distinct', score: 0, reasons: ['different_doi'] };
  }

  const hasTitles = Boolean(normalizeTitle(a.title)) && Boolean(normalizeTitle(b.title));
  if (!hasTitles) {
    if (author === true && yearDiff === 0) {
      return { verdict: 'ambiguous', score: 0.5, reasons: ['first_author', 'year', 'title_unavailable'] };
    }
    return { verdict: 'distinct', score: 0, reasons: ['insufficient_metadata'] };
  }

  if (tSim >= TITLE_SAME_THRESHOLD) {
    const reasons = ['title'];
    if (author === true) reasons.push('first_author');
    if (yearDiff === 0) reasons.push('year');
    if (author !== false && (yearDiff === 0 || yearDiff === undefined)) {
      return { verdict: 'same', score: tSim, reasons };
    }
    if (author === false) reasons.push('first_author_differs');
    if (yearDiff !== undefined && yearDiff > 0) reasons.push(`year_differs_by_${yearDiff}`);
    return { verdict: 'ambiguous', score: tSim * 0.8, reasons };
  }

  if (tSim >= TITLE_AMBIGUOUS_THRESHOLD && author === true && (yearDiff === undefined || yearDiff <= 1)) {
    return { verdict: 'ambiguous', score: tSim * 0.8, reasons: ['similar_title', 'first_author'] };
  }

  const reasons = ['title_differs'];
  if (author === true && yearDiff === 0) reasons.push('same_first_author_and_year_not_sufficient');
  return { verdict: 'distinct', score: tSim * 0.5, reasons };
}

export interface IdentityRecord {
  id: string;
  fields: IdentityFields;
}

export interface IdentityResolution {
  /** Each group lists record ids that represent the same publication. First id is the representative. */
  groups: string[][];
  reviews: IdentityReview[];
}

export const identityReviewId = (a: string, b: string) => {
  const [x, y] = [a, b].sort();
  return `idrev:${x}|${y}`;
};

export function resolveIdentities(
  records: IdentityRecord[],
  decisions: Record<string, 'same' | 'distinct'> = {},
): IdentityResolution {
  const parent = new Map<string, string>();
  for (const r of records) parent.set(r.id, r.id);
  const find = (x: string): string => {
    let p = parent.get(x)!;
    while (p !== parent.get(p)) p = parent.get(p)!;
    parent.set(x, p);
    return p;
  };
  const union = (x: string, y: string) => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent.set(ry, rx);
  };

  const reviews: IdentityReview[] = [];
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const a = records[i];
      const b = records[j];
      const rid = identityReviewId(a.id, b.id);
      const decision = decisions[rid];
      const cmp = compareIdentity(a.fields, b.fields);
      if (decision === 'same') {
        union(a.id, b.id);
      } else if (decision === 'distinct') {
        // explicit researcher decision: keep apart
      } else if (cmp.verdict === 'same') {
        union(a.id, b.id);
      }
      if (cmp.verdict === 'ambiguous' || decision) {
        reviews.push({ id: rid, a: a.id, b: b.id, reasons: cmp.reasons, score: cmp.score, decision });
      }
    }
  }

  const groupsByRoot = new Map<string, string[]>();
  for (const r of records) {
    const root = find(r.id);
    const g = groupsByRoot.get(root) ?? [];
    g.push(r.id);
    groupsByRoot.set(root, g);
  }
  // Ambiguous pairs that ended up in the same group through other evidence are no longer pending.
  const pending = reviews.filter((rv) => rv.decision || find(rv.a) !== find(rv.b));
  return { groups: [...groupsByRoot.values()], reviews: pending };
}
