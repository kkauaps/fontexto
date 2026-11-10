import { describe, expect, it } from 'vitest';
import { toGraphML } from '../src/core/export';
import { buildView, DEFAULT_FILTERS, groupNodeId } from '../src/core/view';
import { articleText, bibFixture, build, fileRecord } from './helpers/fixtures';
import type { CategoryRule } from '../src/core/categories';

const rules: CategoryRule[] = [
  { name: 'Lattices', keywords: ['lattices'] },
  { name: 'Benchmarks', keywords: ['benchmark'] },
];

function graph() {
  const bib = bibFixture();
  const pdf = fileRecord('reference', 'q.pdf');
  const t = articleText({
    title: 'Gradient Lattices for Tissue Boundary Estimation',
    authorsLine: 'Aurelio Quintana',
    references: ['Albrecht, H., Moreau, L. (2018). A benchmark of imaginary segmentation networks.'],
  });
  return build({ files: { [bib.file.id]: bib.file, [pdf.id]: pdf }, bib: [{ fileId: bib.file.id, entries: bib.entries }], texts: { [pdf.id]: t }, categoryRules: rules });
}

describe('view model', () => {
  it('suggests categories (marked as suggested) and honours user overrides', () => {
    const g = graph();
    const q = g.nodes['pub:bib:quintana2020'];
    expect(q.kind === 'publication' && q.category).toEqual({ value: 'Lattices', source: 'suggested', matched: ['lattices'] });
    const g2 = build(
      { files: g.files, bib: [{ fileId: Object.values(g.files).find((f) => f.role === 'bibtex')!.id, entries: bibFixture().entries }], categoryRules: rules },
      { categories: { 'pub:bib:quintana2020': 'Custom' } },
    );
    const q2 = g2.nodes['pub:bib:quintana2020'];
    expect(q2.kind === 'publication' && q2.category).toEqual({ value: 'Custom', source: 'user' });
  });

  it('filters by year, author and category', () => {
    const g = graph();
    const ids = (f: Partial<typeof DEFAULT_FILTERS>) => buildView(g, { ...DEFAULT_FILTERS, ...f }).nodes.map((n) => n.id);
    expect(ids({ yearMin: 2020 })).toEqual(['doc:main', 'pub:bib:orgdoc2021', 'pub:bib:quintana2020']);
    expect(ids({ author: 'albrecht' })).toEqual(['doc:main', 'pub:bib:albrecht2018']);
    expect(ids({ categories: ['Benchmarks'] })).toEqual(['doc:main', 'pub:bib:albrecht2018']);
  });

  it('marks search hits without removing other nodes', () => {
    const v = buildView(graph(), { ...DEFAULT_FILTERS, search: 'gradient lattices' });
    expect(v.nodes.filter((n) => n.matchesSearch).map((n) => n.id)).toEqual(['pub:bib:quintana2020']);
    expect(v.nodes.length).toBe(5);
  });

  it('collapses a category into one group node with aggregated edges', () => {
    const v = buildView(graph(), DEFAULT_FILTERS, new Set(['Sem categoria']));
    const gid = groupNodeId('Sem categoria');
    const group = v.nodes.find((n) => n.id === gid)!;
    expect(group.groupSize).toBe(2);
    const agg = v.edges.find((e) => e.target === gid)!;
    expect(agg.count).toBe(2);
    expect(agg.source).toBe('doc:main');
  });

  it('computes in-degree (centrality) over visible edges', () => {
    const v = buildView(graph(), DEFAULT_FILTERS);
    expect(v.nodes.find((n) => n.id === 'pub:bib:albrecht2018')!.inDegree).toBe(2);
  });

  it('exports valid GraphML with escaped values', () => {
    const xml = toGraphML(graph());
    expect(xml).toMatch(/^<\?xml/);
    expect(xml).toContain('<edge id="cites:pub:bib:quintana2020-&gt;pub:bib:albrecht2018"');
    expect(xml).toContain('<data key="e_status">confirmed</data>');
  });
});
