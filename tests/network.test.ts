import { describe, expect, it } from 'vitest';
import { buildNetwork, netType, nodeRadius, OTHER_CLUSTER, titleWords, type NetInput } from '../src/core/network';
import { layoutNetwork } from '../src/core/networkLayout';
import type { GraphWork } from '../src/core/openAlexGraph';

const doc: NetInput = { id: 'doc', kind: 'document', label: 'Sample paper' };
const pub = (id: string, title: string, extra: Partial<NetInput> = {}): NetInput => ({ id, kind: 'publication', label: `Author ${id}`, title, year: 2020, ...extra });
const work = (id: string, refs: string[], topic?: [string, string], extra: Partial<GraphWork> = {}): GraphWork => ({ id, refs, topic: topic ? { id: topic[0], name: topic[1], subfield: { id: 'S1', name: 'Hydrology' } } : undefined, ...extra });

describe('network: edges between references', () => {
  it('links a reference to another one it cites (OpenAlex referenced_works)', () => {
    const inputs = [doc, pub('a', 'Rainfall runoff models for small basins'), pub('b', 'Soil moisture sensing with low cost probes')];
    const works = new Map([
      ['a', work('W1', ['W2', 'W99'])],
      ['b', work('W2', [])],
    ]);
    const net = buildNetwork(inputs, works, [{ source: 'doc', target: 'a' }, { source: 'doc', target: 'b' }]);
    const cites = net.edges.filter((e) => e.kind === 'cites');
    expect(cites).toEqual([expect.objectContaining({ source: 'a', target: 'b' })]);
    expect(net.edges.filter((e) => e.kind === 'doc')).toHaveLength(2);
    expect(net.nodes.find((n) => n.id === 'a')?.degree).toBe(1);
    expect(net.identified).toBe(2);
  });

  it('adds bibliographic coupling for 2+ shared references, but not when they already cite each other', () => {
    const inputs = [pub('a', 'One'), pub('b', 'Two'), pub('c', 'Three')];
    const works = new Map([
      ['a', work('W1', ['W10', 'W11', 'W12'])],
      ['b', work('W2', ['W10', 'W11'])],
      ['c', work('W3', ['W10', 'W11', 'W1'])],
    ]);
    const net = buildNetwork(inputs, works);
    const kinds = net.edges.map((e) => `${e.kind}:${e.source}-${e.target}`).sort();
    expect(kinds).toContain('cites:c-a');
    expect(kinds).toContain('coupling:a-b');
    expect(kinds).toContain('coupling:b-c');
    expect(kinds).not.toContain('coupling:a-c');
    expect(net.edges.find((e) => e.id === 'coupling:a|b')?.weight).toBe(2);
  });

  it('falls back to title similarity for references OpenAlex did not identify', () => {
    const inputs = [pub('a', 'Urban flood forecasting with radar nowcasting'), pub('b', 'Radar nowcasting for urban flood warning'), pub('c', 'Medieval poetry in translation')];
    const net = buildNetwork(inputs, new Map());
    expect(net.edges.map((e) => `${e.kind}:${e.source}-${e.target}`)).toEqual(['similar:a-b']);
  });

  it('two references resolving to the same work do not create a self-loop', () => {
    const net = buildNetwork([pub('a', 'Same'), pub('b', 'Same again')], new Map([['a', work('W1', ['W1'])], ['b', work('W1', ['W1'])]]));
    expect(net.edges).toEqual([]);
  });
});

describe('network: clusters', () => {
  it('groups by OpenAlex topic, then keywords, then "other"', () => {
    const inputs = [
      pub('a', 'Alpha'),
      pub('b', 'Beta'),
      pub('c', 'Gamma'),
      pub('d', 'Groundwater recharge estimates'),
      pub('e', 'Groundwater pumping and policy'),
      pub('f', 'Something unrelated entirely'),
      pub('g', 'Poetry of medieval harbours'),
    ];
    const works = new Map([
      ['a', work('W1', [], ['T1', 'Flood risk'])],
      ['b', work('W2', [], ['T1', 'Flood risk'])],
      ['c', work('W3', [], ['T2', 'Lone topic'])],
    ]);
    const net = buildNetwork(inputs, works);
    const of = (id: string) => net.nodes.find((n) => n.id === id)?.cluster;
    expect(of('a')).toBe('topic:T1');
    expect(of('b')).toBe('topic:T1');
    expect(of('d')).toBe('keyword:groundwater');
    expect(of('e')).toBe('keyword:groundwater');
    expect(of('f')).toBe(OTHER_CLUSTER);
    expect(net.clusters.find((c) => c.key === 'topic:T1')).toMatchObject({ label: 'Flood risk', count: 2 });
    expect(net.clusters.find((c) => c.key === 'keyword:groundwater')).toMatchObject({ label: 'Groundwater', source: 'keyword' });
    // the lone topic member joins its subfield only if 3+ share it; otherwise "other"
    expect(of('c')).toBe(OTHER_CLUSTER);
  });

  it('a few unidentified references among many identified ones go to "other", not to tiny word groups', () => {
    const known = Array.from({ length: 20 }, (_, i) => pub(`k${i}`, `Known ${i}`));
    const inputs = [...known, pub('x', 'Groundwater recharge estimates'), pub('y', 'Groundwater pumping and policy')];
    const works = new Map(known.map((p, i) => [p.id, work(`W${i + 1}`, [], ['T1', 'Flood risk'])]));
    const net = buildNetwork(inputs, works);
    expect(net.nodes.find((n) => n.id === 'x')?.cluster).toBe(OTHER_CLUSTER);
    expect(net.clusters.map((c) => c.key)).toEqual(['topic:T1', OTHER_CLUSTER]);
  });

  it('never makes more than 10 coloured groups', () => {
    const inputs = Array.from({ length: 40 }, (_, i) => pub(`p${i}`, `Title ${i}`));
    const works = new Map(inputs.map((p, i) => [p.id, work(`W${i + 1}`, [], [`T${Math.floor(i / 2)}`, `Topic ${Math.floor(i / 2)}`])]));
    const net = buildNetwork(inputs, works);
    expect(net.clusters.filter((c) => c.key !== OTHER_CLUSTER).length).toBe(10);
    expect(net.clusters.find((c) => c.key === OTHER_CLUSTER)?.count).toBe(20);
  });
});

