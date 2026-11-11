# Fontexto

Fontexto lets researchers upload an academic document (TCC, dissertation, article) together with its `.bib` and the PDFs of its references. It then lets them navigate citations down to the exact place in the original sources.

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

## Windows executable

```bash
npm run package:win
```

This writes a portable folder to `dist/win/Fontexto/`:

- `Fontexto.exe` — double-click to start the local server and open the UI in your default browser
- `resources/` — the web UI and pdf.js assets (keep this folder next to the exe)

No Node.js install is required at runtime. The server always binds to `127.0.0.1`, uses port `5174` when it is free, and otherwise picks the next free port. Project data is stored in `%APPDATA%\CitationTrace` (the folder keeps the product's former name so existing projects stay in place).

To start the server without opening a browser (for example in a script):

```bash
Fontexto.exe --no-browser
```

The same thing can be done with the environment variable `CITATION_GRAPH_NO_BROWSER=1`. The last bound URL is written to `%APPDATA%\CitationTrace\last-url.txt`.

The executable is unsigned, so Windows SmartScreen may show a warning on first launch.

## Document view (tab C · Documento)

Upload the main PDF, the `.bib` and, optionally, the reference PDFs ("Arquivos e revisão"). Tab **C · Documento** renders the main PDF page by page and highlights every in-text citation (author–year). Clicking one shows, in the side panel, the cited publication(s), the citing sentence, and the passages found in the reference PDF (page, similarity, text), with a button that opens the reference PDF on that page with the passage highlighted. Filters: status, reference, free text. From the graph, a publication or a "cites" edge has a "Ver N citação(ões) no documento" button.

How the labels are computed (`src/core/evidence.ts`): the citing sentence (markers removed) is segmented from the main PDF; every sentence of the reference PDF (bibliography excluded) is scored by IDF-weighted overlap of content terms (numbers, acronyms, 5-letter stems, PT↔EN glossary). The best passages are shown with one of:

- **Localizado**: a passage shares most of the sentence's rare terms;
- **Ressalva**: weaker overlap, a number of the sentence missing from the passage, or only the abstract matches;
- **Não localizado**: no similar passage, no reference PDF, no extractable text, or a sentence with too little content.

These labels are *candidates for human review*, not proof that the reference supports the claim. Everything runs locally; the shared export (`/export/evidence`) removes text taken from private files. Results are stored in `evidence.json` per project and recomputed whenever files are added/removed or the project is rebuilt.

## Web edition (fontexto.com, client-side)

`npm run build:site` builds a static site (`dist/site`) with **no server**: the PDF parsing (pdf.js), reference extraction,
linking and matching run in Web Workers (`src/web/local/`, on top of the platform-neutral `src/core/coreStore.ts`) and the
projects live in the browser's IndexedDB. Nothing is uploaded. The Windows executable is the offline edition and shares
`src/core`.

- Optional "busca semântica" (re-rank by a multilingual sentence-embedding model, ~135 MB, downloaded once and cached) needs
  the model files: `npm run fetch-model` (SHA-256 pinned) before `npm run build:site`. Without them the site builds without
  that option.
- Cloudflare Pages: `npx wrangler pages deploy dist/site --project-name fontexto --branch <branch>`. The `_headers` file
  (strict CSP + Trusted Types, COOP/COEP/CORP, HSTS) is generated from `src/server/securityHeaders.ts`.
- Check a deployment end to end in headless Chrome: `scripts/e2e/web-flow.mjs` (see its header for the variables).
- How the automatic matcher is measured and its limits: `docs/matcher-evaluation.md`.
