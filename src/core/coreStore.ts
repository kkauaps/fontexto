/**
 * Platform-neutral project store used by the browser edition (Web Worker + IndexedDB) and by tests.
 * It mirrors the behaviour of the Node `ProjectStore` (same graph, same evidence, same decisions) on top of a small
 * key/value + bytes `StorageDriver`, and uses nothing but Web APIs (Web Crypto, TextDecoder).
 */
import { parseBibtex } from './bibtex.js';
import type { CategoryRule } from './categories.js';
import { applyCurated, type CuratedApplyResult, type CuratedFile } from './curated.js';
import { applyOverrides, computeEvidence, reapplyOverrides, EVIDENCE_PARAMS, type EvidenceReport, type EvidenceStatus, type PendingMatch, type ReferenceIndex } from './evidence.js';
import { emptyDecisions, type CitationGraph, type FileRecord, type FileRole, type UserDecisions, type Visibility } from './model.js';
import { buildGraph, type ExternalMetadata } from './pipeline.js';
import { extractReferenceEntries } from './references.js';
import { parseReferences, toBibtex, type ParsedReference } from './refparse.js';
import { applySemantic, planSemantic, type SemanticPlan } from './semantic.js';
import type { PdfText } from './text.js';
import { DEFAULT_CATEGORY_RULES } from '../server/defaults.js';

export interface StorageDriver {
  getJson<T>(project: string, name: string): Promise<T | undefined>;
  putJson(project: string, name: string, data: unknown): Promise<void>;
  getBytes(project: string, name: string): Promise<Uint8Array | undefined>;
  putBytes(project: string, name: string, data: Uint8Array): Promise<void>;
  remove(project: string, name: string): Promise<void>;
  removeProject(project: string): Promise<void>;
  listProjects(): Promise<string[]>;
}

/** In-memory driver (tests, and a fallback when IndexedDB is unavailable, e.g. private windows of some browsers). */
export class MemoryDriver implements StorageDriver {
  private json = new Map<string, unknown>();
  private bytes = new Map<string, Uint8Array>();
  private k = (p: string, n: string) => `${p}/${n}`;
  async getJson<T>(p: string, n: string) {
    const v = this.json.get(this.k(p, n));
    return v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as T);
  }
  async putJson(p: string, n: string, d: unknown) {
    this.json.set(this.k(p, n), JSON.parse(JSON.stringify(d)));
  }
  async getBytes(p: string, n: string) {
    return this.bytes.get(this.k(p, n));
  }
  async putBytes(p: string, n: string, d: Uint8Array) {
    this.bytes.set(this.k(p, n), d);
  }
  async remove(p: string, n: string) {
    this.json.delete(this.k(p, n));
    this.bytes.delete(this.k(p, n));
  }
  async removeProject(p: string) {
    for (const m of [this.json, this.bytes]) for (const key of [...m.keys()]) if (key.startsWith(`${p}/`)) m.delete(key);
  }
  async listProjects() {
    return [...new Set([...this.json.keys()].filter((k) => k.endsWith('/project.json')).map((k) => k.split('/')[0]))];
  }
}

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  files: Record<string, FileRecord>;
}

export const GENERATED_BIB = 'referencias-extraidas.bib';

export class NotFoundError extends Error {}
export class ValidationError extends Error {}

const PROJECT_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FILE_ID_RE = /^f_[a-f0-9]{12}$/;

const randomHex = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
async function sha256(data: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'project';
const baseName = (n: string) => n.replace(/^.*[\\/]/, '').slice(0, 255);
const kindOf = (name: string): 'pdf' | 'bib' | undefined => (/\.pdf$/i.test(name) ? 'pdf' : /\.(bib|bibtex)$/i.test(name) ? 'bib' : undefined);

/** FNV-1a (two seeds) of a text: cache key of an embedding. Not a security hash. */
export function textKey(t: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ t.length;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619) >>> 0;
    b = Math.imul(b + c, 2246822519) >>> 0;
  }
  return a.toString(36) + b.toString(36);
}

export interface CoreStoreOptions {
  driver: StorageDriver;
  extractText: (data: Uint8Array, onProgress?: (p: { stage: string; done: number; total: number; name?: string }) => void) => Promise<PdfText>;
}

/** Embeddings of texts, kept per project so rebuilds stay semantic without loading the model again. */
interface VectorCache {
  dim: number;
  keys: string[];
}