describe('network: helpers', () => {
  it('title words skip stop words in several languages and fold plurals', () => {
    expect(titleWords('The effects of models on the rivers')).toEqual(['model', 'river']);
    expect(titleWords('Uma análise sobre as bacias hidrográficas')).toEqual(['analise', 'bacia', 'hidrografica']);
    expect(titleWords('城市洪水')).toEqual(['城市', '市洪', '洪水']);
  });

  it('types come from OpenAlex first, then the reference entry', () => {
    expect(netType({ id: 'W1', refs: [], type: 'dissertation' }, 'article', undefined)).toBe('thesis');
    expect(netType(undefined, 'book', undefined)).toBe('book');
    expect(netType(undefined, 'misc', 'https://example.org')).toBe('web');
    expect(netType(undefined, undefined, undefined)).toBe('other');
  });

  it('node radius grows with the chosen measure and is capped', () => {
    const base = { kind: 'publication' as const, inText: 0, degree: 0 };
    expect(nodeRadius(base, 'inText')).toBe(5);
    expect(nodeRadius({ ...base, inText: 9 }, 'inText')).toBeGreaterThan(nodeRadius({ ...base, inText: 1 }, 'inText'));
    expect(nodeRadius({ ...base, inText: 1000 }, 'inText')).toBe(22);
  });
});

describe('network layout', () => {
  const inputs = [doc, ...Array.from({ length: 120 }, (_, i) => pub(`p${i}`, `Paper about topic ${i % 6} number ${i}`, { year: 1990 + (i % 30) }))];
  const works = new Map(inputs.slice(1).map((p, i) => [p.id, work(`W${i + 1}`, [`W${((i * 7) % 120) + 1}`, `W${((i * 13) % 120) + 1}`], [`T${i % 6}`, `Topic ${i % 6}`])]));
  const net = buildNetwork(inputs, works, inputs.slice(1).map((p) => ({ source: 'doc', target: p.id })));

  it('is deterministic and places every node', () => {
    const a = layoutNetwork(net, { sizeBy: 'degree' });
    const b = layoutNetwork(net, { sizeBy: 'degree' });
    expect(a.size).toBe(121);
    expect([...a.values()].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(JSON.stringify([...a])).toBe(JSON.stringify([...b]));
    expect(a.get('doc')).toMatchObject({ x: 0, y: 0 });
  });

  it('keeps topic groups apart (members closer to their own group centre)', () => {
    const pos = layoutNetwork(net, { sizeBy: 'inText' });
    const centre = new Map<string, { x: number; y: number; n: number }>();
    for (const n of net.nodes) {
      if (n.kind !== 'publication') continue;
      const p = pos.get(n.id)!;
      const c = centre.get(n.cluster) ?? { x: 0, y: 0, n: 0 };
      centre.set(n.cluster, { x: c.x + p.x, y: c.y + p.y, n: c.n + 1 });
    }
    let own = 0;
    for (const n of net.nodes) {
      if (n.kind !== 'publication') continue;
      const p = pos.get(n.id)!;
      const d = (k: string) => {
        const c = centre.get(k)!;
        return Math.hypot(p.x - c.x / c.n, p.y - c.y / c.n);
      };
      if ([...centre.keys()].every((k) => k === n.cluster || d(n.cluster) <= d(k))) own++;
    }
    expect(own / 120).toBeGreaterThan(0.8);
  });

  it('timeline mode orders by year on the x axis', () => {
    const pos = layoutNetwork(net, { sizeBy: 'inText', timeline: true, showDoc: false });
    const old = net.nodes.filter((n) => n.year === 1990).map((n) => pos.get(n.id)!.x);
    const recent = net.nodes.filter((n) => n.year === 2019).map((n) => pos.get(n.id)!.x);
    expect(Math.max(...old)).toBeLessThan(Math.min(...recent));
    expect(pos.has('doc')).toBe(false);
  });
});
