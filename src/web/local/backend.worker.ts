/// <reference lib="webworker" />
/**
 * Browser edition backend. Runs in a Web Worker: pdf.js text extraction, bibliography/reference parsing, graph
 * building, citation matching and storage (IndexedDB). Nothing is sent to any server.
 */
import * as pdfjs from 'pdfjs-dist';
import * as pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs';
import { viewerTarget } from '../../core/anchors';
import type { CategoryRule } from '../../core/categories';
import { CoreStore, MemoryDriver, NotFoundError, ValidationError, type StorageDriver } from '../../core/coreStore';
import { parseCuratedUpload } from '../../core/curated';
import { redactEvidenceForSharing } from '../../core/evidence';
import { redactForSharing, toGraphML } from '../../core/export';
import { textFromDocument, type PdfDocLike, type PdfJsLike } from '../../core/pdfjsText';
import type { Anchor, FileRecord, FileRole, ReviewAction, Visibility } from '../../core/model';
import { IdbDriver } from './idbDriver';

// pdf.js "fake worker": its parser runs inside this worker (no nested worker, no Trusted Types needed).
(globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = pdfjsWorker;

const origin = self.location.origin;

async function extractText(data: Uint8Array) {
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    verbosity: 0,
    isEvalSupported: false,
    enableXfa: false,
    useSystemFonts: false,
    useWorkerFetch: true,
    disableFontFace: true,
    standardFontDataUrl: `${origin}/pdfjs/standard_fonts/`,
    wasmUrl: `${origin}/pdfjs/wasm/`,
    cMapUrl: `${origin}/pdfjs/cmaps/`,
    cMapPacked: true,
    iccUrl: `${origin}/pdfjs/iccs/`,
  } as Parameters<typeof pdfjs.getDocument>[0]);
  const doc = await task.promise;
  try {
    return await textFromDocument(pdfjs as unknown as PdfJsLike, doc as unknown as PdfDocLike);
  } finally {
    await task.destroy();
  }
}

let persistent = true;
async function makeDriver(): Promise<StorageDriver> {
  try {
    const d = new IdbDriver();
    await d.listProjects();
    return d;
  } catch {
    persistent = false;
    return new MemoryDriver();
  }
}
const storePromise = makeDriver().then((driver) => new CoreStore({ driver, extractText }));

const view = (f: FileRecord) => ({ id: f.id, originalName: f.originalName, role: f.role, visibility: f.visibility, pageCount: f.pageCount, extraction: f.extraction, addedAt: f.addedAt, storage: 'managed' as const });
const REVIEW_ACTIONS: ReviewAction[] = ['confirm', 'reject', 'mark_inconclusive', 'flag_contradiction', 'reset'];

type Progress = (p: { stage: string; done: number; total: number; name?: string }) => void;
type Method = (s: CoreStore, args: any[], progress: Progress) => Promise<unknown>;