export class CoreStore {
  private d: StorageDriver;
  private extractText: CoreStoreOptions['extractText'];
  private locks = new Map<string, Promise<unknown>>();
  private refIndexCache = new Map<string, ReferenceIndex>();
  /** Lexical report (before curation / semantic) and candidates of the last build, per project (memory only). */
  private staged = new Map<string, { report: EvidenceReport; pendings: Map<string, PendingMatch>; graph: CitationGraph }>();

  constructor(opts: CoreStoreOptions) {
    this.d = opts.driver;
    this.extractText = opts.extractText;
  }

  private async withLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(projectId) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(fn);
    this.locks.set(projectId, run);
    try {
      return await run;
    } finally {
      if (this.locks.get(projectId) === run) this.locks.delete(projectId);
    }
  }

  private check(projectId: string) {
    if (!PROJECT_ID_RE.test(projectId)) throw new ValidationError('Invalid project id');
    return projectId;
  }

  async listProjects(): Promise<Pick<ProjectMeta, 'id' | 'name' | 'createdAt'>[]> {
    const out: Pick<ProjectMeta, 'id' | 'name' | 'createdAt'>[] = [];
    for (const id of await this.d.listProjects()) {
      const m = await this.d.getJson<ProjectMeta>(id, 'project.json');
      if (m) out.push({ id: m.id, name: m.name, createdAt: m.createdAt });
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createProject(name: string, id?: string): Promise<ProjectMeta> {
    const pid = this.check(id ?? `${slug(name)}-${randomHex(3)}`);
    if (await this.d.getJson(pid, 'project.json')) throw new ValidationError('Project already exists');
    const meta: ProjectMeta = { id: pid, name: name.trim() || pid, createdAt: new Date().toISOString(), files: {} };
    await this.d.putJson(pid, 'project.json', meta);
    await this.d.putJson(pid, 'categories.json', DEFAULT_CATEGORY_RULES);
    return meta;
  }

  async getProject(projectId: string): Promise<ProjectMeta> {
    const meta = await this.d.getJson<ProjectMeta>(this.check(projectId), 'project.json');
    if (!meta) throw new NotFoundError('Project not found');
    return meta;
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.getProject(projectId);
    await this.withLock(projectId, () => this.d.removeProject(projectId));
    this.staged.delete(projectId);
  }

  async addFile(projectId: string, input: { data: Uint8Array; originalName: string; role?: FileRole; visibility?: Visibility }): Promise<FileRecord> {
    return this.withLock(projectId, async () => {
      const meta = await this.getProject(projectId);
      const kind = kindOf(input.originalName);
      if (!kind) throw new ValidationError('Only .pdf and .bib files are accepted');
      if (kind === 'pdf' && String.fromCharCode(...input.data.subarray(0, 5)) !== '%PDF-') throw new ValidationError('File is not a PDF');
      const role: FileRole = kind === 'bib' ? 'bibtex' : input.role === 'main' ? 'main' : 'reference';
      const hash = await sha256(input.data);
      const dup = Object.values(meta.files).find((f) => f.sha256 === hash && f.role === role);
      if (dup) return dup;
      if (role === 'main' && Object.values(meta.files).some((f) => f.role === 'main')) throw new ValidationError('A main document already exists; delete it first.');
      const id = `f_${randomHex(6)}`;
      const relPath = `files/${id}${kind === 'pdf' ? '.pdf' : '.bib'}`;
      await this.d.putBytes(projectId, relPath, input.data);
      const rec: FileRecord = {
        id,
        sha256: hash,
        originalName: baseName(input.originalName),
        role,
        visibility: input.visibility ?? 'private',
        storage: { kind: 'managed', relPath },
        addedAt: new Date().toISOString(),
        extraction: { status: kind === 'pdf' ? 'pending' : 'ok' },
      };
      meta.files[id] = rec;
      await this.d.putJson(projectId, 'project.json', meta);
      return rec;
    });
  }

  async getFileBytes(projectId: string, fileId: string): Promise<{ data: Uint8Array; record: FileRecord }> {
    if (!FILE_ID_RE.test(fileId)) throw new NotFoundError('File not found');
    const rec = (await this.getProject(projectId)).files[fileId];
    if (!rec || rec.storage.kind !== 'managed') throw new NotFoundError('File not found');
    const data = await this.d.getBytes(projectId, rec.storage.relPath);
    if (!data) throw new NotFoundError('The file is no longer available.');
    return { data, record: rec };
  }

  async removeFile(projectId: string, fileId: string): Promise<void> {
    if (!FILE_ID_RE.test(fileId)) throw new NotFoundError('File not found');
    await this.withLock(projectId, async () => {
      const meta = await this.getProject(projectId);
      const rec = meta.files[fileId];
      if (!rec) throw new NotFoundError('File not found');
      if (rec.storage.kind === 'managed') await this.d.remove(projectId, rec.storage.relPath);
      await this.d.remove(projectId, `derived/${fileId}.text.json`);
      delete meta.files[fileId];
      await this.d.putJson(projectId, 'project.json', meta);
      const dec = await this.getDecisions(projectId);
      delete dec.fileLinks[fileId];
      await this.d.putJson(projectId, 'decisions.json', dec);
    });
    await this.rebuild(projectId);
  }

  async getText(projectId: string, fileId: string): Promise<PdfText | undefined> {
    if (!FILE_ID_RE.test(fileId)) throw new ValidationError('Invalid file id');
    return this.d.getJson<PdfText>(projectId, `derived/${fileId}.text.json`);
  }

  async ensureExtracted(projectId: string, onProgress?: (done: number, total: number, name: string) => void): Promise<void> {
    const meta = await this.getProject(projectId);
    const pending: FileRecord[] = [];
    for (const f of Object.values(meta.files)) if (f.role !== 'bibtex' && (f.extraction.status === 'pending' || !(await this.getText(projectId, f.id)))) pending.push(f);
    let done = 0;
    for (const f of pending) {
      onProgress?.(done, pending.length, f.originalName);
      let status: FileRecord['extraction'] = { status: 'ok' };
      let pageCount: number | undefined;
      try {
        const { data } = await this.getFileBytes(projectId, f.id);
        const text = await this.extractText(data, (p) => onProgress?.(done, pending.length, p.name ? `${f.originalName} · ${p.name}` : f.originalName));
        pageCount = text.pageCount;
        const chars = text.pages.reduce((n, pg) => n + pg.lines.reduce((m, l) => m + l.text.length, 0), 0);
        if (chars < 20) status = { status: 'no_text', error: 'Não foi possível reconhecer texto neste arquivo (PDF digitalizado ou imagem).' };
        await this.d.putJson(projectId, `derived/${f.id}.text.json`, text);
      } catch (err) {
        status = { status: 'failed', error: (err as Error).message.slice(0, 300) };
      }
      await this.withLock(projectId, async () => {
        const m = await this.getProject(projectId);
        if (!m.files[f.id]) return;
        m.files[f.id].extraction = status;
        if (pageCount !== undefined) m.files[f.id].pageCount = pageCount;
        await this.d.putJson(projectId, 'project.json', m);
      });
      done++;
    }
    onProgress?.(done, pending.length, '');
  }

  async getDecisions(projectId: string): Promise<UserDecisions> {
    return { ...emptyDecisions(), ...((await this.d.getJson<Partial<UserDecisions>>(projectId, 'decisions.json')) ?? {}) };
  }

  async updateDecisions(projectId: string, fn: (d: UserDecisions) => void): Promise<CitationGraph> {
    await this.withLock(projectId, async () => {
      const dec = await this.getDecisions(projectId);
      fn(dec);
      await this.d.putJson(projectId, 'decisions.json', dec);
    });
    return this.rebuild(projectId);
  }

  /**
   * The researcher's own label of one citation (null = back to automatic). Only the stored report is
   * updated: the match itself does not change, so no rebuild (instant even with many PDFs).
   */
  async setEvidenceLabel(projectId: string, occId: string, status: EvidenceStatus | null): Promise<EvidenceReport> {
    const done = await this.withLock(projectId, async () => {
      const dec = await this.getDecisions(projectId);
      dec.evidence ??= {};
      if (status === null) delete dec.evidence[occId];
      else dec.evidence[occId] = { status, at: new Date().toISOString() };
      await this.d.putJson(projectId, 'decisions.json', dec);
      const ev = await this.d.getJson<EvidenceReport>(projectId, 'evidence.json');
      if (!ev) return undefined;
      const next = reapplyOverrides(ev, dec.evidence);
      await this.d.putJson(projectId, 'evidence.json', next);
      return next;
    });
    return done ?? this.getEvidence(projectId);
  }

  async getCategoryRules(projectId: string): Promise<CategoryRule[]> {
    return (await this.d.getJson<CategoryRule[]>(projectId, 'categories.json')) ?? DEFAULT_CATEGORY_RULES;
  }

  async setCategoryRules(projectId: string, rules: CategoryRule[]): Promise<CitationGraph> {
    await this.d.putJson(projectId, 'categories.json', rules);
    return this.rebuild(projectId);
  }

  async rebuild(projectId: string): Promise<CitationGraph> {
    return this.withLock(projectId, async () => {
      const meta = await this.getProject(projectId);
      const bib: { fileId: string; entries: ReturnType<typeof parseBibtex>['entries'] }[] = [];
      const texts: Record<string, PdfText> = {};
      const warnings: string[] = [];
      for (const f of Object.values(meta.files)) {
        if (f.role === 'bibtex') {
          try {
            const { data } = await this.getFileBytes(projectId, f.id);
            const parsed = parseBibtex(new TextDecoder('utf-8').decode(data));
            bib.push({ fileId: f.id, entries: parsed.entries });
            for (const e of parsed.errors) warnings.push(`${f.originalName}:${e.line}: ${e.message}`);
          } catch (err) {
            warnings.push(`Could not read ${f.originalName}: ${(err as Error).message}`);
          }
        } else if (f.extraction.status === 'ok') {
          const t = await this.getText(projectId, f.id);
          if (t) texts[f.id] = t;
        }
      }
      const graph = buildGraph({
        projectId,
        now: new Date().toISOString(),
        files: meta.files,
        bib,
        texts,
        decisions: await this.getDecisions(projectId),
        categoryRules: await this.getCategoryRules(projectId),
        externalMetadata: {} as Record<string, ExternalMetadata>,
      });
      graph.warnings.unshift(...warnings);
      await this.d.putJson(projectId, 'graph.json', graph);
      const pendings = new Map<string, PendingMatch>();
      const report = computeEvidence({ projectId, now: graph.builtAt, graph, texts, cache: this.refIndexCache, onPending: (pm) => pendings.set(pm.occId, pm) });
      this.staged.set(projectId, { report, pendings, graph });
      let evidence = await this.applyCachedSemantic(projectId, report, pendings, graph);
      const curated = await this.getCurated(projectId);
      if (curated) evidence = applyCurated(graph, evidence, curated).report;
      evidence = applyOverrides(evidence, (await this.getDecisions(projectId)).evidence);
      await this.d.putJson(projectId, 'evidence.json', evidence);
      return graph;
    });
  }

  // ---- semantic re-rank (embeddings computed by the caller, cached here) --------------------------------------

  private async loadVectors(projectId: string): Promise<Map<string, Float32Array> | undefined> {
    const idx = await this.d.getJson<VectorCache>(projectId, 'semantic.json');
    const raw = idx ? await this.d.getBytes(projectId, 'semantic.vec') : undefined;
    if (!idx || !raw) return undefined;
    const all = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    const m = new Map<string, Float32Array>();
    idx.keys.forEach((k, i) => m.set(k, all.subarray(i * idx.dim, (i + 1) * idx.dim)));
    return m;
  }

  private async saveVectors(projectId: string, vectors: Map<string, Float32Array>) {
    const keys = [...vectors.keys()];
    const dim = keys.length ? (vectors.get(keys[0]) as Float32Array).length : 0;
    const all = new Float32Array(keys.length * dim);
    keys.forEach((k, i) => all.set(vectors.get(k) as Float32Array, i * dim));
    await this.d.putBytes(projectId, 'semantic.vec', new Uint8Array(all.buffer));
    await this.d.putJson(projectId, 'semantic.json', { dim, keys } satisfies VectorCache);
  }

  private planFor(staged: { report: EvidenceReport; pendings: Map<string, PendingMatch> }) {
    return planSemantic(staged.pendings.values(), new Map(staged.report.occurrences.map((o) => [o.id, o])));
  }

  /** Uses cached embeddings when every needed text has one; otherwise keeps the lexical result. */
  private async applyCachedSemantic(projectId: string, report: EvidenceReport, pendings: Map<string, PendingMatch>, graph: CitationGraph): Promise<EvidenceReport> {
    const vectors = await this.loadVectors(projectId);
    if (!vectors || pendings.size === 0) return report;
    const plan = this.planFor({ report, pendings });
    const claimVecs = plan.claims.map((t) => vectors.get('q:' + textKey(t)));
    const passageVecs = plan.passages.map((t) => vectors.get('p:' + textKey(t)));
    if (claimVecs.some((v) => !v) || passageVecs.some((v) => !v)) return report;
    void graph;
    return applySemantic(report, pendings, plan, claimVecs as Float32Array[], passageVecs as Float32Array[], EVIDENCE_PARAMS);
  }

  /** Texts that still need an embedding (cache misses) for the project's current evidence. */
  async semanticTodo(projectId: string): Promise<{ claims: string[]; passages: string[]; total: number; cached: number }> {
    await this.getProject(projectId);
    if (!this.staged.has(projectId)) await this.rebuild(projectId);
    const staged = this.staged.get(projectId)!;
    const plan = this.planFor(staged);
    const vectors = (await this.loadVectors(projectId)) ?? new Map();
    const claims = plan.claims.filter((t) => !vectors.has('q:' + textKey(t)));
    const passages = plan.passages.filter((t) => !vectors.has('p:' + textKey(t)));
    return { claims, passages, total: plan.claims.length + plan.passages.length, cached: plan.claims.length + plan.passages.length - claims.length - passages.length };
  }

  /** Stores freshly computed embeddings (same order as `semanticTodo`) and rebuilds with them. */
  async semanticStore(projectId: string, claims: { text: string; vec: Float32Array }[], passages: { text: string; vec: Float32Array }[]): Promise<EvidenceReport> {
    const vectors = (await this.loadVectors(projectId)) ?? new Map<string, Float32Array>();
    for (const c of claims) vectors.set('q:' + textKey(c.text), c.vec);
    for (const p of passages) vectors.set('p:' + textKey(p.text), p.vec);
    await this.saveVectors(projectId, vectors);
    await this.rebuild(projectId);
    return this.getEvidence(projectId);
  }

  async semanticStatus(projectId: string): Promise<{ active: boolean; cachedTexts: number }> {
    const idx = await this.d.getJson<VectorCache>(projectId, 'semantic.json');
    const ev = await this.getEvidence(projectId);
    return { active: ev.method.includes('modelo de linguagem multilíngue'), cachedTexts: idx?.keys.length ?? 0 };
  }

  async clearSemantic(projectId: string): Promise<void> {
    await this.d.remove(projectId, 'semantic.json');
    await this.d.remove(projectId, 'semantic.vec');
    await this.rebuild(projectId);
  }

  // ---- reference list of the article when there is no .bib ---------------------------------------------------

  async extractReferencesFromMain(projectId: string): Promise<{ references: ParsedReference[]; usable: number; numbered: boolean }> {
    await this.ensureExtracted(projectId);
    const meta = await this.getProject(projectId);
    const main = Object.values(meta.files).find((f) => f.role === 'main');
    if (!main) throw new ValidationError('Envie primeiro o PDF do artigo.');
    if (Object.values(meta.files).some((f) => f.role === 'bibtex' && f.originalName !== GENERATED_BIB)) throw new ValidationError('Este projeto já tem um arquivo .bib; a lista de referências não será extraída do artigo.');
    const text = await this.getText(projectId, main.id);
    if (!text) throw new ValidationError('Não foi possível ler o texto do PDF do artigo.');
    const entries = extractReferenceEntries(text);
    if (entries.length === 0) throw new ValidationError('Não encontrei a seção "Referências" no PDF do artigo.');
    const references = parseReferences(entries);
    for (const f of Object.values(meta.files)) if (f.role === 'bibtex' && f.originalName === GENERATED_BIB) await this.removeFile(projectId, f.id);
    await this.addFile(projectId, { data: new TextEncoder().encode(toBibtex(references)), originalName: GENERATED_BIB, visibility: 'private' });
    await this.rebuild(projectId);
    return { references, usable: references.filter((r) => r.authors.length && r.year).length, numbered: entries.some((e) => Boolean(e.label)) };
  }

  async getCurated(projectId: string): Promise<CuratedFile | undefined> {
    return this.d.getJson<CuratedFile>(projectId, 'curated.json');
  }

  async setCurated(projectId: string, curated: CuratedFile | undefined): Promise<{ result?: CuratedApplyResult; graph: CitationGraph }> {
    await this.getProject(projectId);
    if (curated) await this.d.putJson(projectId, 'curated.json', curated);
    else await this.d.remove(projectId, 'curated.json');
    const graph = await this.rebuild(projectId);
    if (!curated) return { graph };
    const ev = await this.getEvidence(projectId);
    return { graph, result: { items: curated.items.length, applied: ev.occurrences.filter((o) => o.curated).length, unmatchedItems: 0, keysWithDifferentCounts: [], lowSimilarity: 0 } };
  }

  async getEvidence(projectId: string): Promise<EvidenceReport> {
    await this.getProject(projectId);
    const e = await this.d.getJson<EvidenceReport>(projectId, 'evidence.json');
    if (e) return e;
    await this.rebuild(projectId);
    return (await this.d.getJson<EvidenceReport>(projectId, 'evidence.json')) as EvidenceReport;
  }

  async getGraph(projectId: string): Promise<CitationGraph> {
    await this.getProject(projectId);
    return (await this.d.getJson<CitationGraph>(projectId, 'graph.json')) ?? this.rebuild(projectId);
  }
}

export type { SemanticPlan };
