/**
 * In-text citations and links of a journal article in author-year ABNT: works without date ("n/a", "S/A"), two works
 * of the same year cited as "(Beer, Seaver, 2017)", authors cited out of order or by a middle name, narrative markers
 * that caught the words before the name, and links broken across lines in the reference list. Fictional data only.
 */
import { describe, expect, it } from 'vitest';
import { parseParenthetical, resolveMarker, splitSeparateAuthors, type MarkerReference } from '../src/core/citations';
import { trimNarrativeMarker } from '../src/core/evidence';
import { isWebSource, oaQueryFromPub } from '../src/core/oaClient';
import { handleOaRequest, memoryCache, resetOaState } from '../src/core/openAccess';
import { parseReferenceText, urlInReference } from '../src/core/refparse';
import type { PublicationNode } from '../src/core/model';
import { joinLines } from '../src/core/text';

const pub = (id: string, authors: [string, string?][], year?: number, extra: Partial<PublicationNode> = {}): PublicationNode =>
  ({ id, kind: 'publication', authors: authors.map(([family, given]) => ({ raw: family, family, given })), year, bibKeys: [], fileIds: [], metadataSources: [], inMainBibliography: true, label: id, ...extra }) as PublicationNode;

const PUBS = [
  pub('moss', [['MOSS RESEARCH CENTER']]),
  pub('quill', [['Quill', 'Ada']], 2015),
  pub('lind', [['Lind', 'Bram']], 2008),
  pub('beer', [['Brandt', 'Maja']], 2017),
  pub('seav', [['Okafor', 'Chidi']], 2017),
  pub('vega', [['Vega', 'Lia'], ['Zorn-Tapia', 'Ida']], 2023),
  pub('leite', [['Leite Junior', 'Otto'], ['Abel', 'Rui Benichio Alves']], 2023),
  pub('vdijck', [['van Dijck', 'José']], 2013),
  pub('nasser', [['Nasser', 'Rio'], ['Egler', 'Tia']], 2023),
  pub('jesus', [['Jesus', 'Maria'], ['Almada', 'Pablo'], ['Amaral', 'Mara']], 2023),
];
const resolve = (m: MarkerReference) => resolveMarker(m, PUBS);

describe('citations without date', () => {
  it('reads "n/a" and "S/A" as no date, without losing the next reference of the group', () => {
    const refs = parseParenthetical('Moss Research Center, n/a; Quill, 2015; Lind, 2008');
    expect(refs.map((r) => `${r.authors[0]}|${r.yearLabel}`)).toEqual(['Moss Research Center|s.d.', 'Quill|2015', 'Lind|2008']);
    expect(refs.map((r) => (resolve(r) as { publicationId?: string }).publicationId)).toEqual(['moss', 'quill', 'lind']);
    expect(parseParenthetical('MOSS RESEARCH CENTER, S/A')[0]?.year).toBe(0);
  });
});

describe('several works of the same year in one citation', () => {
  it('splits "(Brandt, Okafor, 2017)" into two references when there is no joint work', () => {
    const [m] = parseParenthetical('Brandt, Okafor, 2017');
    expect(splitSeparateAuthors(m, PUBS).map((x) => (resolve(x) as { publicationId?: string }).publicationId)).toEqual(['beer', 'seav']);
  });
  it('keeps co-authors together when the joint work exists', () => {
    const [m] = parseParenthetical('Nasser, Egler, 2023');
    expect(splitSeparateAuthors(m, PUBS)).toHaveLength(1);
  });
});

