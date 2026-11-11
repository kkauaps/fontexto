/** Private-document isolation, persistence and the HTTP API (synthetic data, temp dirs). */
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { REDACTED, redactForSharing, toGraphML } from '../src/core/export';
import type { CitationGraph } from '../src/core/model';
import { createApp } from '../src/server/app';
import { flowText, makePdf } from '../src/server/devtools/syntheticPdf';
import { lookupDoi, lookupMany, openAlexUrl } from '../src/server/metadata';
import { NotFoundError, ProjectStore, ValidationError } from '../src/server/store';
import { SYNTHETIC_BIB } from './helpers/fixtures';

const SECRET = 'UNPUBLISHED-SECRET-FINDING';

function articlePdf(title: string, authors: string, doi: string, refs: string[]) {
  return makePdf(
    flowText([
      { text: title, size: 14 },
      { text: authors, gapBefore: 4 },
      { text: `doi: ${doi}` },
      { text: `Body. ${SECRET} appears only in this private body text.`, gapBefore: 8 },
      { text: 'References', size: 12, gapBefore: 12 },
      ...refs.map((r, i) => ({ text: `[${i + 1}] ${r}`, gapBefore: 3 })),
    ]),
    { title },
  );
}

const quintanaPdf = () =>
  articlePdf('Gradient Lattices for Tissue Boundary Estimation', 'Aurelio Quintana, Maja Brandt', '10.99999/synth.2020.001', [
    `Albrecht H, Moreau L. A benchmark of imaginary segmentation networks. ${SECRET}. 2018. doi:10.99999/synth.2018.042`,
  ]);

let tmp: string;
beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'citation-graph-test-'));
});
afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('private document isolation', () => {
  let graph: CitationGraph;
  let store: ProjectStore;

  beforeAll(async () => {
    store = new ProjectStore(path.join(tmp, 'iso'));
    await store.createProject('Private', 'private-a');
    await store.createProject('Other', 'other-b');
    await store.addFile('private-a', { data: Buffer.from(SYNTHETIC_BIB), originalName: 'refs.bib' });
    await store.addFile('private-a', { data: quintanaPdf(), originalName: 'my-unpublished-thesis-draft.pdf' });
    await store.ensureExtracted('private-a');
    graph = await store.rebuild('private-a');
  });

  it('files are private by default', () => {
    expect(Object.values(graph.files).every((f) => f.visibility === 'private')).toBe(true);
  });

  it('the local graph keeps provenance text, the shared export does not', () => {
    expect(JSON.stringify(graph)).toContain(SECRET);
    const shared = JSON.stringify(redactForSharing(graph));
    expect(shared).not.toContain(SECRET);
    expect(shared).not.toContain('my-unpublished-thesis-draft');
    expect(shared).not.toContain(tmp.replace(/\\/g, '\\\\'));
    expect(shared).toContain(REDACTED);
    // Public bibliographic metadata is still there.
    expect(shared).toContain('Gradient Lattices for Tissue Boundary Estimation');
  });

  it('GraphML export never contains private text', () => {
    const xml = toGraphML(graph);
    expect(xml).not.toContain(SECRET);
    expect(xml).not.toContain('my-unpublished');
  });

  it('projects cannot read each other’s files and ids cannot traverse paths', async () => {
    const fileId = Object.values(graph.files).find((f) => f.role === 'reference')!.id;
    await expect(store.resolveFilePath('private-a', fileId)).resolves.toBeTruthy();
    await expect(store.resolveFilePath('other-b', fileId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(store.resolveFilePath('private-a', '../other-b/project.json')).rejects.toBeInstanceOf(NotFoundError);
    expect(() => store.projectDir('../etc')).toThrow(ValidationError);
    expect(() => store.projectDir('a/b')).toThrow(ValidationError);
  });

  it('external metadata lookup is off by default and never sends private content', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ title: 'Public title', publication_year: 2020 }), { status: 200 }));
    expect(await lookupDoi('10.99999/synth.2020.001', { enabled: false, fetchImpl })).toBeUndefined();
    expect(await lookupMany(['10.99999/a'], { enabled: false, fetchImpl })).toEqual({});
    expect(fetchImpl).not.toHaveBeenCalled();

    const r = await lookupDoi('https://doi.org/10.99999/SYNTH.2020.001', { enabled: true, fetchImpl });
    expect(r).toMatchObject({ source: 'openalex', title: 'Public title', year: 2020 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const calls = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    const [url, init] = calls[0];
    expect(url).toBe(openAlexUrl('10.99999/synth.2020.001'));
    expect(url).not.toMatch(/title|search|filter/);
    expect(init.body).toBeUndefined();
  });

  it('deleting a file removes the stored copy and derived text', async () => {
    const meta = await store.getProject('private-a');
    const f = Object.values(meta.files).find((x) => x.role === 'reference')!;
    const { path: stored } = await store.resolveFilePath('private-a', f.id);
    const derived = path.join(store.projectDir('private-a'), 'derived', `${f.id}.text.json`);
    expect(existsSync(stored) && existsSync(derived)).toBe(true);
    await store.removeFile('private-a', f.id);
    expect(existsSync(stored)).toBe(false);
    expect(existsSync(derived)).toBe(false);
    const g = await store.getGraph('private-a');
    expect(JSON.stringify(g)).not.toContain(SECRET);
  });

  it('removing an externally registered file never deletes the original', async () => {
    const original = path.join(tmp, 'external-original.pdf');
    await fs.writeFile(original, quintanaPdf());
    const rec = await store.registerExternalFile('other-b', original, 'reference');
    await store.ensureExtracted('other-b');
    await store.removeFile('other-b', rec.id);
    expect(existsSync(original)).toBe(true);
    await store.deleteProject('other-b');
    expect(existsSync(original)).toBe(true);
    expect(existsSync(path.join(store.root, 'other-b'))).toBe(false);
  });
});

