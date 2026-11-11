/**
 * Optional smoke test against a researcher's own local data. Skipped unless
 * the environment points to it; nothing from that data is stored in the repo.
 *
 *   SMOKE_BIB=path/to/refs.bib SMOKE_MAIN=path/to/main.pdf SMOKE_REFS=path/to/articles npm test
 */
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkAnchor } from '../src/core/anchors';
import { ProjectStore } from '../src/server/store';

const bib = process.env.SMOKE_BIB;
const main = process.env.SMOKE_MAIN;
const refs = process.env.SMOKE_REFS;
const enabled = Boolean(bib && existsSync(bib));

async function pdfs(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await pdfs(p)));
    else if (/^artigo\.pdf$|^(?!citacoes).*\.pdf$/i.test(e.name) && !/indice|anotado/i.test(e.name)) out.push(p);
  }
  return out;
}

describe.skipIf(!enabled)('local data smoke test (opt-in)', () => {
  it('builds a graph whose anchors all pass the integrity check', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'citation-smoke-'));
    try {
      const store = new ProjectStore(tmp);
      await store.createProject('smoke', 'smoke');
      await store.registerExternalFile('smoke', bib!, 'bibtex');
      if (main && existsSync(main)) await store.registerExternalFile('smoke', main, 'main');
      if (refs && existsSync(refs)) for (const p of await pdfs(refs)) await store.registerExternalFile('smoke', p, 'reference');
      await store.ensureExtracted('smoke');
      const g = await store.rebuild('smoke');
      const pubs = Object.values(g.nodes).filter((n) => n.kind === 'publication');
      expect(pubs.length).toBeGreaterThan(0);
      for (const e of Object.values(g.edges)) {
        expect(e.provenance.length).toBeGreaterThan(0);
        for (const p of e.provenance) {
          for (const a of [p.referenceAnchor, ...(p.citationAnchors ?? [])]) {
            if (!a) continue;
            const text = await store.getText('smoke', a.fileId);
            expect(checkAnchor(a, g.files[a.fileId], text).valid).toBe(true);
          }
        }
      }
      const cites = Object.values(g.edges).filter((e) => e.kind === 'cites');
      console.log(
        `[smoke] publications=${pubs.length} cites_confirmed=${cites.filter((e) => e.status === 'confirmed').length} ` +
          `cites_unverified=${cites.filter((e) => e.status === 'unverified').length} identityReviews=${g.identityReviews.length} ` +
          `citationIssues=${g.citationIssues.length} fileLinks=${JSON.stringify(g.fileLinks.reduce<Record<string, number>>((m, l) => ((m[l.status] = (m[l.status] ?? 0) + 1), m), {}))}`,
      );
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  }, 300000);
});
