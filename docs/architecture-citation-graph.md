# Citation Graph: architecture (Phase 1)

## Starting point and stack choice

The repository had only a `README.md` when this work started. There were no upload, extraction, citation or PDF-viewer components to reuse, so I picked the smallest stack that covers the requirements and works fully offline:

| Concern | Choice | Why |
| --- | --- | --- |
| Language | TypeScript (strict), one package | The same types (`src/core/model.ts`) are shared by the pipeline, the API and the UI, so there is no schema drift. |
| Backend | Node ≥ 20 + Express 5 + Multer | Small and well known. Binds to `127.0.0.1` by default. |
| PDF text and coordinates | `pdfjs-dist` (in Node) | Runs locally with no service. It returns text items with positions, so anchors carry *real* rectangles. The same library powers the viewer, so coordinates match. |
| Bibliography parsing | Custom BibTeX parser + heuristic reference-list splitter | No GROBID/Java service needed (spec: "do not introduce unnecessary services"). The `references.ts` extractor can later be swapped for GROBID without touching matching or graph code. |
| Persistence | JSON files per project (atomic writes) | Hundreds of nodes fit easily. The files are transparent and diffable, have no native deps, and are easy to delete (privacy). The text cache is keyed per file, so PDFs are never re-parsed. |
| Graph UI | React 19 + React Flow (`@xyflow/react`) + ELK.js (layered, left→right) | Suggested by the spec and suited to directed bibliometric layouts. |
| Viewer | pdf.js canvas + highlight overlay | No suitable viewer existed. Works offline, and the worker is bundled. |
| Export | `html-to-image` (SVG/PNG) and a custom GraphML writer | GraphML is always redacted for sharing. |
| Tests | Vitest, synthetic fixtures only | PDFs are generated on the fly (`src/server/devtools/syntheticPdf.ts`). |

External metadata (OpenAlex) is **opt-in twice**. The server must be started with `CITATION_GRAPH_EXTERNAL_METADATA=on`, and each request must carry explicit consent. Only DOIs are sent.

## Modules

```
src/core/          pure, framework-free, unit-tested
  model.ts         node/edge kinds, statuses, provenance, decisions (Phase-2 ready)
  normalize.ts     DOI/title/author normalization, LaTeX decoding, similarity
  bibtex.ts        BibTeX/BibLaTeX parser
  identity.ts      deduplication: DOI > title+first author+year; ambiguity → review
  references.ts    reference-list detection/splitting + entry↔publication matching
  citations.ts     in-text markers (author-year, ABNT, narrative) + resolution
  anchors.ts       page/anchor integrity, viewer targets (never invents coordinates)
  verification.ts  status state machine; automatic methods cannot validate
  categories.ts    keyword-rule category suggestions (user-correctable)
  pipeline.ts      deterministic graph builder (inputs + decisions → CitationGraph)
  view.ts          filters, search, group collapse, centrality (for the UI)
  export.ts        redaction for sharing, GraphML
src/server/
  pdfText.ts       pdf.js extraction → lines with rects
  store.ts         per-project storage, file registry, text cache, rebuilds
  app.ts           HTTP API
  metadata.ts      opt-in OpenAlex lookup by DOI
  cli.ts           ingestion by path (no copying of private PDFs)
  devtools/        synthetic PDF writer, demo seed
src/web/           React UI (graph, filters, side panel, PDF viewer, files/review)
```

## Processing pipeline

1. **Bibliography of the main document.** Read from the `.bib` (method `bibtex_declared`). If no `.bib` is given, entries come from the main PDF's reference list (`reference_list_entry`). In that case titles and authors stay *unavailable* instead of being guessed.
2. **Link reference PDFs to entries.** A file is linked by a DOI printed before its reference list, or by its normalized title on the first pages. Short titles also need the first author. If more than one entry matches, the link is marked *ambiguous* and the researcher picks. A PDF that matches nothing becomes its own node, using only metadata found in the file (PDF info title, a single DOI on page 1).
3. **Identity resolution.** Records are compared pairwise. Equal DOIs mean the same work. Without DOIs, the normalized title (case, accents, punctuation, abbreviations) must match together with the first author and year. Same first author + year alone is never enough. Ambiguous pairs become `identityReviews`, and decisions persist.
4. **In-text markers** in the main PDF, such as `(Silva et al., 2025)`, `(SILVA; SOUZA, 2020)` or `Quintana et al. (2020)`. A marker resolves only to a *unique* entry. Ambiguous or unknown markers are listed as `citationIssues`. Resolved markers add page anchors to the document → publication edge.
5. **Bibliographies of the reference PDFs.** Each entry is matched against the network:
   - DOI, or full title + compatible author/year → `cites` **confirmed**, with the entry text, physical page and line rectangles.
   - Weak evidence (partial title, author + year only) → `cites` **unverified**, waiting for review.
   - Several candidates or no match → `unresolvedReferences`. No edge is created.
6. **Suggestions.** Bibliographic coupling (sharing ≥ 2 confirmed references) produces `related_to` edges with status `suggested`. They are hidden by default and are never a citation. Categories come from keyword rules (`suggested`) or the user (`user`). Colors are presentation only.
7. **Researcher decisions** (identity, file links, categories, edge reviews) are stored in `decisions.json` and re-applied on every rebuild.
8. **Integrity pass.** Every anchor is checked: the page must exist, the text must appear on that page, and the rectangles must lie inside the page. Invalid rectangles are dropped and a note is added.

## Data model (summary)

- **Nodes**: `document`, `publication`, `claim`, `evidence`. Phase 1 fills the first two.
- **Edges**: `cites`, `contains_claim`, `references`, `has_evidence`, `supports`, `contradicts`, `related_to`.
- **Statuses**: `confirmed`, `unverified`, `suggested`, `candidate`, `validated`, `inconclusive`, `potential_contradiction`, `rejected`.
  - `verification.ts` enforces which statuses automatic methods may set. For example, `semantic_similarity` can only create `candidate`.
  - Only a human review reaches `validated`, `inconclusive` or `rejected`.
- **Provenance** (per edge, possibly several records):
  - detection method;
  - source node and file;
  - bibliographic id (DOI or BibTeX key);
  - reference text and reference anchor;
  - citation anchors;
  - evidence anchor;
  - text;
  - matched fields;
  - confidence (only when a model produced it);
  - notes.
- **Anchor**: `{fileId, page (1-based physical PDF page), text?, rects? (from extractor), pageSize?}`. Journal page numbers are never used as PDF pages.

## Privacy

- Files are `private` by default. Shared exports (`/export/json`, GraphML) strip text derived from private files, file names and storage paths.
- Files registered by path (CLI) are never copied, modified or deleted. Removing them only drops derived data.
- Deleting a file or project removes stored copies, text caches and decisions about that file.
- No document content is sent anywhere. The only network call in the codebase is the opt-in OpenAlex lookup by DOI.
- PDFs are served only by the local API, with `Cache-Control: no-store`.

## Phase 2 hooks

- `ClaimNode` and `EvidenceNode`, the edge kinds `contains_claim`, `references`, `has_evidence`, `supports` and `contradicts`, and the review transitions for them already exist and are covered by tests.
- The main document's in-text citation anchors (page + line rectangles + marker text) are already collected. They are the natural seeds for claim extraction: the sentence around each marker.
- Mode B in the UI is wired to these node and edge kinds. It shows an explanatory empty state until Phase 2 produces data.
