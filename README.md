# citation-tracer

CitationTrace lets researchers upload an academic document (TCC, dissertation, article) together with its `.bib` and the PDFs of its references. It then lets them navigate citations down to the exact place in the original sources.

This branch adds the **Citation Graph**, Phase 1 (bibliographic graph). The graph is interactive and directed: confirmed citations are kept apart from suggestions, every edge records its provenance, and clicking through opens the PDF at the right page. Everything runs locally and offline.

See [`docs/architecture-citation-graph.md`](docs/architecture-citation-graph.md) for the design.

## Requirements

- Node.js ≥ 20.10 (tested with Node 24)

## Running

```bash
npm install
npm run demo:seed        # optional: creates a fully synthetic demo project in ./data
npm run dev              # API on 127.0.0.1:5174 + UI on http://127.0.0.1:5173
```

Production build:

```bash
npm run build            # typecheck + web bundle + server
npm start                # serves API and UI on http://127.0.0.1:5174
```

### Ingesting local files without uploading/copying them

```bash
npm run ingest -- --project my-tcc --name "My TCC" \
  --bib path/to/refs.bib --main path/to/tcc.pdf --refs "path/to/articles-folder" \
  [--exclude some-substring ...] [--shareable]
```

- Files are registered **by path**. They are never copied or modified, and removing them from a project never deletes the originals.
- Extracted text is cached in `data/projects/<id>/derived/`.

### Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `CITATION_GRAPH_PORT` | `5174` | API port |
| `CITATION_GRAPH_HOST` | `127.0.0.1` | bind address |
| `CITATION_GRAPH_DATA_DIR` | `./data` | project storage (git-ignored) |
| `CITATION_GRAPH_EXTERNAL_METADATA` | off | `on` allows opt-in OpenAlex lookups. Only DOIs are sent, and each request needs explicit consent. |

## Tests

```bash
npm test
```

- All fixtures are synthetic: invented works with DOIs under the fictitious prefix `10.99999`, and PDFs generated during the test run.
- An optional smoke test runs against your own local data when `SMOKE_BIB`, `SMOKE_MAIN` and `SMOKE_REFS` are set. It is skipped otherwise.

## Scientific-integrity rules

- No bibliographic data, page or coordinate is invented. Unknown values are shown as **Indisponível**.
- `confirmed` means the reference was located in the documents (DOI or title match in a bibliography, or the main document's declared `.bib`).
- Weak matches are `unverified` until a researcher confirms them.
- Thematic relations (`related_to`) are `suggested` only and never imply a citation.
- Colors and categories are presentation only.
- Automatic methods can never mark evidence as `validated`.
