import { describe, expect, it } from 'vitest';
import { parseBibtex } from '../src/core/bibtex';
import { decodeLatex, findDois, normalizeDoi, normalizeTitle, parseAuthor, parseAuthorList, sameFamilyName, titleSimilarity } from '../src/core/normalize';
import { SYNTHETIC_BIB } from './helpers/fixtures';

describe('normalization', () => {
  it('normalizes DOIs from URLs, prefixes and case', () => {
    expect(normalizeDoi('https://doi.org/10.99999/SYNTH.2018.042')).toBe('10.99999/synth.2018.042');
    expect(normalizeDoi('doi: 10.99999/abc.1.')).toBe('10.99999/abc.1');
    expect(normalizeDoi('http://dx.doi.org/10.99999/x(1)')).toBe('10.99999/x(1');
    expect(normalizeDoi('not a doi')).toBeUndefined();
    expect(normalizeDoi(undefined)).toBeUndefined();
  });

  it('finds DOIs in free text', () => {
    expect(findDois('see https://doi.org/10.99999/a.1, and doi:10.99999/B.2.')).toEqual(['10.99999/a.1', '10.99999/b.2']);
  });

  it('decodes LaTeX accents and markup', () => {
    expect(decodeLatex("S{\\'a}nchez, Elo{\\'i}sa")).toBe('Sánchez, Eloísa');
    expect(decodeLatex('{\\"O}zt{\\"u}rk \\& {\\c{C}}elik')).toBe('Öztürk & Çelik');
    expect(decodeLatex('\\emph{Deep} {{Nets}} -- 2020')).toBe('Deep Nets – 2020');
  });

  it('normalizes titles: case, accents, punctuation, dashes', () => {
    expect(normalizeTitle('{{Ánalise}}: Self–Calibrating   Annotation!')).toBe('analise self calibrating annotation');
    expect(titleSimilarity('Self-Calibrating Annotation Protocols', 'self calibrating annotation protocols')).toBe(1);
    expect(titleSimilarity('Int. J. of Synthetic Imaging', 'International Journal of Synthetic Imaging')).toBe(1);
  });

  it('parses author names in both orders, particles and organizations', () => {
    expect(parseAuthor('Quintana, Aurelio')).toMatchObject({ family: 'Quintana', given: 'Aurelio' });
    expect(parseAuthor('Aurelio Quintana')).toMatchObject({ family: 'Quintana', given: 'Aurelio' });
    expect(parseAuthor('Jan van Dalen').family).toBe('van Dalen');
    expect(parseAuthor('{Synthetic Standards Consortium}')).toMatchObject({ family: 'Synthetic Standards Consortium', organization: true });
    expect(parseAuthorList('A, B and {X and Y Group} and others').map((a) => a.family)).toEqual(['A', 'X and Y Group']);
    expect(sameFamilyName('Kessel-Brandt', 'Kessel Brandt')).toBe(true);
    expect(sameFamilyName('Pölönen', 'Polonen')).toBe(true);
    expect(sameFamilyName('van Dalen', 'Dalen')).toBe(true);
  });
});

describe('BibTeX parser', () => {
  it('parses entries, macros, quoted/braced values and comments', () => {
    const { entries, errors } = parseBibtex(SYNTHETIC_BIB);
    expect(errors).toEqual([]);
    expect(entries.map((e) => e.key)).toEqual(['quintana2020', 'albrecht2018', 'nakamura2019', 'orgdoc2021']);
    expect(entries[0].fields.journal).toBe('Journal of Synthetic Studies');
    expect(entries[0].fields.title).toBe('{Gradient Lattices for Tissue Boundary Estimation}');
    expect(entries[1].type).toBe('article');
  });

  it('reports unterminated entries instead of guessing', () => {
    const { entries, errors } = parseBibtex('@article{x, title = {Open');
    expect(entries).toHaveLength(0);
    expect(errors[0].message).toMatch(/Unterminated/);
  });

  it('supports # concatenation and month macros', () => {
    const { entries } = parseBibtex('@string{a = "Alpha"} @misc{k, note = a # " and Beta", month = jan}');
    expect(entries[0].fields.note).toBe('Alpha and Beta');
    expect(entries[0].fields.month).toBe('1');
  });
});
