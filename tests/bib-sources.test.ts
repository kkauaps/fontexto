/**
 * References from a .bib file that the free-PDF search used to miss or misread: a DOI that belongs to another work,
 * a DOI or arXiv id written in a note, and web pages (documentation, project sites) that have no PDF to look up.
 * Fictional works only.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { parseBibtex } from '../src/core/bibtex';
import { isWebSource, oaQueryFromPub } from '../src/core/oaClient';
import { doiTitleConflict, lookupOpenAccess, memoryCache, resetOaState } from '../src/core/openAccess';
import { buildGraph } from '../src/core/pipeline';
import { emptyDecisions, type PublicationNode } from '../src/core/model';

function pubsOf(bib: string): Record<string, PublicationNode> {
  const { entries } = parseBibtex(bib);
  const g = buildGraph({
    projectId: 't',
    now: '2026-01-01T00:00:00Z',
    files: { b: { id: 'b', role: 'bibtex', originalName: 'r.bib', extraction: { status: 'ok' } } } as never,
    bib: [{ fileId: 'b', entries }],
    texts: {},
    decisions: emptyDecisions(),
    categoryRules: [],
  } as never);
  return Object.fromEntries(Object.values(g.nodes).filter((n): n is PublicationNode => n.kind === 'publication').map((n) => [n.bibKeys[0], n]));
}

describe('bib fields that carry the identifier', () => {
  const p = pubsOf(String.raw`
@inproceedings{noted, author={Quill, Ada}, title={Fair Moss Benchmarks}, booktitle={Proc. X}, year={2018}, note={DOI: 10.5555/fx.0042}}
@article{axjournal, author={Lind, Bram}, title={Lichen Graphs at Scale}, journal={arXiv preprint arXiv:2005.12873v3}, year={2020}}
@misc{axnote, author={Lind, Bram}, title={A Lakehouse for Moss}, year={2026}, note={arXiv:2603.03705}}
@misc{site, author={{Example Software Foundation}}, title={Moss DB Documentation}, year={2025}, howpublished={\url{https://moss.example.org/docs/}}, note={Acesso em: 13 jun. 2026}}
@manual{manual, author={{Example Group}}, title={Moss 16 Documentation: EXPLAIN}, year={2024}, url={https://moss.example.org/docs/16/explain.html}}
@book{book, author={Quill, Ada}, title={Moss: An Introduction}, year={2010}, publisher={Example Press}}
`);
  it('reads a DOI written in a note', () => {
    expect(p.noted.doi).toBe('10.5555/fx.0042');
  });
  it('reads an arXiv id from the journal field or a note, and sends it to the search', () => {
    expect(oaQueryFromPub(p.axjournal).arxiv).toBe('2005.12873');
    expect(oaQueryFromPub(p.axnote).arxiv).toBe('2603.03705');
  });
  it('reads the link in howpublished = {\\url{...}}', () => {
    expect(p.site.url).toBe('https://moss.example.org/docs/');
  });
  it('treats documentation and project pages as web pages, not as works to look up', () => {
    expect(isWebSource(p.site)).toBe(true);
    expect(isWebSource(p.manual)).toBe(true);
    expect(isWebSource(p.book)).toBe(false);
    expect(isWebSource(p.noted)).toBe(false);
    expect(isWebSource(p.axnote)).toBe(false);
  });
});

describe('a DOI that belongs to another work', () => {
  const conflict = (a: string, b: string) => doiTitleConflict({ doi: '10.5555/x', title: a }, { doi: '10.5555/x', title: b, status: 'closed' });
  it('is flagged when the titles share almost nothing', () => {
    expect(conflict('A Comparative Study of Moss Processing Systems', 'One trillion spores: moss processing at forest scale')).toBe(true);
  });
  it('is not flagged for the same title written differently, or for a translation', () => {
    expect(conflict('Lumen index: synthetic benchmarks', 'Lumen Index: Synthetic Benchmarks')).toBe(false);
    expect(conflict('Lumen', 'Lumen: Synthetic Benchmarks for Moss Growth Modelling')).toBe(false);
    expect(conflict('Índice Lumen: referências sintéticas para o crescimento do musgo', 'Lumen index: synthetic benchmarks for moss growth')).toBe(false);
    expect(conflict('基于苔藓的合成基准', 'Synthetic benchmarks for moss')).toBe(false);
  });

  beforeEach(() => resetOaState());
  it('looks the work up by its title instead, and reports the wrong DOI', async () => {
    const OTHER = { id: 'https://openalex.org/W9', doi: 'https://doi.org/10.5555/wrong.1', title: 'One trillion spores: moss processing at forest scale', publication_year: 2015, authorships: [{ author: { display_name: 'Ivo Brandt' } }], best_oa_location: null, locations: [] };
    const RIGHT = { id: 'https://openalex.org/W10', doi: 'https://doi.org/10.5555/right.2', title: 'A Comparative Study of Moss Processing Systems', publication_year: 2015, authorships: [{ author: { display_name: 'Omar Quillby' } }], best_oa_location: { is_oa: true, pdf_url: 'https://repo.example.edu/moss.pdf', landing_page_url: 'https://repo.example.edu/moss', version: 'acceptedVersion', source: { display_name: 'Example Repository', type: 'repository' } }, locations: [] };
    const json = (d: unknown) => new Response(JSON.stringify(d), { headers: { 'content-type': 'application/json' } });
    const f = (async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.startsWith('https://api.openalex.org/works/doi:')) return json(u.includes('wrong.1') ? OTHER : RIGHT);
      if (u.startsWith('https://api.openalex.org/works?')) return json({ results: [RIGHT] });
      if (u.startsWith('https://api.crossref.org/works?')) return json({ message: { items: [] } });
      if (u.includes('europepmc')) return json({ resultList: { result: [] } });
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    const r = await lookupOpenAccess({ doi: '10.5555/wrong.1', title: 'A Comparative Study of Moss Processing Systems', year: 2015, author: 'Quillby' }, f, { cache: memoryCache(), env: { OPENALEX_API_KEY: 'k' } });
    expect(r.doiMismatch).toEqual({ doi: '10.5555/wrong.1', title: 'One trillion spores: moss processing at forest scale' });
    expect(r.doi).toBe('10.5555/right.2');
    expect(r.pdfUrls[0]?.url).toBe('https://repo.example.edu/moss.pdf');
  });
});
