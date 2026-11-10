/**
 * HTTP API. Binds to localhost by default; PDFs are served only to the local
 * UI with `Cache-Control: no-store` and are never published.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { viewerTarget } from '../core/anchors.js';
import type { CategoryRule } from '../core/categories.js';
import { parseCuratedUpload } from '../core/curated.js';
import { redactEvidenceForSharing } from '../core/evidence.js';
import { redactForSharing, toGraphML } from '../core/export.js';
import type { Anchor, FileRole, ReviewAction, Visibility } from '../core/model.js';
import { securityHeaders } from './securityHeaders.js';
import { lookupMany } from './metadata.js';
import { NotFoundError, ProjectStore, ValidationError } from './store.js';

export interface AppConfig {
  dataDir: string;
  /** Server-level switch for external metadata (still needs per-request consent). */
  externalMetadata: boolean;
  /** Built web UI to serve (production). */
  webDir?: string;
  fetchImpl?: typeof fetch;
}

const REVIEW_ACTIONS: ReviewAction[] = ['confirm', 'reject', 'mark_inconclusive', 'flag_contradiction', 'reset'];

type Handler = (req: Request, res: Response) => Promise<unknown>;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};

export function createApp(cfg: AppConfig) {
  const store = new ProjectStore(cfg.dataDir);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  // Same policy as the public site (minus HTTPS-only parts) whenever the UI is served from here.
  if (cfg.webDir) {
    const headers = securityHeaders({ https: false });
    app.use((_req, res, next) => {
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
      next();
    });
  }
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 300 * 1024 * 1024, files: 200 } });

  const pid = (req: Request) => String(req.params.projectId);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, externalMetadataAvailable: cfg.externalMetadata });
  });

  app.get('/api/projects', h(async (_req, res) => res.json(await store.listProjects())));

  app.post(
    '/api/projects',
    h(async (req, res) => {
      const name = String(req.body?.name ?? '').trim();
      if (!name) throw new ValidationError('Project name is required');
      res.status(201).json(await store.createProject(name));
    }),
  );

  app.get(
    '/api/projects/:projectId',
    h(async (req, res) => {
      const meta = await store.getProject(pid(req));
      res.json({ id: meta.id, name: meta.name, createdAt: meta.createdAt, files: Object.values(meta.files).map(publicFileView) });
    }),
  );

  app.delete(
    '/api/projects/:projectId',
    h(async (req, res) => {
      await store.deleteProject(pid(req));
      res.status(204).end();
    }),
  );

  app.get('/api/projects/:projectId/graph', h(async (req, res) => res.json(await store.getGraph(pid(req)))));

  /** Citation occurrences of the main PDF with the evidence found in the reference PDFs (local data, includes text). */
  app.get('/api/projects/:projectId/evidence', h(async (req, res) => res.json(await store.getEvidence(pid(req)))));

  /** Curated evidence (index.html of a previous run, or JSON): replaces the automatic verdict where it pairs up. */
  app.get('/api/projects/:projectId/curated', h(async (req, res) => {
    const c = await store.getCurated(pid(req));
    res.json(c ? { source: c.source, importedAt: c.importedAt, items: c.items.length } : null);
  }));
  app.post(
    '/api/projects/:projectId/curated',
    upload.single('file'),
    h(async (req, res) => {
      const f = req.file;
      if (!f) throw new ValidationError('Nenhum arquivo recebido');
      const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
      let curated;
      try {
        curated = parseCuratedUpload(f.buffer.toString('utf8'), name);
      } catch (err) {
        throw new ValidationError((err as Error).message);
      }
      const out = await store.setCurated(pid(req), curated);
      res.status(201).json({ source: curated.source, items: curated.items.length, applied: out.result?.applied ?? 0, graph: out.graph });
    }),
  );
  app.delete('/api/projects/:projectId/curated', h(async (req, res) => {
    res.json(await store.setCurated(pid(req), undefined).then((o) => o.graph));
  }));

  /** No .bib: build the bibliography from the reference list printed in the article. */
  app.post('/api/projects/:projectId/references/extract', h(async (req, res) => {
    const out = await store.extractReferencesFromMain(pid(req));
    res.json({ ...out, references: out.references.map(({ key, authors, etAl, year, title, doi, style, text }) => ({ key, authors, etAl, year, title, doi, style, text })), graph: await store.getGraph(pid(req)) });
  }));

  app.post('/api/projects/:projectId/rebuild', h(async (req, res) => {
    await store.ensureExtracted(pid(req));
    res.json(await store.rebuild(pid(req)));
  }));

  app.post(
    '/api/projects/:projectId/files',
    upload.array('files'),
    h(async (req, res) => {
      const projectId = pid(req);
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) throw new ValidationError('No files received');
      const role: FileRole = req.body?.role === 'main' ? 'main' : 'reference';
      const visibility: Visibility = req.body?.visibility === 'shareable' ? 'shareable' : 'private';
      const added = [];
      for (const f of files) {
        // Multer decodes names as latin1; restore UTF-8 names (accents).
        const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
        added.push(await store.addFile(projectId, { data: f.buffer, originalName: name, role, visibility }));
      }
      await store.ensureExtracted(projectId);
      const graph = await store.rebuild(projectId);
      res.status(201).json({ added: added.map(publicFileView), graph });
    }),
  );

  app.delete(
    '/api/projects/:projectId/files/:fileId',
    h(async (req, res) => {
      await store.removeFile(pid(req), String(req.params.fileId));
      res.json(await store.getGraph(pid(req)));
    }),
  );

  app.get(
    '/api/projects/:projectId/files/:fileId/pdf',
    h(async (req, res) => {
      const { path: p, record } = await store.resolveFilePath(pid(req), String(req.params.fileId));
      if (record.role === 'bibtex') throw new NotFoundError('Not a PDF');
      if (!existsSync(p)) throw new NotFoundError('The PDF is no longer available at its registered location.');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.sendFile(p);
    }),
  );

  /** Resolves an anchor into a trusted viewer target (page check, text check, rect check). */
  app.post(
    '/api/projects/:projectId/anchor',
    h(async (req, res) => {
      const anchor = req.body as Anchor;
      const projectId = pid(req);
      const meta = await store.getProject(projectId);
      const file = typeof anchor?.fileId === 'string' ? meta.files[anchor.fileId] : undefined;
      const text = file ? await store.getText(projectId, file.id) : undefined;
      res.json(viewerTarget({ ...anchor, page: Number(anchor?.page) }, file, text));
    }),
  );

  app.post(
    '/api/projects/:projectId/decisions/identity',
    h(async (req, res) => {
      const { reviewId, decision } = req.body ?? {};
      if (typeof reviewId !== 'string' || !['same', 'distinct', null].includes(decision)) throw new ValidationError('Invalid identity decision');
      res.json(
        await store.updateDecisions(pid(req), (d) => {
          if (decision === null) delete d.identity[reviewId];
          else d.identity[reviewId] = decision;
        }),
      );
    }),
  );

  app.post(
    '/api/projects/:projectId/decisions/file-link',
    h(async (req, res) => {
      const { fileId, publicationId } = req.body ?? {};
      if (typeof fileId !== 'string' || !(typeof publicationId === 'string' || publicationId === null || publicationId === undefined)) {
        throw new ValidationError('Invalid file link');
      }
      res.json(
        await store.updateDecisions(pid(req), (d) => {
          if (publicationId === undefined) delete d.fileLinks[fileId];
          else d.fileLinks[fileId] = publicationId;
        }),
      );
    }),
  );

  app.post(
    '/api/projects/:projectId/decisions/edge',
    h(async (req, res) => {
      const { edgeId, action, note } = req.body ?? {};
      if (typeof edgeId !== 'string' || !REVIEW_ACTIONS.includes(action)) throw new ValidationError('Invalid edge review');
      const graph = await store.getGraph(pid(req));
      if (!graph.edges[edgeId]) throw new NotFoundError('Edge not found');
      res.json(
        await store.updateDecisions(pid(req), (d) => {
          if (action === 'reset') delete d.edgeReviews[edgeId];
          else d.edgeReviews[edgeId] = [...(d.edgeReviews[edgeId] ?? []), { action, note: typeof note === 'string' ? note.slice(0, 2000) : undefined, at: new Date().toISOString() }];
        }),
      );
    }),
  );

  app.post(
    '/api/projects/:projectId/decisions/category',
    h(async (req, res) => {
      const { publicationId, category } = req.body ?? {};
      if (typeof publicationId !== 'string' || !(typeof category === 'string' || category === null || category === undefined)) {
        throw new ValidationError('Invalid category');
      }
      res.json(
        await store.updateDecisions(pid(req), (d) => {
          if (category === undefined) delete d.categories[publicationId];
          else d.categories[publicationId] = category === null ? null : category.slice(0, 120);
        }),
      );
    }),
  );

  app.get('/api/projects/:projectId/categories', h(async (req, res) => res.json(await store.getCategoryRules(pid(req)))));
  app.put(
    '/api/projects/:projectId/categories',
    h(async (req, res) => {
      const rules = req.body as CategoryRule[];
      if (!Array.isArray(rules) || !rules.every((r) => typeof r?.name === 'string' && Array.isArray(r.keywords))) {
        throw new ValidationError('Invalid category rules');
      }
      res.json(await store.setCategoryRules(pid(req), rules));
    }),
  );

  app.post(
    '/api/projects/:projectId/metadata/enrich',
    h(async (req, res) => {
      if (!cfg.externalMetadata) {
        res.status(403).json({ error: 'External metadata lookup is disabled on this server (set CITATION_GRAPH_EXTERNAL_METADATA=on).' });
        return;
      }
      if (req.body?.consent !== true) {
        res.status(400).json({ error: 'Explicit consent is required. Only DOIs are sent to OpenAlex.' });
        return;
      }
      const projectId = pid(req);
      const graph = await store.getGraph(projectId);
      const dois = Object.values(graph.nodes).flatMap((n) => (n.kind === 'publication' && n.doi ? [n.doi] : []));
      const found = await lookupMany(dois, { enabled: true, fetchImpl: cfg.fetchImpl });
      await store.setExternalMetadata(projectId, { ...(await store.getExternalMetadata(projectId)), ...found });
      res.json({ looked_up: dois.length, found: Object.keys(found).length, graph: await store.rebuild(projectId) });
    }),
  );

  app.get(
    '/api/projects/:projectId/export/graphml',
    h(async (req, res) => {
      const graph = await store.getGraph(pid(req));
      res.setHeader('Content-Type', 'application/graphml+xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${pid(req)}.graphml"`);
      res.send(toGraphML(graph));
    }),
  );

  app.get(
    '/api/projects/:projectId/export/json',
    h(async (req, res) => {
      const graph = await store.getGraph(pid(req));
      res.setHeader('Content-Disposition', `attachment; filename="${pid(req)}.citation-graph.json"`);
      res.json(req.query.full === '1' ? graph : redactForSharing(graph));
    }),
  );

  app.get(
    '/api/projects/:projectId/export/evidence',
    h(async (req, res) => {
      const projectId = pid(req);
      const [evidence, graph] = await Promise.all([store.getEvidence(projectId), store.getGraph(projectId)]);
      res.setHeader('Content-Disposition', `attachment; filename="${projectId}.evidence.json"`);
      res.json(req.query.full === '1' ? evidence : redactEvidenceForSharing(evidence, graph.files));
    }),
  );

  if (cfg.webDir && existsSync(cfg.webDir)) {
    const webDir = path.resolve(cfg.webDir);
    app.use(express.static(webDir, { index: 'index.html' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(webDir, 'index.html')));
  }

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
    console.error(err);
    return res.status(500).json({ error: 'Internal error' });
  });

  return { app, store };
}

function publicFileView(f: { id: string; originalName: string; role: string; visibility: string; pageCount?: number; extraction: unknown; addedAt: string; storage: { kind: string } }) {
  return { id: f.id, originalName: f.originalName, role: f.role, visibility: f.visibility, pageCount: f.pageCount, extraction: f.extraction, addedAt: f.addedAt, storage: f.storage.kind };
}
