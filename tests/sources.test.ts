/** Missing PDFs and sources without DOI. */
import { describe, expect, it } from 'vitest';
import { viewerTarget } from '../src/core/anchors';
import { buildView, DEFAULT_FILTERS } from '../src/core/view';
import { articleText, bibFixture, build, fileRecord } from './helpers/fixtures';

describe('missing PDFs', () => {
  it('publications without PDF are kept, flagged, and get no invented outgoing citations', () => {
    const bib = bibFixture();
    const g = build({ files: { [bib.file.id]: bib.file }, bib: [{ fileId: bib.file.id, entries: bib.entries }] });
    const pubs = Object.values(g.nodes).filter((n) => n.kind === 'publication');
    expect(pubs).toHaveLength(4);
    expect(pubs.every((p) => p.kind === 'publication' && p.fileIds.length === 0)).toBe(true);
    // Only the declared main-document edges exist; nothing between publications.
    expect(Object.values(g.edges).every((e) => e.source === 'doc:main')).toBe(true);
    const view = buildView(g, DEFAULT_FILTERS);
    expect(view.nodes.filter((n) => n.kind === 'publication').every((n) => !n.hasPdf)).toBe(true);
  });

  it('the viewer refuses to open a missing PDF instead of guessing', () => {
    expect(viewerTarget({ fileId: 'f_000000000000', page: 3 }, undefined)).toMatchObject({ ok: false, reason: 'missing_pdf' });
  });

  it('a PDF whose text could not be extracted produces a warning, not edges', () => {
    const bib = bibFixture();
    const broken = fileRecord('reference', 'scan.pdf', { extraction: { status: 'no_text', error: 'scanned' } });
    const g = build({ files: { [bib.file.id]: bib.file, [broken.id]: broken }, bib: [{ fileId: bib.file.id, entries: bib.entries }] });
    expect(g.warnings.join(' ')).toMatch(/Text unavailable for "scan.pdf"/);
    expect(g.fileLinks[0].status).toBe('unmatched');
    expect(Object.values(g.edges).filter((e) => e.source !== 'doc:main')).toHaveLength(0);
  });

  it('an unmatched PDF becomes its own node using only metadata found in the file', () => {
    const pdf = fileRecord('reference', 'mystery.pdf');
    const text = articleText({ title: 'Unlisted Synthetic Study', authorsLine: 'Somebody', references: [] });
    const g = build({ files: { [pdf.id]: pdf }, texts: { [pdf.id]: { ...text, info: {} } } });
    const n = g.nodes[`pub:file:${pdf.id}`];
    expect(n.kind).toBe('publication');
    if (n.kind !== 'publication') return;
    expect(n.title).toBeUndefined(); // no PDF-info title: not guessed from text
    expect(n.doi).toBeUndefined();
    expect(n.authors).toEqual([]);
    expect(n.label).toBe('mystery.pdf');
  });
});

describe('sources without DOI', () => {
  it('links PDFs and builds confirmed relations by title/author/year without inventing DOIs', () => {
    const bib = bibFixture(String.raw`
      @inproceedings{nakamura2019, author={Nakamura, Rei and S{\'a}nchez, Elo{\'i}sa}, title={Self-Calibrating Annotation Protocols for Fictional Wounds}, year={2019}}
      @book{orgdoc2021, author={{Synthetic Standards Consortium}}, title={Guidelines for Invented Measurements}, year={2021}}`);
    const pdf = fileRecord('reference', 'nakamura.pdf');
    const text = articleText({
      title: 'Self-Calibrating Annotation Protocols for Fictional Wounds',
      authorsLine: 'Rei Nakamura, Eloisa Sanchez',
      references: ['Synthetic Standards Consortium (2021). Guidelines for invented measurements. Imaginary Press.'],
    });
    const g = build({ files: { [bib.file.id]: bib.file, [pdf.id]: pdf }, bib: [{ fileId: bib.file.id, entries: bib.entries }], texts: { [pdf.id]: text } });
    expect(g.fileLinks[0]).toMatchObject({ status: 'matched', method: 'pdf_title', publicationId: 'pub:bib:nakamura2019' });
    const e = g.edges['cites:pub:bib:nakamura2019->pub:bib:orgdoc2021'];
    expect(e.status).toBe('confirmed');
    expect(e.provenance[0].matchedBy).toEqual(expect.arrayContaining(['title', 'first_author', 'year']));
    for (const n of Object.values(g.nodes)) if (n.kind === 'publication') expect(n.doi).toBeUndefined();
  });
});
