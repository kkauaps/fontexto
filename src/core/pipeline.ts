/**
 * Deterministic graph builder.
 *
 * Inputs are the parsed .bib files, the cached PDF text of each file and the
 * researcher's decisions. Because PDF text is cached per file hash, rebuilding
 * is cheap and user decisions are re-applied on every build.
 */
import type { BibEntry } from './bibtex.js';
import { suggestCategory, type CategoryRule } from './categories.js';
import { extractCitationMarkers, resolveMarker } from './citations.js';
import { checkAnchor } from './anchors.js';
import { resolveIdentities, type IdentityRecord } from './identity.js';
import {
  SCHEMA_VERSION,
  type Anchor,
  type Author,
  type CitationGraph,
  type CitationIssue,
  type DetectionMethod,
  type DocumentNode,
  type FileLink,
  type FileRecord,
  type GraphEdge,
  type MetadataSource,
  type Provenance,
  type PublicationNode,
  type UnresolvedReference,
  type UserDecisions,
  type VerificationStatus,
} from './model.js';
import {
  decodeLatex,
  findDois,
  normalizeDoi,
  normalizeTitle,
  parseAuthorList,
  parseYear,
  titleSimilarity,
  titleTokens,
} from './normalize.js';
import { extractReferenceEntries, findReferenceHeading, matchReference, type ReferenceEntry } from './references.js';
import { pageString, type PdfText } from './text.js';
import { applyReview, assertAutomaticStatus } from './verification.js';

export interface ExternalMetadata {
  source: string;
  title?: string;
  authors?: Author[];
  year?: number;
  venue?: string;
  abstract?: string;
}

export interface BuildInput {
  projectId: string;
  now: string;
  files: Record<string, FileRecord>;
  /** Parsed .bib files (bibliography of the main document). */
  bib: { fileId: string; entries: BibEntry[] }[];
  /** Extracted text per PDF file id. Missing entries mean "not available". */
  texts: Record<string, PdfText>;
  decisions: UserDecisions;
  categoryRules: CategoryRule[];
  /** Opt-in external metadata keyed by normalized DOI. */
  externalMetadata?: Record<string, ExternalMetadata>;
}

export const MAIN_DOCUMENT_ID = 'doc:main';
export const edgeId = (kind: string, source: string, target: string) => `${kind}:${source}->${target}`;

type PubRecord = Omit<PublicationNode, 'label'> & { priority: number };

const MAX_CITATION_ANCHORS = 40;

function bibToRecord(entry: BibEntry, fileId: string): PubRecord {
  const f = entry.fields;
  const title = f.title ? decodeLatex(f.title) : undefined;
  const authors = parseAuthorList(f.author ?? f.editor);
  const y = parseYear(f.year ?? f.date);
  const doi = normalizeDoi(f.doi) ?? (f.url ? normalizeDoi(f.url) : undefined);
  const venueRaw = f.journal ?? f.journaltitle ?? f.booktitle ?? f.publisher ?? f.institution ?? f.school;
  const fields = Object.entries({ title, authors: authors.length ? 1 : undefined, year: y.year, doi, venue: venueRaw, abstract: f.abstract, url: f.url })
    .filter(([, v]) => v !== undefined)
    .map(([k]) => k);
  return {
    id: `pub:bib:${entry.key}`,
    kind: 'publication',
    title,
    authors,
    year: y.year,
    yearLabel: y.label,
    doi,
    venue: venueRaw ? decodeLatex(venueRaw) : undefined,
    abstract: f.abstract ? decodeLatex(f.abstract) : undefined,
    url: f.url,
    bibKeys: [entry.key],
    entryType: entry.type,
    fileIds: [],
    metadataSources: [{ kind: 'bibtex', ref: entry.key, fields }],
    inMainBibliography: true,
    priority: 0,
  };
}

const plausibleInfoTitle = (t: string | undefined) =>
  Boolean(t && t.trim().length >= 8 && !/\.(docx?|tex|pdf|indd)$/i.test(t.trim()) && !/^(untitled|microsoft word|title)/i.test(t.trim()));

