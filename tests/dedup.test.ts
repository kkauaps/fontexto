import { describe, expect, it } from 'vitest';
import { compareIdentity, identityReviewId, resolveIdentities } from '../src/core/identity';
import { parseAuthor } from '../src/core/normalize';
import { bibFixture, build, fileRecord, pdfText } from './helpers/fixtures';

const A = (...names: string[]) => names.map(parseAuthor);

describe('bibliographic deduplication', () => {
  it('merges records with the same DOI regardless of DOI formatting', () => {
    const r = compareIdentity(
      { doi: 'https://doi.org/10.99999/SYNTH.1', title: 'Totally different title', authors: [], year: 2020 },
      { doi: '10.99999/synth.1', title: 'Gradient lattices', authors: [] },
    );
    expect(r.verdict).toBe('same');
    expect(r.reasons).toEqual(['doi']);
  });

  it('treats capitalization, accents, punctuation and abbreviations as equal', () => {
    const r = compareIdentity(
      { title: 'Análise de Feridas: Um Estudo Sintético', authors: A('Sánchez, Eloísa'), year: 2019 },
      { title: 'ANALISE DE FERIDAS - um estudo sintetico', authors: A('Eloisa Sanchez'), year: 2019 },
    );
    expect(r.verdict).toBe('same');
  });

  it('does NOT merge works that only share first author and year', () => {
    const r = compareIdentity(
      { title: 'Gradient Lattices for Tissue Boundary Estimation', authors: A('Quintana, A.'), year: 2020 },
      { title: 'A Survey of Fictional Annotation Tools', authors: A('Quintana, A.'), year: 2020 },
    );
    expect(r.verdict).toBe('distinct');
    expect(r.reasons).toContain('same_first_author_and_year_not_sufficient');
  });

  it('flags same author + year without titles as ambiguous (needs the researcher)', () => {
    expect(compareIdentity({ authors: A('Quintana, A.'), year: 2020 }, { authors: A('Quintana, A.'), year: 2020 }).verdict).toBe('ambiguous');
  });

  it('flags different DOIs with identical titles (preprint vs. published) as ambiguous', () => {
    const r = compareIdentity(
      { doi: '10.99999/preprint.1', title: 'Gradient Lattices', authors: A('Quintana, A.'), year: 2019 },
      { doi: '10.99999/journal.1', title: 'Gradient Lattices', authors: A('Quintana, A.'), year: 2020 },
    );
    expect(r.verdict).toBe('ambiguous');
  });

  it('flags similar titles with one-year difference as ambiguous', () => {
    const r = compareIdentity(
      { title: 'Gradient Lattices for Tissue Boundary Estimation', authors: A('Quintana, A.'), year: 2020 },
      { title: 'Gradient Lattices for Tissue Boundary Estimation', authors: A('Quintana, A.'), year: 2021 },
    );
    expect(r.verdict).toBe('ambiguous');
  });

  it('resolves groups and applies researcher decisions', () => {
    const recs = [
      { id: 'a', fields: { doi: '10.99999/x', authors: [], title: 'X' } },
      { id: 'b', fields: { doi: '10.99999/X', authors: [], title: 'Y' } },
      { id: 'c', fields: { authors: A('Quintana, A.'), year: 2020 } },
      { id: 'd', fields: { authors: A('Quintana, A.'), year: 2020 } },
    ];
    const r1 = resolveIdentities(recs);
    expect(r1.groups).toContainEqual(['a', 'b']);
    expect(r1.reviews.map((r) => r.id)).toEqual([identityReviewId('c', 'd')]);
    const r2 = resolveIdentities(recs, { [identityReviewId('c', 'd')]: 'same' });
    expect(r2.groups).toContainEqual(['c', 'd']);
    const r3 = resolveIdentities(recs, { [identityReviewId('c', 'd')]: 'distinct' });
    expect(r3.groups).toContainEqual(['c']);
    expect(r3.reviews[0].decision).toBe('distinct');
  });

  it('deduplicates in the pipeline: duplicated .bib entry with DOI variant becomes one node', () => {
    const bib = bibFixture(
      String.raw`@article{a1, author={Quintana, Aurelio}, title={Gradient Lattices}, year={2020}, doi={10.99999/dup.1}}
                 @article{a2, author={Quintana, A.}, title={GRADIENT LATTICES}, year={2020}, doi={https://doi.org/10.99999/DUP.1}}`,
    );
    const g = build({ files: { [bib.file.id]: bib.file }, bib: [{ fileId: bib.file.id, entries: bib.entries }] });
    const pubs = Object.values(g.nodes).filter((n) => n.kind === 'publication');
    expect(pubs).toHaveLength(1);
    expect(pubs[0].kind === 'publication' && pubs[0].bibKeys).toEqual(['a1', 'a2']);
  });

  it('a PDF that is not in the .bib but has the same DOI merges with its entry', () => {
    const bib = bibFixture();
    const pdf = fileRecord('reference', 'unknown.pdf');
    const text = pdfText([['Some header', 'doi:10.99999/synth.2020.001', 'no title we can match']]);
    const g = build({ files: { [bib.file.id]: bib.file, [pdf.id]: pdf }, bib: [{ fileId: bib.file.id, entries: bib.entries }], texts: { [pdf.id]: text } });
    const q = g.nodes['pub:bib:quintana2020'];
    expect(q.kind === 'publication' && q.fileIds).toEqual([pdf.id]);
    expect(g.fileLinks[0]).toMatchObject({ status: 'matched', method: 'pdf_doi' });
  });
});
