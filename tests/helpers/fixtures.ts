/**
 * Synthetic fixtures. Every author, title and DOI here is invented
 * (DOIs use the fictitious prefix 10.99999). No real document content.
 */
import { parseBibtex } from '../../src/core/bibtex';
import { emptyDecisions, type FileRecord, type UserDecisions } from '../../src/core/model';
import { buildGraph, type BuildInput } from '../../src/core/pipeline';
import type { PdfText, TextLine } from '../../src/core/text';

export const NOW = '2026-01-01T00:00:00.000Z';

/** Builds PdfText from plain lines (one array per page); rects are laid out top to bottom. */
export function pdfText(pages: string[][], info: PdfText['info'] = {}): PdfText {
  return {
    pageCount: pages.length,
    info,
    pages: pages.map((lines, i) => ({
      page: i + 1,
      width: 595,
      height: 842,
      lines: lines.map(
        (text, j): TextLine => ({
          text,
          rect: { x: text.startsWith('  ') ? 66 : 56, y: 60 + j * 14, w: Math.min(480, text.length * 5), h: 12 },
          fontSize: 10,
        }),
      ).map((l) => ({ ...l, text: l.text.trim() })),
    })),
  };
}

let fileCounter = 0;
export function fileRecord(role: FileRecord['role'], name: string, extra: Partial<FileRecord> = {}): FileRecord {
  fileCounter++;
  const id = `f_${fileCounter.toString(16).padStart(12, '0')}`;
  return {
    id,
    sha256: `sha-${id}`,
    originalName: name,
    role,
    visibility: 'private',
    storage: { kind: 'managed', relPath: `files/${id}.pdf` },
    addedAt: NOW,
    extraction: { status: 'ok' },
    ...extra,
  };
}

export const SYNTHETIC_BIB = String.raw`
% Synthetic bibliography for tests. All entries are invented.
@string{jsyn = "Journal of Synthetic Studies"}

@article{quintana2020,
  author = {Quintana, Aurelio and Brandt, Maja and Oyelaran, Tunde},
  title = {{Gradient Lattices for Tissue Boundary Estimation}},
  journal = jsyn,
  year = {2020},
  doi = {10.99999/synth.2020.001}
}

@article{albrecht2018,
  author = {Albrecht, Henrike and Moreau, Lucien},
  title = {A Benchmark of Imaginary Segmentation Networks},
  journal = {Synthetic Vision Letters},
  year = {2018},
  doi = {https://doi.org/10.99999/SYNTH.2018.042}
}

@inproceedings{nakamura2019,
  author = {Nakamura, Rei and S{\'a}nchez, Elo{\'i}sa},
  title = {Self-Calibrating Annotation Protocols for Fictional Wounds},
  booktitle = {Proceedings of the Imaginary Conference},
  year = {2019}
}

@book{orgdoc2021,
  author = {{Synthetic Standards Consortium}},
  title = {Guidelines for Invented Measurements},
  year = {2021}
}
`;

export function bibFixture(source = SYNTHETIC_BIB) {
  const file = fileRecord('bibtex', 'refs.bib', { storage: { kind: 'managed', relPath: 'files/refs.bib' } });
  return { file, entries: parseBibtex(source).entries };
}

/** First page of a synthetic article plus a bibliography on page 2. */
export function articleText(opts: { title: string; doi?: string; authorsLine: string; references: string[]; numbered?: boolean }): PdfText {
  const first = [opts.title, opts.authorsLine, ...(opts.doi ? [`https://doi.org/${opts.doi}`] : []), 'Abstract', 'This synthetic article exists only for tests.'];
  const refs = opts.references.flatMap((r, i) => {
    const label = opts.numbered ? `[${i + 1}] ` : '';
    // Split long references over two lines with a hanging indent.
    const full = label + r;
    if (full.length <= 90) return [full];
    const cut = full.lastIndexOf(' ', 90);
    return [full.slice(0, cut), '  ' + full.slice(cut + 1)];
  });
  return pdfText([first, ['References', ...refs]]);
}

export function build(partial: Partial<BuildInput> & Pick<BuildInput, 'files'>, decisions: Partial<UserDecisions> = {}) {
  return buildGraph({
    projectId: 'test',
    now: NOW,
    bib: [],
    texts: {},
    categoryRules: [],
    ...partial,
    decisions: { ...emptyDecisions(), ...decisions },
  });
}