/** Text of the first pages, stopping at the reference list (cited works must not identify the file). */
function firstPagesText(text: PdfText, n = 2) {
  const heading = findReferenceHeading(text);
  return text.pages
    .slice(0, n)
    .map((p) => {
      if (heading && p.page > heading.page) return '';
      const lines = heading && p.page === heading.page ? p.lines.slice(0, heading.line) : p.lines;
      return lines.map((l) => l.text).join('\n');
    })
    .join('\n');
}

function fileRecordToPub(file: FileRecord, text: PdfText | undefined): PubRecord {
  const sources: MetadataSource[] = [];
  let title: string | undefined;
  let doi: string | undefined;
  if (text && plausibleInfoTitle(text.info.title)) {
    title = text.info.title!.trim();
    sources.push({ kind: 'pdf_info', ref: file.id, fields: ['title'] });
  }
  if (text && text.pages[0]) {
    // Only a single DOI printed on page 1 is taken as the article's own DOI.
    const dois = findDois(firstPagesText(text, 1));
    if (dois.length === 1) {
      doi = dois[0];
      sources.push({ kind: 'pdf_text', ref: file.id, fields: ['doi'] });
    }
  }
  return {
    id: `pub:file:${file.id}`,
    kind: 'publication',
    title,
    authors: [],
    doi,
    bibKeys: [],
    fileIds: [file.id],
    metadataSources: sources,
    inMainBibliography: false,
    priority: 2,
  };
}

function mainRefToRecord(entry: ReferenceEntry, fileId: string): PubRecord {
  return {
    id: `pub:mainref:${entry.index}`,
    kind: 'publication',
    title: undefined,
    authors: [],
    year: entry.years[0],
    doi: entry.dois[0],
    bibKeys: [],
    fileIds: [],
    metadataSources: [{ kind: 'reference_list', ref: fileId, fields: ['doi', 'year'].filter((k) => (k === 'doi' ? entry.dois[0] : entry.years[0])) }],
    inMainBibliography: true,
    priority: 1,
  };
}

function mergeRecords(group: PubRecord[], external?: Record<string, ExternalMetadata>): PubRecord {
  const sorted = [...group].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const pick = <K extends keyof PubRecord>(k: K) => sorted.map((r) => r[k]).find((v) => v !== undefined && !(Array.isArray(v) && v.length === 0));
  const merged: PubRecord = {
    ...sorted[0],
    title: pick('title') as string | undefined,
    authors: (pick('authors') as Author[] | undefined) ?? [],
    year: pick('year') as number | undefined,
    yearLabel: pick('yearLabel') as string | undefined,
    doi: pick('doi') as string | undefined,
    venue: pick('venue') as string | undefined,
    abstract: pick('abstract') as string | undefined,
    url: pick('url') as string | undefined,
    entryType: pick('entryType') as string | undefined,
    bibKeys: [...new Set(sorted.flatMap((r) => r.bibKeys))],
    fileIds: [...new Set(sorted.flatMap((r) => r.fileIds))],
    metadataSources: sorted.flatMap((r) => r.metadataSources),
    inMainBibliography: sorted.some((r) => r.inMainBibliography),
  };
  const ext = merged.doi ? external?.[merged.doi] : undefined;
  if (ext) {
    const filled: string[] = [];
    if (!merged.title && ext.title) (merged.title = ext.title), filled.push('title');
    if (merged.authors.length === 0 && ext.authors?.length) (merged.authors = ext.authors), filled.push('authors');
    if (merged.year === undefined && ext.year !== undefined) (merged.year = ext.year), filled.push('year');
    if (!merged.venue && ext.venue) (merged.venue = ext.venue), filled.push('venue');
    if (!merged.abstract && ext.abstract) (merged.abstract = ext.abstract), filled.push('abstract');
    if (filled.length) merged.metadataSources.push({ kind: 'external_metadata', ref: ext.source, fields: filled });
  }
  return merged;
}

