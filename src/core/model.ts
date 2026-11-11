/**
 * Citation Graph data model.
 *
 * Phase 1 populates `document` and `publication` nodes plus `cites` and
 * (suggested) `related_to` edges. The remaining node and edge kinds are part of
 * the schema already so that Phase 2 (evidence graph) does not require a
 * migration.
 *
 * Scientific-integrity rules encoded here:
 *  - Every edge carries one or more `Provenance` records describing where and
 *    how the relation was detected.
 *  - `VerificationStatus` keeps confirmed bibliographic relations apart from
 *    suggestions; only a human review can produce `validated`.
 *  - Unknown values stay `undefined` and are rendered as "unavailable"; nothing
 *    is filled with guesses.
 *  - Page numbers are always *physical* PDF page indices (1-based), never the
 *    journal's printed page numbers.
 */

export const SCHEMA_VERSION = 1 as const;

export type NodeKind = 'document' | 'publication' | 'claim' | 'evidence';

export type EdgeKind =
  | 'cites' // publication/document A cites publication B
  | 'contains_claim' // document contains a claim
  | 'references' // claim cites a publication
  | 'has_evidence' // publication contains a passage
  | 'supports' // passage associated as support for a claim
  | 'contradicts' // reviewed contradiction
  | 'related_to'; // thematic relation, never implies citation

export const EDGE_KINDS: readonly EdgeKind[] = [
  'cites',
  'contains_claim',
  'references',
  'has_evidence',
  'supports',
  'contradicts',
  'related_to',
];

export type VerificationStatus =
  /** Bibliographic relation located in the documents or in trusted metadata. */
  | 'confirmed'
  /** Detected but not confirmed (e.g. weak or ambiguous match). Needs review. */
  | 'unverified'
  /** Thematic / inferred relation. Never implies a citation. */
  | 'suggested'
  /** Passage found by an algorithm; not reviewed. */
  | 'candidate'
  /** A researcher confirmed it. Only reachable through a human review. */
  | 'validated'
  /** Reviewed, but support could not be determined. */
  | 'inconclusive'
  /** Content seems to contradict the claim; requires human review. */
  | 'potential_contradiction'
  /** A researcher rejected it. Kept for audit, hidden by default. */
  | 'rejected';

export type DetectionMethod =
  | 'bibtex_declared' // entry of the main document's own bibliography (.bib)
  | 'reference_list_entry' // entry of the main document's own reference list (PDF)
  | 'reference_list_doi' // reference entry in a PDF bibliography matched by DOI
  | 'reference_list_title' // reference entry matched by normalized title (+ author/year)
  | 'reference_list_author_year' // weak: only first author + year matched
  | 'in_text_marker' // in-text citation marker, e.g. "(Silva et al., 2025)"
  | 'pdf_doi' // DOI printed on the first pages of a PDF
  | 'pdf_title' // bibliographic title found on the first pages of a PDF
  | 'pdf_info' // PDF document-info dictionary
  | 'external_metadata' // OpenAlex / Crossref (opt-in)
  | 'bibliographic_coupling' // shares confirmed references (suggestion only)
  | 'keyword_rule' // category suggested by configurable keyword rules
  | 'semantic_similarity' // Phase 2 passage retrieval (suggestion only)
  | 'manual'; // decision made by the researcher

/** Methods that are automatic and therefore can never yield `validated`. */
export const AUTOMATIC_METHODS: ReadonlySet<DetectionMethod> = new Set<DetectionMethod>([
  'bibtex_declared',
  'reference_list_entry',
  'reference_list_doi',
  'reference_list_title',
  'reference_list_author_year',
  'in_text_marker',
  'pdf_doi',
  'pdf_title',
  'pdf_info',
  'external_metadata',
  'bibliographic_coupling',
  'keyword_rule',
  'semantic_similarity',
]);

/** Rectangle in PDF points, origin at the top-left corner of the page. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A location inside a PDF. `rects` are only present when they were produced by
 * the text extractor (never computed or guessed).
 */
export interface Anchor {
  fileId: string;
  /** 1-based physical page index inside the PDF file. */
  page: number;
  /** Text expected on that page (used to verify and to search/highlight). */
  text?: string;
  rects?: Rect[];
  /** Page size in points, needed to scale `rects` in the viewer. */
  pageSize?: { width: number; height: number };
}

export interface Provenance {
  method: DetectionMethod;
  /** Node id of the document/publication where the relation was found. */
  sourceNodeId?: string;
  /** File in which it was found. */
  sourceFileId?: string;
  /** DOI or BibTeX key used as bibliographic identifier. */
  bibliographicId?: string;
  /** Reference-list entry (raw text) supporting a `cites` edge. */
  referenceText?: string;
  /** Location of the reference entry in the source PDF bibliography. */
  referenceAnchor?: Anchor;
  /** Locations of in-text citation markers. */
  citationAnchors?: Anchor[];
  /** Location of an evidence passage (Phase 2). */
  evidenceAnchor?: Anchor;
  /** Associated text (claim text, passage, ...). */
  text?: string;
  /** Which identity fields matched, e.g. ["doi"] or ["title","year","first_author"]. */
  matchedBy?: string[];
  /** Only set when produced by a scoring/classification model. */
  confidence?: number;
  notes?: string[];
}

