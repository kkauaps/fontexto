import { describe, expect, it } from 'vitest';
import { extractMarkersFromText, parseParenthetical, resolveMarker } from '../src/core/citations';
import type { PublicationNode } from '../src/core/model';
import { parseAuthor } from '../src/core/normalize';
import { bibFixture, build, fileRecord, pdfText } from './helpers/fixtures';

const pub = (id: string, authors: string[], year: number, yearLabel?: string): PublicationNode => ({
  id,
  kind: 'publication',
  label: id,
  title: `Title ${id}`,
  authors: authors.map(parseAuthor),
  year,
  yearLabel,
  bibKeys: [],
  fileIds: [],
  metadataSources: [],
  inMainBibliography: true,
});

describe('in-text citation markers', () => {
  it('parses parenthetical, ABNT and narrative forms', () => {
    const m = extractMarkersFromText(
      'As shown (Quintana et al., 2020; ALBRECHT; MOREAU, 2018, p. 12), and Nakamura e Sánchez (2019) agree. Also SYNTH (2021).',
    );
    expect(m.map((x) => `${x.authors.join('+')}|${x.yearLabel}|${x.etAl}`)).toEqual([
      'Quintana|2020|true',
      'ALBRECHT+MOREAU|2018|false',
      'Nakamura+Sánchez|2019|false',
      // Narrative capture may include a preceding capitalized word; resolution strips it.
      'Also SYNTH|2021|false',
    ]);
    const synth = pub('synth', ['{SYNTH}'], 2021);
    expect(resolveMarker(m[3], [synth])).toEqual({ status: 'resolved', publicationId: 'synth' });
  });

  it('expands multiple years for the same author', () => {
    expect(parseParenthetical('Quintana, 2020a, 2020b').map((r) => r.yearLabel)).toEqual(['2020a', '2020b']);
  });

  it('ignores parentheses without an author-year pattern', () => {
    expect(extractMarkersFromText('values (n = 2020) and (Fig. 3) and (see Table 2)')).toEqual([]);
  });
});

describe('ambiguous citations', () => {
  const twins = [pub('silvaA', ['Silva, Ana', 'Rocha, B.', 'Lima, C.'], 2025), pub('silvaB', ['Silva, Ana', 'Duarte, E.', 'Melo, F.'], 2025)];

  it('two works with the same first author and year are reported as ambiguous, never picked', () => {
    const r = resolveMarker({ authors: ['Silva'], etAl: true, year: 2025, yearLabel: '2025' }, twins);
    expect(r).toEqual({ status: 'ambiguous', candidates: ['silvaA', 'silvaB'] });
  });

  it('a second author or a year suffix disambiguates when present in the bibliography', () => {
    expect(resolveMarker({ authors: ['Silva', 'Duarte'], etAl: false, year: 2025, yearLabel: '2025' }, twins)).toEqual({ status: 'resolved', publicationId: 'silvaB' });
    const suffixed = [pub('a', ['Silva, A.'], 2025, '2025a'), pub('b', ['Silva, A.'], 2025, '2025b')];
    expect(resolveMarker({ authors: ['Silva'], etAl: false, year: 2025, yearLabel: '2025b' }, suffixed)).toEqual({ status: 'resolved', publicationId: 'b' });
  });

  it('unknown authors are unresolved (no invented reference)', () => {
    expect(resolveMarker({ authors: ['Nobody'], etAl: false, year: 2025, yearLabel: '2025' }, twins).status).toBe('unresolved');
  });

  it('parenthetical co-author lists are never shifted to the second author', () => {
    const only = [pub('souza', ['Souza, B.'], 2020)];
    expect(resolveMarker({ authors: ['Silva', 'Souza'], etAl: false, year: 2020, yearLabel: '2020' }, only).status).toBe('unresolved');
    expect(resolveMarker({ authors: ['Silva', 'Souza'], etAl: false, year: 2020, yearLabel: '2020', narrative: true }, only).status).toBe('resolved');
  });

  it('pipeline records ambiguous markers as issues and keeps them off the edges', () => {
    const bib = bibFixture(String.raw`
      @article{s1, author={Silva, Ana and Rocha, B. and Lima, C.}, title={First synthetic work}, year={2025}}
      @article{s2, author={Silva, Ana and Duarte, E. and Melo, F.}, title={Second synthetic work}, year={2025}}
      @article{q, author={Quintana, Aurelio}, title={Gradient lattices}, year={2020}}`);
    const main = fileRecord('main', 'tcc.pdf', { pageCount: 1 });
    const text = pdfText([['Wound tissue was studied (Silva et al., 2025) and (Quintana, 2020).']]);
    const g = build({ files: { [bib.file.id]: bib.file, [main.id]: main }, bib: [{ fileId: bib.file.id, entries: bib.entries }], texts: { [main.id]: text } });
    expect(g.citationIssues).toHaveLength(1);
    expect(g.citationIssues[0]).toMatchObject({ status: 'ambiguous', page: 1, candidates: ['pub:bib:s1', 'pub:bib:s2'] });
    const s1 = g.edges['cites:doc:main->pub:bib:s1'];
    expect(s1.provenance.some((p) => p.method === 'in_text_marker')).toBe(false);
    expect(s1.provenance[0].notes?.join(' ')).toMatch(/No in-text citation marker/);
    const q = g.edges['cites:doc:main->pub:bib:q'];
    expect(q.provenance.find((p) => p.method === 'in_text_marker')?.citationAnchors?.[0]).toMatchObject({ fileId: main.id, page: 1 });
  });
});

describe('markers that are not unidentified references', () => {
  it('ignores "Autor (2026)" self-citations of table sources, but keeps real ones', () => {
    const text = 'Fonte: Autor (2026), com base em Ravikandar et al. (2022) e (Ronneberger; Fischer; Brox, 2015).';
    expect(extractMarkersFromText(text).map((m) => m.authors[0])).toEqual(['Ravikandar', 'Ronneberger']);
    expect(extractMarkersFromText(text, { includeSelf: true }).some((m) => m.authors[0] === 'Autor')).toBe(true);
    expect(extractMarkersFromText('Elaboração própria (2024) e (Author, 2021).')).toEqual([]);
  });
  it('reads ABNT semicolon co-authors as one reference and et al. variants', () => {
    expect(parseParenthetical('Ronneberger; Fischer; Brox, 2015')).toEqual([expect.objectContaining({ authors: ['Ronneberger', 'Fischer', 'Brox'], year: 2015, etAl: false })]);
    expect(parseParenthetical('Odrany et al., 2024')).toEqual([expect.objectContaining({ authors: ['Odrany'], etAl: true })]);
    expect(parseParenthetical('Xie et al, 2021; Cheng e Schwing, 2022')).toHaveLength(2);
  });
  it('resolves multi-author and et al. markers against the bibliography', () => {
    const pub = (id: string, family: string[], year: number) => ({ id, kind: 'publication', year, yearLabel: String(year), authors: family.map((f) => ({ family: f })) }) as never;
    const pubs = [pub('r', ['Ronneberger', 'Fischer', 'Brox'], 2015), pub('o', ['Odrany', 'Darvel', 'Moutharel', 'Vo'], 2024)];
    const [m] = parseParenthetical('Ronneberger; Fischer; Brox, 2015');
    expect(resolveMarker(m, pubs)).toEqual({ status: 'resolved', publicationId: 'r' });
    const [o] = parseParenthetical('Odrany et al., 2024');
    expect(resolveMarker(o, pubs)).toEqual({ status: 'resolved', publicationId: 'o' });
  });
});