export function publicationLabel(p: Pick<PublicationNode, 'authors' | 'year' | 'yearLabel' | 'title'>, fallback: string): string {
  const first = p.authors[0];
  if (first) {
    const etal = p.authors.length > 2 ? ' et al.' : p.authors.length === 2 ? ` & ${p.authors[1].family}` : '';
    return `${first.family}${etal} (${p.yearLabel ?? p.year ?? 's.d.'})`;
  }
  if (p.title) return p.title.length > 60 ? p.title.slice(0, 57) + '…' : p.title;
  return fallback;
}

/** Links a reference PDF to a known bibliography record, or reports why it could not. */
function linkFile(file: FileRecord, text: PdfText | undefined, records: PubRecord[], manual: string | null | undefined): FileLink {
  if (manual !== undefined) {
    return manual === null
      ? { fileId: file.id, status: 'unmatched', method: 'manual' }
      : { fileId: file.id, publicationId: manual, status: 'manual', method: 'manual' };
  }
  if (!text) return { fileId: file.id, status: 'unmatched' };
  const head = firstPagesText(text);
  const dois = findDois(head);
  const byDoi = records.filter((r) => r.doi && dois.includes(r.doi));
  if (byDoi.length === 1) return { fileId: file.id, publicationId: byDoi[0].id, status: 'matched', method: 'pdf_doi' };
  const normHead = ` ${normalizeTitle(head)} `;
  const authorInHead = (r: PubRecord) => {
    const fam = r.authors[0] ? normalizeTitle(r.authors[0].family) : '';
    if (!fam) return false;
    if (normHead.includes(` ${fam} `)) return true;
    // Corporate authors ("CVAT.ai") are often printed without the suffix ("CVAT").
    const first = fam.split(' ')[0];
    return r.authors[0]?.organization === true && first.length >= 3 && normHead.includes(` ${first} `);
  };
  const byTitle = (byDoi.length > 1 ? byDoi : records).filter((r) => {
    const nt = normalizeTitle(r.title);
    const tokens = titleTokens(r.title).length;
    if (!nt || tokens < 2) return false;
    const inHead = normHead.includes(` ${nt} `) || (plausibleInfoTitle(text.info.title) && titleSimilarity(text.info.title, r.title) >= 0.95);
    // Short titles ("Deep learning") also need the first author on the first pages.
    return inHead && (tokens >= 4 || authorInHead(r));
  });
  if (byTitle.length === 1) return { fileId: file.id, publicationId: byTitle[0].id, status: 'matched', method: 'pdf_title' };
  if (byTitle.length > 1) {
    // Prefer candidates whose first author is printed, then the longest title.
    const ranked = [...byTitle].sort(
      (a, b) => Number(authorInHead(b)) - Number(authorInHead(a)) || normalizeTitle(b.title).length - normalizeTitle(a.title).length,
    );
    const top = ranked[0];
    const rivals = ranked.slice(1).filter((r) => authorInHead(r) === authorInHead(top) && !normalizeTitle(top.title).includes(normalizeTitle(r.title)));
    if (rivals.length === 0 && authorInHead(top)) return { fileId: file.id, publicationId: top.id, status: 'matched', method: 'pdf_title' };
    return { fileId: file.id, status: 'ambiguous', candidates: byTitle.map((r) => r.id) };
  }
  if (byDoi.length > 1) return { fileId: file.id, status: 'ambiguous', candidates: byDoi.map((r) => r.id) };
  return { fileId: file.id, status: 'unmatched' };
}

