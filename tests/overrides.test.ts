/** Manual labels per citation: persisted, shown as overridden, reversible, part of the summary and the CSV. */
import { describe, expect, it } from 'vitest';
import { CoreStore, MemoryDriver } from '../src/core/coreStore';
import { evidenceCsv } from '../src/core/export';
import { refRows } from '../src/core/refStatus';
import { buildView, DEFAULT_FILTERS } from '../src/core/view';
import { pdfText } from './helpers/fixtures';

const LINES = [
  ['1 INTRODUÇÃO', 'A segmentação de feridas é lenta (RONNEBERGER; FISCHER; BROX, 2015). Modelos de visão ajudam bastante na prática (XIE et al., 2021).'],
  [
    'REFERÊNCIAS',
    'RONNEBERGER, O.; FISCHER, P.; BROX, T. U-Net: convolutional networks for biomedical image segmentation. In: MICCAI. 2015. p. 234-241.',
    'XIE, E. et al. SegFormer: simple and efficient design for semantic segmentation with transformers. NeurIPS, 2021.',
  ],
];

async function project() {
  const store = new CoreStore({ driver: new MemoryDriver(), extractText: async () => pdfText(LINES) });
  const p = (await store.createProject('t', 't')).id;
  await store.addFile(p, { data: new TextEncoder().encode('%PDF-1.4 synthetic'), originalName: 'paper.pdf', role: 'main' });
  await store.extractReferencesFromMain(p);
  return { store, p };
}

describe('manual evidence labels', () => {
  it('round-trips through decisions and rebuilds, and can be undone', async () => {
    const { store, p } = await project();
    const before = await store.getEvidence(p);
    const occ = before.occurrences.find((o) => o.resolution === 'resolved')!;
    expect(occ).toBeTruthy();
    const auto = occ.status;
    expect(auto).toBe('nao_localizado'); // no PDF of the source
    await store.updateDecisions(p, (d) => {
      d.evidence = { [occ.id]: { status: 'localizado', at: '2026-11-13T00:00:00Z' } };
    });
    const after = await store.getEvidence(p);
    const o2 = after.occurrences.find((o) => o.id === occ.id)!;
    expect(o2.status).toBe('localizado');
    expect(o2.override).toMatchObject({ status: 'localizado', auto });
    expect(after.summary.localizado).toBe(before.summary.localizado + 1);

    // survives a full rebuild
    await store.rebuild(p);
    expect((await store.getEvidence(p)).occurrences.find((o) => o.id === occ.id)?.status).toBe('localizado');

    // shows in the CSV export
    const csv = evidenceCsv(await store.getEvidence(p), await store.getGraph(p));
    expect(csv.split('\n')[0]).toMatch(/marca/i);
    expect(csv).toMatch(/localizado/);

    // undo
    await store.updateDecisions(p, (d) => {
      delete d.evidence![occ.id];
    });
    const undone = (await store.getEvidence(p)).occurrences.find((o) => o.id === occ.id)!;
    expect(undone.status).toBe(auto);
    expect(undone.override).toBeUndefined();
  });

  it('setEvidenceLabel updates the report in place (no rebuild) and undoes cleanly', async () => {
    const { store, p } = await project();
    const g = await store.getGraph(p);
    const before = await store.getEvidence(p);
    const occ = before.occurrences.find((o) => o.resolution === 'resolved')!;
    const r1 = await store.setEvidenceLabel(p, occ.id, 'ressalva');
    expect(r1.occurrences.find((o) => o.id === occ.id)?.override?.auto).toBe(occ.status);
    expect(r1.summary.ressalva).toBe(before.summary.ressalva + 1);
    const r2 = await store.setEvidenceLabel(p, occ.id, 'localizado'); // relabel: auto stays the computed one
    expect(r2.occurrences.find((o) => o.id === occ.id)?.override).toMatchObject({ status: 'localizado', auto: occ.status });
    expect((await store.getGraph(p)).builtAt).toBe(g.builtAt);
    const r3 = await store.setEvidenceLabel(p, occ.id, null);
    expect(r3.summary).toEqual(before.summary);
    expect(r3.occurrences.find((o) => o.id === occ.id)).toEqual(occ);
  });

  it('reference status: no PDF is "sem PDF", never "não localizado"; a manual OK counts as checked', async () => {
    const { store, p } = await project();
    const g = await store.getGraph(p);
    let ev = await store.getEvidence(p);
    const rows = refRows(g, ev);
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.status === 'sem_pdf')).toBe(true);
    const occ = ev.occurrences.find((o) => o.resolution === 'resolved')!;
    await store.updateDecisions(p, (d) => {
      d.evidence = { [occ.id]: { status: 'ressalva', at: '2026-11-13T00:00:00Z' } };
    });
    ev = await store.getEvidence(p);
    const row = refRows(await store.getGraph(p), ev).find((r) => r.pub.id === occ.publicationId)!;
    expect(row.status).toBe('ressalva');
    expect(row.manual).toBe(1);
  });

  it('graph: status filter and "document -> source only" edges', async () => {
    const { store, p } = await project();
    const g = await store.getGraph(p);
    const ev = await store.getEvidence(p);
    const status = new Map(refRows(g, ev).map((r) => [r.pub.id, r.status]));
    const all = buildView(g, { ...DEFAULT_FILTERS, interSource: false }, new Set(), status);
    expect(all.nodes.filter((n) => n.kind === 'publication').every((n) => n.refStatus === 'sem_pdf')).toBe(true);
    expect(all.edges.every((e) => g.nodes[e.source]?.kind === 'document')).toBe(true);
    const none = buildView(g, { ...DEFAULT_FILTERS, refStatuses: ['ok'] }, new Set(), status);
    expect(none.nodes.filter((n) => n.kind === 'publication')).toHaveLength(0);
  });
});
