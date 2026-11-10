/** HTTP API for citation evidence (document view): persistence, recompute on reprocess, privacy (synthetic data). */
import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EvidenceReport } from '../src/core/evidence';
import type { CitationGraph } from '../src/core/model';
import { createApp } from '../src/server/app';
import { flowText, makePdf } from '../src/server/devtools/syntheticPdf';
import { SYNTHETIC_BIB } from './helpers/fixtures';

const SECRET = 'UNPUBLISHED-SECRET-PHRASE';
const CLAIM = 'Gradient lattices improve tissue boundary estimation by 12.5 percent on dermatology images';

const mainPdf = () =>
  makePdf(
    flowText([
      { text: 'Synthetic Thesis Draft', size: 14 },
      { text: `1 Introduction ${SECRET}`, size: 12, gapBefore: 8 },
      { text: `${CLAIM} (QUINTANA et al., 2020). The benchmark is unstable (ALBRECHT; MOREAU, 2018).`, gapBefore: 4 },
      { text: 'References', size: 12, gapBefore: 14 },
      { text: 'QUINTANA, A. et al. Gradient Lattices for Tissue Boundary Estimation. 2020.', gapBefore: 3 },
      { text: 'ALBRECHT, H.; MOREAU, L. A Benchmark of Imaginary Segmentation Networks. 2018.', gapBefore: 3 },
    ]),
    { title: 'Synthetic Thesis Draft' },
  );

const quintanaPdf = () =>
  makePdf(
    flowText([
      { text: 'Gradient Lattices for Tissue Boundary Estimation', size: 14 },
      { text: 'Aurelio Quintana, Maja Brandt' },
      { text: 'doi: 10.99999/synth.2020.001' },
      { text: 'Abstract', size: 12, gapBefore: 8 },
      { text: 'A short summary of imaginary work.', gapBefore: 2 },
      { text: '1 Results', size: 12, gapBefore: 8 },
      { text: `In our experiments, ${CLAIM}. ${SECRET} is only in this body text.`, gapBefore: 3 },
      { text: 'References', size: 12, gapBefore: 12 },
      { text: '[1] Albrecht H, Moreau L. A benchmark of imaginary segmentation networks. 2018. doi:10.99999/synth.2018.042', gapBefore: 3 },
    ]),
    { title: 'Gradient Lattices for Tissue Boundary Estimation' },
  );

let tmp: string;
let base: string;
let close: () => void;
let pid: string;

