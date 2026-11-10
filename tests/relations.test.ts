import { describe, expect, it } from 'vitest';
import type { PublicationNode } from '../src/core/model';
import { parseAuthor } from '../src/core/normalize';
import { extractReferenceEntries, matchReference } from '../src/core/references';
import { flowText, makePdf } from '../src/server/devtools/syntheticPdf';
import { extractPdfText } from '../src/server/pdfText';
import { articleText, bibFixture, build, fileRecord } from './helpers/fixtures';

const pub = (id: string, title: string, authors: string[], year: number, doi?: string): PublicationNode => ({
  id,
  kind: 'publication',
  label: id,
  title,
  authors: authors.map(parseAuthor),
  year,
  doi,
  bibKeys: [],
  fileIds: [],
  metadataSources: [],
  inMainBibliography: true,
});

describe('reference list extraction', () => {
  it('splits numbered bibliographies and keeps page + extractor rects', () => {
    const t = articleText({
      title: 'X',
      authorsLine: 'Y',
      numbered: true,
      references: [
        'Albrecht H, Moreau L. A benchmark of imaginary segmentation networks. Synth Vis Lett. 2018. doi:10.99999/synth.2018.042',
        'Quintana A, Brandt M, Oyelaran T. Gradient lattices for tissue boundary estimation. J Synth Stud. 2020.',
      ],
    });
    const entries = extractReferenceEntries(t);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ page: 2, label: '[1]', dois: ['10.99999/synth.2018.042'] });
    expect(entries[0].rects.length).toBeGreaterThan(0);
    expect(entries[1].years).toContain(2020);
  });

  it('splits author-year bibliographies using hanging indents', () => {
    const t = articleText({
      title: 'X',
      authorsLine: 'Y',
      references: [
        'Albrecht, H., Moreau, L. (2018). A benchmark of imaginary segmentation networks. Synthetic Vision Letters 3, 1-9.',
        'Quintana, A., Brandt, M., Oyelaran, T. (2020). Gradient lattices for tissue boundary estimation. Journal of Synthetic Studies.',
      ],
    });
    const entries = extractReferenceEntries(t);
    expect(entries.map((e) => e.text.slice(0, 9))).toEqual(['Albrecht,', 'Quintana,']);
  });

  it('returns nothing when there is no reference heading (no invented entries)', () => {
    expect(extractReferenceEntries(articleText({ title: 'X', authorsLine: 'Y', references: [] }))).toEqual([]);
  });
});

describe('reference matching', () => {
  const pubs = [
    pub('q', 'Gradient Lattices for Tissue Boundary Estimation', ['Quintana, Aurelio'], 2020, '10.99999/q'),
    pub('d', 'Deep lattices', ['Okafor, Chidi'], 2015),
  ];

  it('confirms by DOI', () => {
    expect(matchReference({ text: 'whatever 10.99999/Q', dois: ['10.99999/q'], years: [] }, pubs)).toMatchObject({ status: 'confirmed', byDoi: true });
  });

  it('confirms by normalized title + first author + year', () => {
    const m = matchReference({ text: 'Quintana A, et al. GRADIENT LATTICES FOR TISSUE BOUNDARY ESTIMATION. 2020.', dois: [], years: [2020] }, pubs);
    expect(m).toMatchObject({ status: 'confirmed', publicationId: 'q' });
  });

  it('does not match a short title that only appears inside another work by other authors', () => {
    const m = matchReference({ text: 'Lindqvist P. A survey of deep lattices in imaging. 2019.', dois: [], years: [2019] }, pubs);
    expect(m.status).toBe('none');
  });

  it('first author + year with an unknown title is only a weak (unverified) hint', () => {
    const noTitle = [{ ...pubs[0], title: undefined }];
    expect(matchReference({ text: 'Quintana A. Some other paper. 2020.', dois: [], years: [2020] }, noTitle)).toMatchObject({ status: 'weak' });
  });

  it('a co-author name is not treated as first author', () => {
    const m = matchReference({ text: 'Brandt M, Quintana A. Unrelated synthetic report. 2020.', dois: [], years: [2020] }, pubs);
    expect(m.status).toBe('none');
  });
});

