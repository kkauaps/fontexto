/**
 * Command-line ingestion. Files are registered BY PATH (not copied), so
 * private/copyrighted PDFs stay where they are and are never modified.
 *
 *   npm run ingest -- --project my-tcc --name "My TCC" \
 *       --bib refs.bib --main tcc.pdf --refs "path/to/articles" [--shareable]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { ProjectStore } from './store.js';

function parseArgs(argv: string[]) {
  const out: Record<string, string[]> = {};
  let key = '';
  for (const a of argv) {
    if (a.startsWith('--')) {
      key = a.slice(2);
      out[key] ??= [];
    } else if (key) out[key].push(a);
  }
  return out;
}

async function findPdfs(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await findPdfs(p)));
    else if (/\.pdf$/i.test(e.name)) out.push(p);
  }
  return out.sort();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = args.project?.[0];
  if (!projectId) {
    console.error('Usage: npm run ingest -- --project <id> [--name <name>] [--bib file.bib] [--main main.pdf] [--refs dir|file ...] [--exclude substring ...] [--shareable] [--data-dir ./data]');
    process.exit(2);
  }
  const store = new ProjectStore(args['data-dir']?.[0] ?? process.env.CITATION_GRAPH_DATA_DIR ?? 'data');
  const visibility = args.shareable ? 'shareable' : 'private';
  try {
    await store.getProject(projectId);
  } catch {
    await store.createProject(args.name?.join(' ') ?? projectId, projectId);
    console.log(`Created project ${projectId}`);
  }
  for (const b of args.bib ?? []) await store.registerExternalFile(projectId, b, 'bibtex', visibility);
  for (const m of args.main ?? []) await store.registerExternalFile(projectId, m, 'main', visibility);
  const excludes = args.exclude ?? [];
  for (const r of args.refs ?? []) {
    const stat = await fs.stat(r);
    const pdfs = stat.isDirectory() ? await findPdfs(r) : [r];
    for (const p of pdfs) {
      if (excludes.some((x) => p.includes(x))) continue;
      await store.registerExternalFile(projectId, p, 'reference', visibility);
    }
  }
  await store.ensureExtracted(projectId, (done, total, name) => {
    if (name) process.stdout.write(`\rExtracting ${done + 1}/${total}: ${name.slice(0, 50).padEnd(50)}`);
  });
  process.stdout.write('\n');
  const g = await store.rebuild(projectId);
  const edges = Object.values(g.edges);
  const count = (pred: (e: (typeof edges)[number]) => boolean) => edges.filter(pred).length;
  console.log(
    JSON.stringify(
      {
        project: projectId,
        publications: Object.values(g.nodes).filter((n) => n.kind === 'publication').length,
        files: Object.keys(g.files).length,
        fileLinks: {
          matched: g.fileLinks.filter((l) => l.status === 'matched').length,
          unmatched: g.fileLinks.filter((l) => l.status === 'unmatched').length,
          ambiguous: g.fileLinks.filter((l) => l.status === 'ambiguous').length,
        },
        cites_confirmed: count((e) => e.kind === 'cites' && e.status === 'confirmed'),
        cites_confirmed_between_articles: count((e) => e.kind === 'cites' && e.status === 'confirmed' && e.source !== 'doc:main'),
        cites_unverified: count((e) => e.kind === 'cites' && e.status === 'unverified'),
        related_to_suggested: count((e) => e.kind === 'related_to'),
        identityReviews: g.identityReviews.length,
        citationIssues: g.citationIssues.length,
        unresolvedReferences: g.unresolvedReferences.length,
        warnings: g.warnings.length,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