describe('persistence and HTTP API', () => {
  let base: string;
  let close: () => void;
  const dataDir = () => path.join(tmp, 'api');

  beforeAll(async () => {
    const { app } = createApp({ dataDir: dataDir(), externalMetadata: false });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });
  afterAll(() => close());

  it('uploads, builds, persists, and serves the graph without reprocessing', async () => {
    const created = await (await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Synthetic TCC' }) })).json();
    const pid = created.id as string;
    const fd = new FormData();
    fd.append('files', new Blob([SYNTHETIC_BIB]), 'refs.bib');
    fd.append('files', new Blob([new Uint8Array(quintanaPdf())], { type: 'application/pdf' }), 'quintana.pdf');
    const up = await fetch(`${base}/api/projects/${pid}/files`, { method: 'POST', body: fd });
    expect(up.status).toBe(201);
    const { graph } = (await up.json()) as { graph: CitationGraph };
    const edgeId = 'cites:pub:bib:quintana2020->pub:bib:albrecht2018';
    expect(graph.edges[edgeId].status).toBe('confirmed');

    // Persisted on disk; text cache exists and is reused.
    const projectDir = path.join(dataDir(), 'projects', pid);
    expect(existsSync(path.join(projectDir, 'graph.json'))).toBe(true);
    const derivedFiles = await fs.readdir(path.join(projectDir, 'derived'));
    const derivedPath = path.join(projectDir, 'derived', derivedFiles[0]);
    const before = (await fs.stat(derivedPath)).mtimeMs;

    // A new server instance reads the stored graph.
    const { store } = createApp({ dataDir: dataDir(), externalMetadata: false });
    expect((await store.getGraph(pid)).edges[edgeId].status).toBe('confirmed');

    // Researcher decision is persisted and re-applied after rebuild.
    const rev = await fetch(`${base}/api/projects/${pid}/decisions/edge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ edgeId, action: 'reject', note: 'cited to criticize' }),
    });
    expect(((await rev.json()) as CitationGraph).edges[edgeId].status).toBe('rejected');
    const rebuilt = (await (await fetch(`${base}/api/projects/${pid}/rebuild`, { method: 'POST' })).json()) as CitationGraph;
    expect(rebuilt.edges[edgeId].status).toBe('rejected');
    expect((await fs.stat(derivedPath)).mtimeMs).toBe(before);

    // PDF is served locally, no caching.
    const fileId = Object.values(graph.files).find((f) => f.role === 'reference')!.id;
    const pdf = await fetch(`${base}/api/projects/${pid}/files/${fileId}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('cache-control')).toBe('no-store');

    // Anchor resolution goes through the integrity check.
    const anchor = rebuilt.edges[edgeId].provenance[0].referenceAnchor!;
    const t = await (await fetch(`${base}/api/projects/${pid}/anchor`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(anchor) })).json();
    expect(t).toMatchObject({ ok: true, page: anchor.page, exactHighlight: true });
    const bad = await (await fetch(`${base}/api/projects/${pid}/anchor`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...anchor, page: 99 }) })).json();
    expect(bad).toMatchObject({ ok: false, reason: 'invalid_page' });

    // Shared JSON export is redacted by default.
    const shared = await (await fetch(`${base}/api/projects/${pid}/export/json`)).text();
    expect(shared).not.toContain(SECRET);

    // External metadata is refused when the server has not enabled it.
    const enrich = await fetch(`${base}/api/projects/${pid}/metadata/enrich`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consent: true }) });
    expect(enrich.status).toBe(403);
  });

  it('rejects non-PDF uploads disguised as PDFs and unknown projects', async () => {
    const created = await (await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }) })).json();
    const fd = new FormData();
    fd.append('files', new Blob(['<html>not a pdf</html>']), 'fake.pdf');
    expect((await fetch(`${base}/api/projects/${created.id}/files`, { method: 'POST', body: fd })).status).toBe(400);
    expect((await fetch(`${base}/api/projects/does-not-exist/graph`)).status).toBe(404);
    expect((await fetch(`${base}/api/projects/..%2F..%2Fetc/graph`)).status).toBe(400);
  });
});