const methods: Record<string, Method> = {
  health: async () => ({ ok: true, externalMetadataAvailable: false, edition: 'web', persistent }),
  listProjects: (s) => s.listProjects(),
  createProject: (s, [name]) => s.createProject(String(name ?? '')),
  deleteProject: async (s, [p]) => void (await s.deleteProject(p)),
  project: async (s, [p]) => {
    const m = await s.getProject(p);
    return { id: m.id, name: m.name, createdAt: m.createdAt, files: Object.values(m.files).map(view) };
  },
  graph: (s, [p]) => s.getGraph(p),
  rebuild: async (s, [p], progress) => {
    await s.ensureExtracted(p, (done, total, name) => progress({ stage: 'extract', done, total, name }));
    return s.rebuild(p);
  },
  upload: async (s, [p, files, role, visibility], progress) => {
    if (!Array.isArray(files) || files.length === 0) throw new ValidationError('No files received');
    const r: FileRole = role === 'main' ? 'main' : 'reference';
    const v: Visibility = visibility === 'shareable' ? 'shareable' : 'private';
    const added: FileRecord[] = [];
    for (const f of files as File[]) added.push(await s.addFile(p, { data: new Uint8Array(await f.arrayBuffer()), originalName: f.name, role: r, visibility: v }));
    await s.ensureExtracted(p, (done, total, name) => progress({ stage: 'extract', done, total, name }));
    const graph = await s.rebuild(p);
    return { added: added.map(view), graph };
  },
  deleteFile: async (s, [p, fileId]) => {
    await s.removeFile(p, fileId);
    return s.getGraph(p);
  },
  pdfBytes: async (s, [p, fileId]) => {
    const { data, record } = await s.getFileBytes(p, fileId);
    if (record.role === 'bibtex') throw new NotFoundError('Not a PDF');
    return data.slice().buffer;
  },
  resolveAnchor: async (s, [p, anchor]) => {
    const a = anchor as Anchor;
    const meta = await s.getProject(p);
    const file = typeof a?.fileId === 'string' ? meta.files[a.fileId] : undefined;
    const text = file ? await s.getText(p, file.id) : undefined;
    return viewerTarget({ ...a, page: Number(a?.page) }, file, text);
  },
  identityDecision: (s, [p, reviewId, decision]) => {
    if (typeof reviewId !== 'string' || !['same', 'distinct', null].includes(decision)) throw new ValidationError('Invalid identity decision');
    return s.updateDecisions(p, (d) => {
      if (decision === null) delete d.identity[reviewId];
      else d.identity[reviewId] = decision;
    });
  },
  fileLink: (s, [p, fileId, publicationId]) => {
    if (typeof fileId !== 'string' || !(typeof publicationId === 'string' || publicationId === null || publicationId === undefined)) throw new ValidationError('Invalid file link');
    return s.updateDecisions(p, (d) => {
      if (publicationId === undefined) delete d.fileLinks[fileId];
      else d.fileLinks[fileId] = publicationId;
    });
  },
  edgeReview: async (s, [p, edgeId, action, note]) => {
    if (typeof edgeId !== 'string' || !REVIEW_ACTIONS.includes(action)) throw new ValidationError('Invalid edge review');
    if (!(await s.getGraph(p)).edges[edgeId]) throw new NotFoundError('Edge not found');
    return s.updateDecisions(p, (d) => {
      if (action === 'reset') delete d.edgeReviews[edgeId];
      else d.edgeReviews[edgeId] = [...(d.edgeReviews[edgeId] ?? []), { action, note: typeof note === 'string' ? note.slice(0, 2000) : undefined, at: new Date().toISOString() }];
    });
  },
  category: (s, [p, publicationId, category]) => {
    if (typeof publicationId !== 'string' || !(typeof category === 'string' || category === null || category === undefined)) throw new ValidationError('Invalid category');
    return s.updateDecisions(p, (d) => {
      if (category === undefined) delete d.categories[publicationId];
      else d.categories[publicationId] = category === null ? null : category.slice(0, 120);
    });
  },
  categories: (s, [p]) => s.getCategoryRules(p),
  setCategories: (s, [p, rules]) => {
    const r = rules as CategoryRule[];
    if (!Array.isArray(r) || !r.every((x) => typeof x?.name === 'string' && Array.isArray(x.keywords))) throw new ValidationError('Invalid category rules');
    return s.setCategoryRules(p, r);
  },
  enrich: async () => {
    throw new ValidationError('A consulta de metadados públicos não existe na versão web: nada sai do seu navegador.');
  },
  evidence: (s, [p]) => s.getEvidence(p),
  extractReferences: async (s, [p]) => {
    const out = await s.extractReferencesFromMain(p);
    return { ...out, references: out.references.map(({ key, authors, etAl, year, title, doi, style, text }) => ({ key, authors, etAl, year, title, doi, style, text })), graph: await s.getGraph(p) };
  },
  curated: async (s, [p]) => {
    const c = await s.getCurated(p);
    return c ? { source: c.source, importedAt: c.importedAt, items: c.items.length } : null;
  },
  importCurated: async (s, [p, file]) => {
    const f = file as File;
    let curated;
    try {
      curated = parseCuratedUpload(await f.text(), f.name);
    } catch (e) {
      throw new ValidationError((e as Error).message);
    }
    const out = await s.setCurated(p, curated);
    return { source: curated.source, items: curated.items.length, applied: out.result?.applied ?? 0, graph: out.graph };
  },
  removeCurated: async (s, [p]) => (await s.setCurated(p, undefined)).graph,
  exportFile: async (s, [p, kind]) => {
    const [graph, evidence] = await Promise.all([s.getGraph(p), s.getEvidence(p)]);
    if (kind === 'graphml') return { name: `${p}.graphml`, mime: 'application/graphml+xml', text: toGraphML(graph) };
    if (kind === 'json') return { name: `${p}.citation-graph.json`, mime: 'application/json', text: JSON.stringify(redactForSharing(graph), null, 1) };
    return { name: `${p}.evidence.json`, mime: 'application/json', text: JSON.stringify(redactEvidenceForSharing(evidence, graph.files), null, 1) };
  },
  semanticTodo: (s, [p]) => s.semanticTodo(p),
  semanticStore: (s, [p, claims, passages]) => s.semanticStore(p, claims, passages),
  semanticStatus: (s, [p]) => s.semanticStatus(p),
  clearSemantic: async (s, [p]) => void (await s.clearSemantic(p)),
};

self.onmessage = async (e: MessageEvent<{ id: number; method: string; args: unknown[] }>) => {
  const { id, method, args } = e.data;
  try {
    const fn = methods[method];
    if (!fn) throw new Error(`Método desconhecido: ${method}`);
    const result = await fn(await storePromise, args, (p) => self.postMessage({ id, progress: p }));
    const transfer = result instanceof ArrayBuffer ? [result] : [];
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (err) {
    const kind = err instanceof NotFoundError ? 'not_found' : err instanceof ValidationError ? 'validation' : 'internal';
    self.postMessage({ id, ok: false, error: kind === 'internal' ? `Erro interno: ${(err as Error).message}` : (err as Error).message, kind });
  }
};
