/**
 * Local, file-based persistence.
 *
 *   <dataDir>/projects/<projectId>/
 *     project.json      project metadata + file registry
 *     decisions.json    researcher decisions (re-applied on every rebuild)
 *     categories.json   category rules (editable)
 *     external.json     opt-in external metadata cache (keyed by DOI)
 *     graph.json        last built graph (avoids re-processing on open)
 *     files/            uploaded files (managed storage)
 *     derived/          extracted text cache, one JSON per file
 *
 * Projects are isolated: every path is resolved inside its project directory
 * and ids are validated against strict patterns (no path traversal).
 * Externally registered files (CLI) are referenced by path and are never
 * modified or deleted.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseBibtex } from '../core/bibtex.js';
import type { CategoryRule } from '../core/categories.js';
import { emptyDecisions, type CitationGraph, type FileRecord, type FileRole, type UserDecisions, type Visibility } from '../core/model.js';
import { buildGraph, type ExternalMetadata } from '../core/pipeline.js';
import type { PdfText } from '../core/text.js';
import { DEFAULT_CATEGORY_RULES } from './defaults.js';
import { extractPdfText } from './pdfText.js';

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  files: Record<string, FileRecord>;
}

export class NotFoundError extends Error {}
export class ValidationError extends Error {}

const PROJECT_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FILE_ID_RE = /^f_[a-f0-9]{12}$/;

export const isValidProjectId = (id: string) => PROJECT_ID_RE.test(id);
export const isValidFileId = (id: string) => FILE_ID_RE.test(id);

async function writeJsonAtomic(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 1), 'utf8');
  await fs.rename(tmp, file);
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
}

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'project';

const sha256 = (buf: Uint8Array) => createHash('sha256').update(buf).digest('hex');

function roleForName(name: string): 'pdf' | 'bib' | undefined {
  if (/\.pdf$/i.test(name)) return 'pdf';
  if (/\.(bib|bibtex)$/i.test(name)) return 'bib';
  return undefined;
}

export class ProjectStore {
  readonly root: string;
  private locks = new Map<string, Promise<unknown>>();

  constructor(dataDir: string) {
    this.root = path.resolve(dataDir, 'projects');
  }

  /** Serializes mutations per project. */
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

  projectDir(projectId: string): string {
    if (!isValidProjectId(projectId)) throw new ValidationError('Invalid project id');
    const dir = path.join(this.root, projectId);
    if (!dir.startsWith(this.root + path.sep)) throw new ValidationError('Invalid project id');
    return dir;
  }

  private file(projectId: string, name: string) {
    return path.join(this.projectDir(projectId), name);
  }

  async listProjects(): Promise<Pick<ProjectMeta, 'id' | 'name' | 'createdAt'>[]> {
    if (!existsSync(this.root)) return [];
    const out: Pick<ProjectMeta, 'id' | 'name' | 'createdAt'>[] = [];
    for (const d of await fs.readdir(this.root)) {
      if (!isValidProjectId(d)) continue;
      const meta = await readJson<ProjectMeta | undefined>(path.join(this.root, d, 'project.json'), undefined);
      if (meta) out.push({ id: meta.id, name: meta.name, createdAt: meta.createdAt });
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createProject(name: string, id?: string): Promise<ProjectMeta> {
    const pid = id ?? `${slug(name)}-${randomBytes(3).toString('hex')}`;
    if (!isValidProjectId(pid)) throw new ValidationError('Invalid project id');
    const dir = this.projectDir(pid);
    if (existsSync(path.join(dir, 'project.json'))) throw new ValidationError('Project already exists');
    const meta: ProjectMeta = { id: pid, name: name.trim() || pid, createdAt: new Date().toISOString(), files: {} };
    await writeJsonAtomic(path.join(dir, 'project.json'), meta);
    await writeJsonAtomic(path.join(dir, 'categories.json'), DEFAULT_CATEGORY_RULES);
    return meta;
  }

  async getProject(projectId: string): Promise<ProjectMeta> {
    const meta = await readJson<ProjectMeta | undefined>(this.file(projectId, 'project.json'), undefined);
    if (!meta) throw new NotFoundError('Project not found');
    return meta;
  }

  /** Deletes the project and all managed/derived data. External originals are untouched. */
  async deleteProject(projectId: string): Promise<void> {
    await this.getProject(projectId);
    await this.withLock(projectId, () => fs.rm(this.projectDir(projectId), { recursive: true, force: true }));
  }

  async addFile(projectId: string, input: { data: Uint8Array; originalName: string; role?: FileRole; visibility?: Visibility }): Promise<FileRecord> {
    return this.withLock(projectId, async () => {
      const meta = await this.getProject(projectId);
      const kind = roleForName(input.originalName);
      if (!kind) throw new ValidationError('Only .pdf and .bib files are accepted');
      if (kind === 'pdf' && Buffer.from(input.data.subarray(0, 5)).toString('latin1') !== '%PDF-') throw new ValidationError('File is not a PDF');
      const role: FileRole = kind === 'bib' ? 'bibtex' : input.role === 'main' ? 'main' : 'reference';
      const hash = sha256(input.data);
      const dup = Object.values(meta.files).find((f) => f.sha256 === hash && f.role === role);
      if (dup) return dup;
      if (role === 'main') {
        const prev = Object.values(meta.files).find((f) => f.role === 'main');
        if (prev) throw new ValidationError('A main document already exists; delete it first.');
      }
      const id = `f_${randomBytes(6).toString('hex')}`;
      const ext = kind === 'pdf' ? '.pdf' : '.bib';
      const relPath = `files/${id}${ext}`;
      await fs.mkdir(this.file(projectId, 'files'), { recursive: true });
      await fs.writeFile(this.file(projectId, relPath), input.data);
      const rec: FileRecord = {
        id,
        sha256: hash,
        originalName: path.basename(input.originalName).slice(0, 255),
        role,
        visibility: input.visibility ?? 'private',
        storage: { kind: 'managed', relPath },
        addedAt: new Date().toISOString(),
        extraction: { status: kind === 'pdf' ? 'pending' : 'ok' },
      };
      meta.files[id] = rec;
      await writeJsonAtomic(this.file(projectId, 'project.json'), meta);
      return rec;
    });
  }

  /** Registers a file by absolute path without copying it (used by the CLI). */
  async registerExternalFile(projectId: string, absPath: string, role: FileRole, visibility: Visibility = 'private'): Promise<FileRecord> {
    return this.withLock(projectId, async () => {
      const meta = await this.getProject(projectId);
      const resolved = path.resolve(absPath);
      const data = await fs.readFile(resolved);
      const hash = sha256(data);
      const dup = Object.values(meta.files).find((f) => f.sha256 === hash && f.role === role);
      if (dup) return dup;
      const id = `f_${randomBytes(6).toString('hex')}`;
      const rec: FileRecord = {
        id,
        sha256: hash,
        originalName: path.basename(resolved),
        role,
        visibility,
        storage: { kind: 'external', absPath: resolved },
        addedAt: new Date().toISOString(),
        extraction: { status: role === 'bibtex' ? 'ok' : 'pending' },
      };
      meta.files[id] = rec;
      await writeJsonAtomic(this.file(projectId, 'project.json'), meta);
      return rec;
    });
  }

  /** Absolute path of a file that belongs to the project, or NotFoundError. */
  async resolveFilePath(projectId: string, fileId: string): Promise<{ path: string; record: FileRecord }> {
    if (!isValidFileId(fileId)) throw new NotFoundError('File not found');
    const meta = await this.getProject(projectId);
    const rec = meta.files[fileId];
    if (!rec) throw new NotFoundError('File not found');
    if (rec.storage.kind === 'managed') {
      const dir = this.projectDir(projectId);
      const p = path.resolve(dir, rec.storage.relPath);
      if (!p.startsWith(dir + path.sep)) throw new NotFoundError('File not found');
      return { path: p, record: rec };
    }
    return { path: rec.storage.absPath, record: rec };
  }

  /** Removes a file and every derived artefact (text cache, decisions about it), then rebuilds. */
  async removeFile(projectId: string, fileId: string): Promise<void> {
    if (!isValidFileId(fileId)) throw new NotFoundError('File not found');
    await this.withLock(projectId, async () => {
      const meta = await this.getProject(projectId);
      const rec = meta.files[fileId];
      if (!rec) throw new NotFoundError('File not found');
      if (rec.storage.kind === 'managed') await fs.rm(this.file(projectId, rec.storage.relPath), { force: true });
      await fs.rm(this.derivedPath(projectId, fileId), { force: true });
      delete meta.files[fileId];
      await writeJsonAtomic(this.file(projectId, 'project.json'), meta);
      const d = await this.getDecisions(projectId);
      delete d.fileLinks[fileId];
      await writeJsonAtomic(this.file(projectId, 'decisions.json'), d);
    });
    await this.rebuild(projectId);
  }

  private derivedPath(projectId: string, fileId: string) {
    if (!isValidFileId(fileId)) throw new ValidationError('Invalid file id');
    return this.file(projectId, `derived/${fileId}.text.json`);
  }

  async getText(projectId: string, fileId: string): Promise<PdfText | undefined> {
    return readJson<PdfText | undefined>(this.derivedPath(projectId, fileId), undefined);
  }

  /** Extracts text of PDFs not yet processed. Results are cached; PDFs are never re-parsed. */
  async ensureExtracted(projectId: string, onProgress?: (done: number, total: number, name: string) => void): Promise<void> {
    const meta = await this.getProject(projectId);
    const pending = Object.values(meta.files).filter((f) => f.role !== 'bibtex' && (f.extraction.status === 'pending' || !existsSync(this.derivedPath(projectId, f.id))));
    let done = 0;
    for (const f of pending) {
      onProgress?.(done, pending.length, f.originalName);
      let status: FileRecord['extraction'] = { status: 'ok' };
      let pageCount: number | undefined;
      try {
        const { path: p } = await this.resolveFilePath(projectId, f.id);
        const text = await extractPdfText(await fs.readFile(p));
        pageCount = text.pageCount;
        const chars = text.pages.reduce((n, pg) => n + pg.lines.reduce((m, l) => m + l.text.length, 0), 0);
        if (chars < 20) status = { status: 'no_text', error: 'No extractable text (scanned PDF? OCR is not available offline).' };
        await writeJsonAtomic(this.derivedPath(projectId, f.id), text);
      } catch (err) {
        status = { status: 'failed', error: (err as Error).message.slice(0, 300) };
      }
      await this.withLock(projectId, async () => {
        const m = await this.getProject(projectId);
        if (!m.files[f.id]) return;
        m.files[f.id].extraction = status;
        if (pageCount !== undefined) m.files[f.id].pageCount = pageCount;
        await writeJsonAtomic(this.file(projectId, 'project.json'), m);
      });
      done++;
    }
    onProgress?.(done, pending.length, '');
  }

  async getDecisions(projectId: string): Promise<UserDecisions> {
    return { ...emptyDecisions(), ...(await readJson<Partial<UserDecisions>>(this.file(projectId, 'decisions.json'), {})) };
  }

  async updateDecisions(projectId: string, fn: (d: UserDecisions) => void): Promise<CitationGraph> {
    await this.withLock(projectId, async () => {
      const d = await this.getDecisions(projectId);
      fn(d);
      await writeJsonAtomic(this.file(projectId, 'decisions.json'), d);
    });
    return this.rebuild(projectId);
  }

  async getCategoryRules(projectId: string): Promise<CategoryRule[]> {
    return readJson<CategoryRule[]>(this.file(projectId, 'categories.json'), DEFAULT_CATEGORY_RULES);
  }

  async setCategoryRules(projectId: string, rules: CategoryRule[]): Promise<CitationGraph> {
    await writeJsonAtomic(this.file(projectId, 'categories.json'), rules);
    return this.rebuild(projectId);
  }

  async getExternalMetadata(projectId: string): Promise<Record<string, ExternalMetadata>> {
    return readJson(this.file(projectId, 'external.json'), {});
  }

  async setExternalMetadata(projectId: string, data: Record<string, ExternalMetadata>): Promise<void> {
    await writeJsonAtomic(this.file(projectId, 'external.json'), data);
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
            const { path: p } = await this.resolveFilePath(projectId, f.id);
            const parsed = parseBibtex(await fs.readFile(p, 'utf8'));
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
        externalMetadata: await this.getExternalMetadata(projectId),
      });
      graph.warnings.unshift(...warnings);
      await writeJsonAtomic(this.file(projectId, 'graph.json'), graph);
      return graph;
    });
  }

  async getGraph(projectId: string): Promise<CitationGraph> {
    await this.getProject(projectId);
    const g = await readJson<CitationGraph | undefined>(this.file(projectId, 'graph.json'), undefined);
    return g ?? this.rebuild(projectId);
  }
}
