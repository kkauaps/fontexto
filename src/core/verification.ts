/**
 * Verification state machine.
 *
 * Automatic detection can only produce `confirmed` (bibliographic relation
 * located in documents/metadata), `unverified`, `suggested` or `candidate`.
 * `validated`, `inconclusive` and `rejected` are reachable exclusively through
 * a human review action. Semantic similarity never validates evidence.
 */
import {
  AUTOMATIC_METHODS,
  type DetectionMethod,
  type EdgeKind,
  type GraphEdge,
  type ReviewAction,
  type ReviewRecord,
  type VerificationStatus,
} from './model.js';

/** Statuses an automatic method may assign, per edge kind. */
const AUTOMATIC_ALLOWED: Record<EdgeKind, VerificationStatus[]> = {
  cites: ['confirmed', 'unverified'],
  references: ['confirmed', 'unverified'],
  contains_claim: ['candidate'],
  has_evidence: ['candidate'],
  supports: ['candidate'],
  contradicts: ['potential_contradiction'],
  related_to: ['suggested'],
};

/** Methods allowed to produce a *confirmed* bibliographic relation. */
const CONFIRMING_METHODS: ReadonlySet<DetectionMethod> = new Set<DetectionMethod>([
  'bibtex_declared',
  'reference_list_entry',
  'reference_list_doi',
  'reference_list_title',
  'in_text_marker',
  'external_metadata',
  'manual',
]);

export class VerificationError extends Error {}

/** Throws if an automatically detected edge claims a status it cannot have. */
export function assertAutomaticStatus(kind: EdgeKind, method: DetectionMethod, status: VerificationStatus): void {
  if (!AUTOMATIC_METHODS.has(method)) return;
  if (!AUTOMATIC_ALLOWED[kind].includes(status)) {
    throw new VerificationError(`Automatic method "${method}" cannot set ${kind} edge to "${status}"`);
  }
  if (status === 'confirmed' && !CONFIRMING_METHODS.has(method)) {
    throw new VerificationError(`Method "${method}" cannot confirm a bibliographic relation`);
  }
}

const TRANSITIONS: Record<EdgeKind, Partial<Record<ReviewAction, Partial<Record<VerificationStatus, VerificationStatus>>>>> = {
  cites: {
    confirm: { unverified: 'confirmed', rejected: 'confirmed' },
    reject: { unverified: 'rejected', confirmed: 'rejected' },
  },
  references: {
    confirm: { unverified: 'confirmed', rejected: 'confirmed' },
    reject: { unverified: 'rejected', confirmed: 'rejected' },
  },
  supports: {
    confirm: { candidate: 'validated', inconclusive: 'validated', rejected: 'validated' },
    reject: { candidate: 'rejected', validated: 'rejected', inconclusive: 'rejected' },
    mark_inconclusive: { candidate: 'inconclusive', validated: 'inconclusive' },
    flag_contradiction: { candidate: 'potential_contradiction', inconclusive: 'potential_contradiction' },
  },
  contradicts: {
    confirm: { potential_contradiction: 'validated' },
    reject: { potential_contradiction: 'rejected', validated: 'rejected' },
    mark_inconclusive: { potential_contradiction: 'inconclusive' },
  },
  has_evidence: {
    confirm: { candidate: 'validated' },
    reject: { candidate: 'rejected', validated: 'rejected' },
  },
  contains_claim: {
    confirm: { candidate: 'validated' },
    reject: { candidate: 'rejected', validated: 'rejected' },
  },
  related_to: {
    // Agreeing with a thematic suggestion never turns it into a citation.
    confirm: { suggested: 'validated' },
    reject: { suggested: 'rejected', validated: 'rejected' },
  },
};

export function nextStatus(kind: EdgeKind, current: VerificationStatus, action: ReviewAction, original: VerificationStatus): VerificationStatus {
  if (action === 'reset') return original;
  const to = TRANSITIONS[kind][action]?.[current];
  if (!to) throw new VerificationError(`Action "${action}" is not allowed for ${kind} edge in status "${current}"`);
  return to;
}

/** Applies a human review and records it on the edge (returns a new edge). */
export function applyReview(edge: GraphEdge, action: ReviewAction, at: string, note?: string, original?: VerificationStatus): GraphEdge {
  const base = original ?? edge.reviews?.[0]?.from ?? edge.status;
  const to = nextStatus(edge.kind, edge.status, action, base);
  const record: ReviewRecord = { action, from: edge.status, to, at, note };
  return { ...edge, status: to, reviews: [...(edge.reviews ?? []), record] };
}

/** True only for relations that a user may treat as established bibliographic facts. */
export const isEstablishedCitation = (e: GraphEdge) => e.kind === 'cites' && e.status === 'confirmed';

/** True only for evidence a researcher has validated. */
export const isValidatedEvidence = (e: GraphEdge) => e.kind === 'supports' && e.status === 'validated' && (e.reviews?.length ?? 0) > 0;