export interface ReviewRecord {
  action: ReviewAction;
  from: VerificationStatus;
  to: VerificationStatus;
  note?: string;
  at: string;
}

export type ReviewAction = 'confirm' | 'reject' | 'mark_inconclusive' | 'flag_contradiction' | 'reset';

export interface GraphEdge {
  id: string;
  kind: EdgeKind;
  source: string;
  target: string;
  status: VerificationStatus;
  provenance: Provenance[];
  reviews?: ReviewRecord[];
}

export interface Author {
  /** As written in the source, e.g. "Kessel-Brandt, Lena". */
  raw: string;
  family: string;
  given?: string;
  /** True for corporate authors such as "{CVAT.ai}". */
  organization?: boolean;
}

export type MetadataSourceKind = 'bibtex' | 'pdf_info' | 'pdf_text' | 'reference_list' | 'external_metadata' | 'manual';

export interface MetadataSource {
  kind: MetadataSourceKind;
  /** File id, BibTeX key, or API name. */
  ref?: string;
  fields: string[];
}

export interface CategoryAssignment {
  value: string;
  source: 'user' | 'suggested';
  /** Keyword(s) that triggered a suggestion. */
  matched?: string[];
}

interface BaseNode {
  id: string;
  kind: NodeKind;
  label: string;
}

export interface DocumentNode extends BaseNode {
  kind: 'document';
  title?: string;
  fileId?: string;
}

export interface PublicationNode extends BaseNode {
  kind: 'publication';
  title?: string;
  authors: Author[];
  year?: number;
  /** Year suffix as written (e.g. "2025a"), if any. */
  yearLabel?: string;
  doi?: string;
  venue?: string;
  abstract?: string;
  url?: string;
  bibKeys: string[];
  entryType?: string;
  category?: CategoryAssignment;
  fileIds: string[];
  metadataSources: MetadataSource[];
  /** True when declared in the main document bibliography. */
  inMainBibliography: boolean;
}

export interface ClaimNode extends BaseNode {
  kind: 'claim';
  documentId: string;
  text: string;
  anchor?: Anchor;
}

export interface EvidenceNode extends BaseNode {
  kind: 'evidence';
  publicationId: string;
  text: string;
  anchor: Anchor;
}

export type GraphNode = DocumentNode | PublicationNode | ClaimNode | EvidenceNode;

export type FileRole = 'main' | 'reference' | 'bibtex';
export type Visibility = 'private' | 'shareable';

export type FileStorage =
  | { kind: 'managed'; relPath: string }
  /** Registered by path (CLI). The original is never modified or deleted. */
  | { kind: 'external'; absPath: string };

export interface FileRecord {
  id: string;
  sha256: string;
  originalName: string;
  role: FileRole;
  /** Defaults to private. Private text never leaves the machine or shared exports. */
  visibility: Visibility;
  storage: FileStorage;
  addedAt: string;
  pageCount?: number;
  extraction: { status: 'pending' | 'ok' | 'no_text' | 'failed'; error?: string };
}

export interface FileLink {
  fileId: string;
  publicationId?: string;
  status: 'matched' | 'unmatched' | 'ambiguous' | 'manual';
  method?: DetectionMethod;
  candidates?: string[];
}

export interface IdentityReview {
  id: string;
  a: string;
  b: string;
  reasons: string[];
  score: number;
  decision?: 'same' | 'distinct';
}

export interface CitationIssue {
  id: string;
  marker: string;
  page: number;
  fileId: string;
  status: 'ambiguous' | 'unresolved';
  candidates: string[];
}

export interface UnresolvedReference {
  sourceNodeId: string;
  fileId: string;
  page: number;
  text: string;
  doi?: string;
  candidates: string[];
  reason: 'no_match' | 'ambiguous';
}

export interface CitationGraph {
  schemaVersion: typeof SCHEMA_VERSION;
  projectId: string;
  builtAt: string;
  nodes: Record<string, GraphNode>;
  edges: Record<string, GraphEdge>;
  files: Record<string, FileRecord>;
  fileLinks: FileLink[];
  identityReviews: IdentityReview[];
  citationIssues: CitationIssue[];
  unresolvedReferences: UnresolvedReference[];
  /** Human-readable warnings produced while building (never silently dropped). */
  warnings: string[];
}

/** Decisions made by the researcher; persisted separately and re-applied on every rebuild. */
export interface UserDecisions {
  identity: Record<string, 'same' | 'distinct'>;
  fileLinks: Record<string, string | null>;
  categories: Record<string, string | null>;
  edgeReviews: Record<string, { action: ReviewAction; note?: string; at: string }[]>;
}

export const emptyDecisions = (): UserDecisions => ({
  identity: {},
  fileLinks: {},
  categories: {},
  edgeReviews: {},
});

export const isPublication = (n: GraphNode | undefined): n is PublicationNode => n?.kind === 'publication';