const post = (url: string, body?: BodyInit, headers?: Record<string, string>) => fetch(`${base}${url}`, { method: 'POST', body, headers });
async function upload(files: { name: string; data: Uint8Array | string; type?: string }[], role: 'main' | 'reference' | 'bib', visibility = 'private') {
  const fd = new FormData();
  for (const f of files) fd.append('files', new Blob([f.data as BlobPart], f.type ? { type: f.type } : undefined), f.name);
  fd.append('role', role === 'main' ? 'main' : 'reference');
  fd.append('visibility', visibility);
  const r = await post(`/api/projects/${pid}/files`, fd);
  expect(r.status).toBe(201);
  return ((await r.json()) as { graph: CitationGraph }).graph;
}
const evidence = async () => (await (await fetch(`${base}/api/projects/${pid}/evidence`)).json()) as EvidenceReport;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'citation-evidence-api-'));
  const { app } = createApp({ dataDir: tmp, externalMetadata: false });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
  const created = await (await post('/api/projects', JSON.stringify({ name: 'Evidence API' }), { 'Content-Type': 'application/json' })).json();
  pid = created.id;
});
afterAll(async () => {
  close();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('evidence API', () => {
  it('is empty before a main document exists, and 404 for unknown projects', async () => {
    const e = await evidence();
    expect(e.occurrences).toEqual([]);
    expect(e.mainFileId).toBeUndefined();
    expect((await fetch(`${base}/api/projects/nope/evidence`)).status).toBe(404);
  });

  it('lists occurrences with their sentence; references without PDF are nao_localizado/sem_pdf', async () => {
    await upload([{ name: 'refs.bib', data: SYNTHETIC_BIB }], 'bib');
    const g = await upload([{ name: 'tese.pdf', data: mainPdf(), type: 'application/pdf' }], 'main');
    const e = await evidence();
    expect(e.mainFileId).toBe(Object.values(g.files).find((f) => f.role === 'main')!.id);
    const q = e.occurrences.find((o) => o.publicationId === 'pub:bib:quintana2020')!;
    expect(q.sentence).toContain('Gradient lattices improve');
    expect(q.marker).toMatch(/QUINTANA/i);
    expect(q.page).toBe(1);
    expect(q.status).toBe('nao_localizado');
    expect(q.reason).toBe('sem_pdf');
    expect(e.summary.semPdf).toBeGreaterThan(0);
    expect(e.summary.localizado).toBe(0);
  });

  it('recomputes when a reference PDF is added (page + passage), and again when it is removed', async () => {
    const g = await upload([{ name: 'quintana.pdf', data: quintanaPdf(), type: 'application/pdf' }], 'reference');
    const refFile = Object.values(g.files).find((f) => f.role === 'reference')!;
    const e = await evidence();
    const q = e.occurrences.find((o) => o.publicationId === 'pub:bib:quintana2020')!;
    expect(q.status).toBe('localizado');
    expect(q.referenceFileId).toBe(refFile.id);
    expect(q.passages[0]).toMatchObject({ fileId: refFile.id, page: 1, region: 'corpo' });
    expect(q.passages[0].text).toContain('12.5 percent');
    expect(e.summary.localizado).toBeGreaterThanOrEqual(1);

    // the passage can be opened in the viewer through the anchor endpoint (integrity-checked)
    const t = await (await post(`/api/projects/${pid}/anchor`, JSON.stringify({ fileId: refFile.id, page: q.passages[0].page, text: q.passages[0].text }), { 'Content-Type': 'application/json' })).json();
    expect(t).toMatchObject({ ok: true, page: 1 });

    const after = await (await fetch(`${base}/api/projects/${pid}/files/${refFile.id}`, { method: 'DELETE' })).json();
    expect(after.projectId).toBe(pid);
    const e2 = await evidence();
    expect(e2.occurrences.find((o) => o.publicationId === 'pub:bib:quintana2020')!.reason).toBe('sem_pdf');
    // re-add for the next tests
    await upload([{ name: 'quintana.pdf', data: quintanaPdf(), type: 'application/pdf' }], 'reference');
  });

  it('persists evidence on disk and serves it from a fresh server instance', async () => {
    expect(await fs.stat(path.join(tmp, 'projects', pid, 'evidence.json'))).toBeTruthy();
    const { store } = createApp({ dataDir: tmp, externalMetadata: false });
    const fresh = await store.getEvidence(pid);
    expect(fresh.occurrences.length).toBe((await evidence()).occurrences.length);
  });

  it('rebuild keeps the evidence consistent', async () => {
    const before = await evidence();
    await post(`/api/projects/${pid}/rebuild`);
    const after = await evidence();
    expect(after.summary).toEqual(before.summary);
    expect(after.occurrences.map((o) => [o.id, o.status])).toEqual(before.occurrences.map((o) => [o.id, o.status]));
  });

  it('shared export removes text from private files; the full export (local) keeps it', async () => {
    const shared = await (await fetch(`${base}/api/projects/${pid}/export/evidence`)).text();
    expect(shared).not.toContain(SECRET);
    expect(shared).not.toContain('Gradient lattices improve');
    const parsed = JSON.parse(shared) as EvidenceReport;
    expect(parsed.occurrences.length).toBeGreaterThan(0);
    expect(parsed.occurrences.some((o) => o.status === 'localizado')).toBe(true);
    const full = await (await fetch(`${base}/api/projects/${pid}/export/evidence?full=1`)).text();
    expect(full).toContain('Gradient lattices improve');
  });
});