describe('graph construction (relation extraction)', () => {
  it('creates confirmed cites edges with provenance and keeps unmatched references out of the graph', () => {
    const bib = bibFixture();
    const pdfA = fileRecord('reference', 'quintana.pdf');
    const textA = articleText({
      title: 'Gradient Lattices for Tissue Boundary Estimation',
      authorsLine: 'Aurelio Quintana, Maja Brandt, Tunde Oyelaran',
      doi: '10.99999/synth.2020.001',
      numbered: true,
      references: [
        'H. Albrecht and L. Moreau, A benchmark of imaginary segmentation networks, Synth. Vis. Lett., 2018.',
        'Z. Outsider, A paper that is not part of the project, 2017.',
      ],
    });
    const g = build({
      files: { [bib.file.id]: bib.file, [pdfA.id]: pdfA },
      bib: [{ fileId: bib.file.id, entries: bib.entries }],
      texts: { [pdfA.id]: textA },
    });
    const e = g.edges['cites:pub:bib:quintana2020->pub:bib:albrecht2018'];
    expect(e.status).toBe('confirmed');
    expect(e.provenance[0]).toMatchObject({ method: 'reference_list_title', sourceFileId: pdfA.id, sourceNodeId: 'pub:bib:quintana2020' });
    expect(e.provenance[0].referenceAnchor).toMatchObject({ fileId: pdfA.id, page: 2 });
    expect(e.provenance[0].referenceText).toMatch(/benchmark of imaginary/);
    // The outsider reference is recorded, not turned into a node or edge.
    expect(g.unresolvedReferences).toHaveLength(1);
    expect(Object.values(g.nodes).filter((n) => n.kind === 'publication')).toHaveLength(4);
    // Main document edges come from the declared bibliography.
    expect(g.edges['cites:doc:main->pub:bib:quintana2020'].provenance[0].method).toBe('bibtex_declared');
  });

  it('works end-to-end from a generated PDF through pdf.js extraction', async () => {
    const pages = flowText([
      { text: 'Gradient Lattices for Tissue Boundary Estimation', size: 16 },
      { text: 'Aurelio Quintana, Maja Brandt, Tunde Oyelaran', gapBefore: 6 },
      { text: 'doi: 10.99999/synth.2020.001' },
      { text: 'Body text of a synthetic article. '.repeat(20), gapBefore: 10 },
      { text: 'References', size: 12, gapBefore: 14 },
      { text: '[1] Albrecht H, Moreau L. A benchmark of imaginary segmentation networks. Synth Vis Lett. 2018. doi:10.99999/synth.2018.042', gapBefore: 4 },
      { text: '[2] Nakamura R, Sanchez E. Self-calibrating annotation protocols for fictional wounds. In: Proc Imaginary Conf. 2019.', gapBefore: 4 },
    ]);
    const text = await extractPdfText(makePdf(pages, { title: 'Gradient Lattices for Tissue Boundary Estimation' }));
    const bib = bibFixture();
    const pdf = fileRecord('reference', 'q.pdf', { pageCount: text.pageCount });
    const g = build({ files: { [bib.file.id]: bib.file, [pdf.id]: pdf }, bib: [{ fileId: bib.file.id, entries: bib.entries }], texts: { [pdf.id]: text } });
    expect(g.fileLinks[0]).toMatchObject({ publicationId: 'pub:bib:quintana2020', method: 'pdf_doi' });
    expect(g.edges['cites:pub:bib:quintana2020->pub:bib:albrecht2018']).toMatchObject({ status: 'confirmed' });
    expect(g.edges['cites:pub:bib:quintana2020->pub:bib:albrecht2018'].provenance[0].method).toBe('reference_list_doi');
    expect(g.edges['cites:pub:bib:quintana2020->pub:bib:nakamura2019']).toMatchObject({ status: 'confirmed' });
    const anchor = g.edges['cites:pub:bib:quintana2020->pub:bib:albrecht2018'].provenance[0].referenceAnchor!;
    expect(anchor.rects!.length).toBeGreaterThan(0);
  });
});
