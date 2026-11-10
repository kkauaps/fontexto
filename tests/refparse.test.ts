import { describe, expect, it } from 'vitest';
import { parseBibtex } from '../src/core/bibtex.js';
import { parseReferenceText, parseReferences, toBibtex } from '../src/core/refparse.js';
import fixture from './fixtures/abnt-reference-list.json';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

describe('reference list without .bib (fictional fixture, ABNT)', () => {
  const refs = parseReferences(fixture.entries);
  it('extracts one entry per bib key', () => {
    expect(fixture.entries.length).toBe(fixture.bib.length);
    expect(refs.length).toBe(fixture.bib.length);
  });
  it('covers every bib key by first author, year and (when present) DOI', () => {
    for (const b of fixture.bib) {
      const hit = refs.find((r) => fold(r.authors[0]?.family ?? '') === fold(b.firstAuthor) && r.year === b.year && (!b.doi || r.doi === b.doi.toLowerCase() || !r.doi));
      expect(hit, `${b.key} (${b.firstAuthor} ${b.year})`).toBeDefined();
    }
  });
  it('keeps organisation authors, particles and given names', () => {
    const cvat = refs.find((r) => r.authors[0]?.organization);
    expect(cvat?.authors[0].family).toBe('CVAT.AI');
    expect(cvat?.title).toBe('CVAT documentation');
    const dalen = refs.find((r) => r.authors[0]?.family === 'van Dalen');
    expect(dalen?.authors[0].given).toBe('Mirte J.');
    expect(refs.find((r) => r.authors[0]?.family === 'Kessel-Brandt')?.year).toBe(2024);
  });
  it('does not take the access date as the publication year', () => {
    const alverno = refs.find((r) => r.authors[0]?.family === 'Alverno');
    expect(alverno?.year).toBe(2022);
  });
  it('generates unique keys and a bib the normal parser reads back', () => {
    expect(new Set(refs.map((r) => r.key)).size).toBe(refs.length);
    const parsed = parseBibtex(toBibtex(refs));
    expect(parsed.errors).toEqual([]);
    expect(parsed.entries.length).toBe(refs.length);
  });
});

describe('other citation styles', () => {
  it('APA', () => {
    const r = parseReferenceText('Ronneberger, O., Fischer, P., & Brox, T. (2015). U-Net: Convolutional networks for biomedical image segmentation. In MICCAI (pp. 234-241). Springer.');
    expect(r.style).toBe('apa');
    expect(r.authors.map((a) => a.family)).toEqual(['Ronneberger', 'Fischer', 'Brox']);
    expect(r.year).toBe(2015);
    expect(r.title).toBe('U-Net: Convolutional networks for biomedical image segmentation');
  });
  it('IEEE', () => {
    const r = parseReferenceText('O. Ronneberger, P. Fischer, and T. Brox, "U-Net: Convolutional networks for biomedical image segmentation," in Proc. MICCAI, 2015, pp. 234-241.', 0, '[1]');
    expect(r.style).toBe('ieee');
    expect(r.authors.map((a) => a.family)).toEqual(['Ronneberger', 'Fischer', 'Brox']);
    expect(r.year).toBe(2015);
    expect(r.title).toBe('U-Net: Convolutional networks for biomedical image segmentation');
  });
  it('Vancouver', () => {
    const r = parseReferenceText('Ronneberger O, Fischer P, Brox T. U-Net: convolutional networks for biomedical image segmentation. Lect Notes Comput Sci. 2015;9351:234-41.');
    expect(r.style).toBe('vancouver');
    expect(r.authors[0]).toMatchObject({ family: 'Ronneberger', given: 'O' });
    expect(r.year).toBe(2015);
  });
});