describe('authors cited unlike the list', () => {
  it('links a work cited by its second author, or by a middle name and "Jr.", and says the names differ', () => {
    const a = resolve({ authors: ['Zorn-Tapia'], etAl: false, year: 2023, yearLabel: '2023', narrative: true });
    expect(a).toMatchObject({ status: 'resolved', publicationId: 'vega', approx: { kind: 'name' } });
    const b = resolve({ authors: ['Benichio', 'Leite Jr.'], etAl: false, year: 2023, yearLabel: '2023', narrative: true });
    expect(b).toMatchObject({ status: 'resolved', publicationId: 'leite', approx: { kind: 'name' } });
  });
  it('drops the words a narrative marker caught before the name, also before a later author', () => {
    const r = resolve({ authors: ['Nele', 'V Nasser', 'Egler'], etAl: false, year: 2023, yearLabel: '2023', narrative: true });
    expect(r).toMatchObject({ status: 'resolved', publicationId: 'nasser' });
    expect((r as { approx?: unknown }).approx).toBeUndefined();
  });
  it('shows the marker from the cited name on, keeping particles and authors listed in another order', () => {
    expect(trimNarrativeMarker('Nele, V Nasser e Egler (2023)', PUBS[8])).toBe('Nasser e Egler (2023)');
    expect(trimNarrativeMarker('Van Dijck (2013, p. 12)', PUBS[7])).toBe('Van Dijck (2013, p. 12)');
    expect(trimNarrativeMarker('Almada, Jesus e Amaral (2023)', PUBS[9])).toBe('Almada, Jesus e Amaral (2023)');
    expect(trimNarrativeMarker('Benichio e Leite Jr. (2023)', PUBS[6])).toBe('Benichio e Leite Jr. (2023)');
  });
});

describe('links in the reference list', () => {
  it('joins a link the PDF broke across lines and cuts the access date', () => {
    expect(urlInReference('MOSS RESEARCH CENTER (S/A). Fact Sheet. https://www. example.org/fact-sheet/net/#panel-480dace1-fd73- 4f03-ad88 (acesso em 27/04/2023).')).toBe('https://www.example.org/fact-sheet/net/#panel-480dace1-fd73-4f03-ad88');
    expect(urlInReference('QUILL, Ada (2015). Políticas. Cadernos X, n. 3, p. 1-2. http://ctpol.example. br/wp-content/uploads/2019/04/x.pdf (acesso em 26/04/2023).')).toBe('http://ctpol.example.br/wp-content/uploads/2019/04/x.pdf');
    expect(urlInReference('LIND, Bram (2008). Web. First Lichen, v. 13. https://doi.org/10.5555/x')).toBeUndefined();
    expect(joinLines(['KNOX, Hannad (2016). Is there? In: Society for Moss.https://example.org/fieldsights/is-there-an-ontology-to-', 'the-digital (acesso em 27/04/2023).'])).toContain('ontology-to-the-digital');
  });
  it('tells a web page from an article that links to its PDF or page', () => {
    expect(parseReferenceText('MOSS RESEARCH CENTER (S/A). Internet Fact Sheet. https://www.example.org/fact-sheet (acesso em 27/04/2023).').web).toBe(true);
    expect(parseReferenceText('LIND, Bram (2008). Web 2.0 for lichens? First Lichen, v. 13, n. 3. www.example.org/ojs/view/2139/1946 (acesso em 27/04/2023).').web).toBeUndefined();
    const withPdf = pub('q', [['Quill']], 2015, { url: 'http://ctpol.example.br/x.pdf', entryType: 'online' });
    expect(isWebSource(withPdf)).toBe(false);
    expect(oaQueryFromPub(withPdf).link).toBe('http://ctpol.example.br/x.pdf');
  });
  it('downloads the PDF the reference links to before asking the catalogues', async () => {
    resetOaState();
    const f = (async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u === 'http://ctpol.example.br/x.pdf') return new Response(new TextEncoder().encode('%PDF-1.7 own copy'), { headers: { 'content-type': 'application/pdf' } });
      if (u.includes('api.openalex.org') || u.includes('api.crossref.org')) return new Response(JSON.stringify({ results: [], message: { items: [] } }), { headers: { 'content-type': 'application/json' } });
      return new Response('nope', { status: 404 });
    }) as typeof fetch;
    const res = await handleOaRequest(new URL('https://fontexto.test/api/oa/pdf?title=Pol%C3%ADticas+de+acesso+ao+musgo&year=2015&author=Quill&link=http%3A%2F%2Fctpol.example.br%2Fx.pdf'), f, { cache: memoryCache() });
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(new TextDecoder().decode(await res.arrayBuffer())).toContain('own copy');
  });
});