export function buildGraph(input: BuildInput): CitationGraph {
  const { files, texts, decisions } = input;
  const warnings: string[] = [];
  const fileList = Object.values(files).sort((a, b) => a.id.localeCompare(b.id));
  const mainFile = fileList.find((f) => f.role === 'main');
  const mainText = mainFile ? texts[mainFile.id] : undefined;

  // 1. Bibliography records of the main document.
  const records: PubRecord[] = [];
  const bibFileByKey = new Map<string, string>();
  for (const b of input.bib) {
    for (const e of b.entries) {
      records.push(bibToRecord(e, b.fileId));
      bibFileByKey.set(e.key, b.fileId);
    }
  }
  let mainRefEntries: ReferenceEntry[] = [];
  if (records.length === 0 && mainText) {
    mainRefEntries = extractReferenceEntries(mainText);
    for (const e of mainRefEntries) records.push(mainRefToRecord(e, mainFile!.id));
    if (mainRefEntries.length) warnings.push('No .bib provided: main-document references were taken from its PDF reference list (title/authors unavailable).');
  }

  // 2. Link reference PDFs to records.
  const fileLinks: FileLink[] = [];
  for (const file of fileList.filter((f) => f.role === 'reference')) {
    const text = texts[file.id];
    if (!text) warnings.push(`Text unavailable for "${file.originalName}" (${file.extraction.status}).`);
    const link = linkFile(file, text, records, decisions.fileLinks[file.id]);
    if (link.publicationId && !records.some((r) => r.id === link.publicationId) && !link.publicationId.startsWith('pub:file:')) {
      warnings.push(`Manual link of "${file.originalName}" points to an unknown publication; ignored.`);
      link.publicationId = undefined;
      link.status = 'unmatched';
    }
    fileLinks.push(link);
    const target = link.publicationId ? records.find((r) => r.id === link.publicationId) : undefined;
    if (target) target.fileIds.push(file.id);
    else if (link.status === 'unmatched') records.push(fileRecordToPub(file, text));
    else warnings.push(`"${file.originalName}" matches several bibliography entries; choose the right one.`);
  }

  // 3. Identity resolution.
  const idRecords: IdentityRecord[] = records.map((r) => ({ id: r.id, fields: { doi: r.doi, title: r.title, authors: r.authors, year: r.year } }));
  const resolution = resolveIdentities(idRecords, decisions.identity);
  const nodeIdOf = new Map<string, string>();
  const pubs: PublicationNode[] = [];
  for (const group of resolution.groups) {
    const merged = mergeRecords(group.map((id) => records.find((r) => r.id === id)!), input.externalMetadata);
    for (const id of group) nodeIdOf.set(id, merged.id);
    const { priority: _p, ...rest } = merged;
    const fallback = rest.fileIds[0] ? (files[rest.fileIds[0]]?.originalName ?? rest.id) : rest.id;
    pubs.push({ ...rest, label: publicationLabel(rest, fallback) });
  }
  for (const l of fileLinks) if (l.publicationId) l.publicationId = nodeIdOf.get(l.publicationId) ?? l.publicationId;
  for (const l of fileLinks) if (!l.publicationId && l.status === 'unmatched') l.publicationId = nodeIdOf.get(`pub:file:${l.fileId}`);
  const pubById = new Map(pubs.map((p) => [p.id, p]));

  // 4. Categories.
  for (const p of pubs) {
    const manual = decisions.categories[p.id];
    if (manual) p.category = { value: manual, source: 'user' };
    else if (manual === null) p.category = undefined;
    else p.category = suggestCategory(p, input.categoryRules);
  }

  const nodes: CitationGraph['nodes'] = {};
  for (const p of pubs) nodes[p.id] = p;
  const edges: Record<string, GraphEdge> = {};
  const addEdge = (kind: GraphEdge['kind'], source: string, target: string, status: VerificationStatus, prov: Provenance) => {
    assertAutomaticStatus(kind, prov.method, status);
    const id = edgeId(kind, source, target);
    const existing = edges[id];
    if (existing) {
      existing.provenance.push(prov);
      // A confirmed provenance upgrades an unverified edge; never the opposite.
      if (existing.status === 'unverified' && status === 'confirmed') existing.status = 'confirmed';
    } else edges[id] = { id, kind, source, target, status, provenance: [prov] };
  };

  // 5. Main document and its declared bibliography.
  const hasMainBib = pubs.some((p) => p.inMainBibliography);
  if (mainFile || hasMainBib) {
    const doc: DocumentNode = {
      id: MAIN_DOCUMENT_ID,
      kind: 'document',
      label: mainText?.info.title && plausibleInfoTitle(mainText.info.title) ? mainText.info.title : mainFile?.originalName ?? 'Documento principal',
      title: mainText?.info.title && plausibleInfoTitle(mainText.info.title) ? mainText.info.title : undefined,
      fileId: mainFile?.id,
    };
    nodes[doc.id] = doc;
    for (const r of records.filter((r) => r.inMainBibliography)) {
      const target = nodeIdOf.get(r.id)!;
      if (r.bibKeys.length) {
        addEdge('cites', doc.id, target, 'confirmed', {
          method: 'bibtex_declared',
          sourceNodeId: doc.id,
          sourceFileId: bibFileByKey.get(r.bibKeys[0]),
          bibliographicId: r.doi ?? r.bibKeys[0],
          notes: ['Declared in the bibliography (.bib) of the main document.'],
        });
      } else {
        const entry = mainRefEntries[Number(r.id.split(':').pop())];
        addEdge('cites', doc.id, target, 'confirmed', {
          method: 'reference_list_entry',
          sourceNodeId: doc.id,
          sourceFileId: mainFile!.id,
          bibliographicId: r.doi,
          referenceText: entry.text,
          referenceAnchor: { fileId: mainFile!.id, page: entry.page, text: entry.text.slice(0, 80), rects: entry.rects, pageSize: entry.pageSize },
        });
      }
    }
  }

  // 6. In-text citation markers of the main document.
  const citationIssues: CitationIssue[] = [];
  if (mainFile && mainText) {
    const bibPubs = pubs.filter((p) => p.inMainBibliography);
    const anchorsByPub = new Map<string, Anchor[]>();
    for (const m of extractCitationMarkers(mainText)) {
      const res = resolveMarker(m, bibPubs);
      if (res.status === 'resolved') {
        const list = anchorsByPub.get(res.publicationId) ?? [];
        if (!list.some((a) => a.page === m.page && a.text === m.raw)) list.push({ fileId: mainFile.id, page: m.page, text: m.raw, rects: m.rects, pageSize: m.pageSize });
        anchorsByPub.set(res.publicationId, list);
      } else {
        const id = `cit:${m.page}:${m.raw}:${m.authors[0]}:${m.yearLabel}`;
        if (!citationIssues.some((c) => c.id === id)) {
          citationIssues.push({ id, marker: m.raw, page: m.page, fileId: mainFile.id, status: res.status, candidates: res.candidates });
        }
      }
    }
    for (const p of bibPubs) {
      const anchors = anchorsByPub.get(p.id);
      const e = edges[edgeId('cites', MAIN_DOCUMENT_ID, p.id)];
      if (!e) continue;
      if (anchors?.length) {
        e.provenance.push({
          method: 'in_text_marker',
          sourceNodeId: MAIN_DOCUMENT_ID,
          sourceFileId: mainFile.id,
          citationAnchors: anchors.slice(0, MAX_CITATION_ANCHORS),
          notes: anchors.length > MAX_CITATION_ANCHORS ? [`${anchors.length} markers found; first ${MAX_CITATION_ANCHORS} kept.`] : undefined,
        });
      } else {
        e.provenance[0].notes = [...(e.provenance[0].notes ?? []), 'No in-text citation marker was found for this entry in the main PDF.'];
      }
    }
  }

  // 7. Bibliographies of the reference PDFs.
  const unresolvedReferences: UnresolvedReference[] = [];
  for (const link of fileLinks) {
    if (!link.publicationId) continue;
    const text = texts[link.fileId];
    if (!text) continue;
    const sourceId = link.publicationId;
    const entries = extractReferenceEntries(text);
    if (entries.length === 0) {
      warnings.push(`No reference list detected in "${files[link.fileId]?.originalName ?? link.fileId}".`);
      continue;
    }
    const others = pubs.filter((p) => p.id !== sourceId);
    for (const entry of entries) {
      const match = matchReference(entry, others);
      const anchor: Anchor = { fileId: link.fileId, page: entry.page, text: entry.text.slice(0, 80), rects: entry.rects, pageSize: entry.pageSize };
      if (match.status === 'confirmed' || match.status === 'weak') {
        const confirmed = match.status === 'confirmed';
        const method: DetectionMethod = confirmed
          ? match.byDoi
            ? 'reference_list_doi'
            : 'reference_list_title'
          : match.matchedBy.some((m) => m.includes('title'))
            ? 'reference_list_title'
            : 'reference_list_author_year';
        addEdge('cites', sourceId, match.publicationId, confirmed ? 'confirmed' : 'unverified', {
          method,
          sourceNodeId: sourceId,
          sourceFileId: link.fileId,
          bibliographicId: pubById.get(match.publicationId)?.doi,
          referenceText: entry.text,
          referenceAnchor: anchor,
          matchedBy: match.matchedBy,
          notes: confirmed ? undefined : ['Weak match: requires confirmation by the researcher.'],
        });
      } else {
        unresolvedReferences.push({
          sourceNodeId: sourceId,
          fileId: link.fileId,
          page: entry.page,
          text: entry.text,
          doi: entry.dois[0],
          candidates: match.status === 'ambiguous' ? match.candidates : [],
          reason: match.status === 'ambiguous' ? 'ambiguous' : 'no_match',
        });
      }
    }
  }

  // 8. Suggested thematic relations: bibliographic coupling (never a citation).
  const outgoing = new Map<string, Set<string>>();
  for (const e of Object.values(edges)) {
    if (e.kind !== 'cites' || e.status !== 'confirmed' || e.source === MAIN_DOCUMENT_ID) continue;
    if (!outgoing.has(e.source)) outgoing.set(e.source, new Set());
    outgoing.get(e.source)!.add(e.target);
  }
  const sources = [...outgoing.keys()].sort();
  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      const a = sources[i];
      const b = sources[j];
      if (edges[edgeId('cites', a, b)] || edges[edgeId('cites', b, a)]) continue;
      const shared = [...outgoing.get(a)!].filter((t) => outgoing.get(b)!.has(t));
      if (shared.length >= 2) {
        addEdge('related_to', a, b, 'suggested', {
          method: 'bibliographic_coupling',
          sourceNodeId: a,
          notes: [`Both cite ${shared.length} publications of the network. This is NOT a citation between them.`],
          text: shared.join(', '),
        });
      }
    }
  }

  // 9. Re-apply researcher reviews.
  for (const [id, reviews] of Object.entries(decisions.edgeReviews)) {
    const e = edges[id];
    if (!e) {
      warnings.push(`Review for edge ${id} no longer applies (edge not produced by this build).`);
      continue;
    }
    const original = e.status;
    let current = e;
    for (const r of reviews) {
      try {
        current = applyReview(current, r.action, r.at, r.note, original);
      } catch (err) {
        warnings.push(`Review ${r.action} on ${id} ignored: ${(err as Error).message}`);
      }
    }
    edges[id] = current;
  }

  // 10. Anchor integrity: drop rectangles that do not fit the page, flag invalid anchors.
  for (const e of Object.values(edges)) {
    for (const p of e.provenance) {
      const anchors = [p.referenceAnchor, ...(p.citationAnchors ?? []), p.evidenceAnchor].filter((a): a is Anchor => Boolean(a));
      for (const a of anchors) {
        const check = checkAnchor(a, files[a.fileId], texts[a.fileId]);
        if (!check.rectsValid && a.rects) delete a.rects;
        if (!check.valid) p.notes = [...(p.notes ?? []), `Anchor on page ${a.page} failed integrity check: ${check.problems.join(', ')}`];
      }
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    projectId: input.projectId,
    builtAt: input.now,
    nodes,
    edges,
    files,
    fileLinks,
    identityReviews: resolution.reviews,
    citationIssues,
    unresolvedReferences,
    warnings,
  };
}
