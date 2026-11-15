# Evaluating the automatic passage finder

Fontexto links each citation in a document to passages in the PDF of the cited reference **without manual curation**.
This page explains how that is measured, the current numbers and their limits.

## Gold set

The evaluation uses a private project with a manual review (curated evidence imported from an exported `index.html`):
for each citation occurrence, a verdict (Located / Caveat / Not located) and the pages of the chosen passages. The gold
project is not part of this repository. `scripts/eval/gold.mts` loads it and pairs it with the project's occurrences (by
key, then by author + year, and finally by sentence similarity).

- 187 resolved occurrences. Self-citations used as table sources ("Author (2026)") are left out; see `isSelfCitation`.
- Per-occurrence metrics: whether the right page of the reference PDF is among the first **1** / **3** passages, and
  agreement of the status with the curation (3 classes), with precision/recall of the "Located" label.

Both flows (with a `.bib` and without one) give identical numbers: citation → reference linking is right for 31/31
references in both, so any difference comes from linking, not from the passage search.

## Results (187 occurrences)

| Finder | right page top-1 | top-3 | status (3 classes) | Located: precision | Located: recall |
|---|---|---|---|---|---|
| v1 (before) | 33.9% | 59.6% | 34.8% | 0.91 | 0.30 |
| v2 lexical (default) | 42.1% | 68.3% | 69.0% | 0.91 | 0.71 |
| v2 + semantic model (optional, web only) | 47.0% | 72.1% | 65.2% | 0.91 | 0.67 |

Reproduce with your own curated project: `DATA_DIR=<data> PROJECT=<id> npx tsx scripts/eval/final.mts [lex|sem|all]`.

## What changed in v2

1. **Three-layer claim**: the clause around the marker (weight 1.0), the citing sentence (0.7) and the neighbouring
   sentences (0.3). Self-citations and names from the document itself are removed from the claim.
2. **PT→EN**: a glossary of technical terms (weight 0.9) and cognate normalisation (`segmentação` ≈ `segmentation`,
   double letters, ph→f, y→i, -ção→-tion…), 5-letter stems. Numbers and acronyms weigh ×2.
3. **Passage windows** of 1–3 sentences scored with BM25 (k1 1.2; b 0.5), with fuzzy matching (edit distance 1).
4. **Optional semantic re-ranking** (`paraphrase-multilingual-MiniLM-L12-v2`, 8-bit ONNX, ~135 MB, runs in the browser
   through onnxruntime-web, self-hosted). The final score blends the lexical score and the cosine similarity.
5. **Label by absolute score** (thresholds in `evidence.ts`: `v2 {strong, weak, strongSem, weakSem}`); missing numbers
   and the "abstract" region only add notes.

## Calibration and limits (read before trusting the numbers)

- Thresholds were picked on the precision × recall curve of "Located". A 2-fold split (hash of the BibTeX key,
  `scripts/eval/calib*.mts`) was used to check for overfitting; with only 187 occurrences from a single document the
  per-fold estimates are noisy, so the numbers above are for the whole set.
- The lexical score **does not predict well** whether the *page* is right (AUC ≈ 0.5): optimising status agreement
  degenerates into "everything Located". That is why "Located" means "there is a passage about the same terms", never
  "the source proves the claim". Every passage is a candidate and needs human review.
- The per-page gold is noisy: one sentence often carries several claims and several acceptable pages.
- The set is a single document (PT→EN). Numbers may be worse in other fields and language pairs.
- The automatic finder does **not** reach the level of manual curation. The goal is to show the right passage among the
  first 3 options in about 2/3 of the cases and to make the rest clearly "Caveat" / "Not located".
