import type { ViewerTarget } from '../core/anchors';
import type { CategoryRule } from '../core/categories';
import type { EvidenceReport } from '../core/evidence';
import type { Anchor, CitationGraph, ReviewAction } from '../core/model';

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
}

export interface FileView {
  id: string;
  originalName: string;
  role: 'main' | 'reference' | 'bibtex';
  visibility: 'private' | 'shareable';
  pageCount?: number;
  extraction: { status: string; error?: string };
  storage: 'managed' | 'external';
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const json = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const base = (p: string) => `/api/projects/${encodeURIComponent(p)}`;

export const api = {
  health: () => req<{ ok: boolean; externalMetadataAvailable: boolean }>('/api/health'),
  listProjects: () => req<ProjectSummary[]>('/api/projects'),
  createProject: (name: string) => req<ProjectSummary>('/api/projects', json({ name })),
  deleteProject: (p: string) => req<void>(base(p), { method: 'DELETE' }),
  project: (p: string) => req<ProjectSummary & { files: FileView[] }>(base(p)),
  graph: (p: string) => req<CitationGraph>(`${base(p)}/graph`),
  rebuild: (p: string) => req<CitationGraph>(`${base(p)}/rebuild`, { method: 'POST' }),
  upload: (p: string, files: File[], role: 'main' | 'reference', visibility: 'private' | 'shareable') => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f, f.name);
    fd.append('role', role);
    fd.append('visibility', visibility);
    return req<{ graph: CitationGraph }>(`${base(p)}/files`, { method: 'POST', body: fd });
  },
  deleteFile: (p: string, fileId: string) => req<CitationGraph>(`${base(p)}/files/${fileId}`, { method: 'DELETE' }),
  pdfUrl: (p: string, fileId: string) => `${base(p)}/files/${fileId}/pdf`,
  resolveAnchor: (p: string, anchor: Anchor) => req<ViewerTarget>(`${base(p)}/anchor`, json(anchor)),
  identityDecision: (p: string, reviewId: string, decision: 'same' | 'distinct' | null) =>
    req<CitationGraph>(`${base(p)}/decisions/identity`, json({ reviewId, decision })),
  fileLink: (p: string, fileId: string, publicationId: string | null | undefined) =>
    req<CitationGraph>(`${base(p)}/decisions/file-link`, json({ fileId, publicationId })),
  edgeReview: (p: string, edgeId: string, action: ReviewAction, note?: string) =>
    req<CitationGraph>(`${base(p)}/decisions/edge`, json({ edgeId, action, note })),
  category: (p: string, publicationId: string, category: string | null | undefined) =>
    req<CitationGraph>(`${base(p)}/decisions/category`, json({ publicationId, category })),
  categories: (p: string) => req<CategoryRule[]>(`${base(p)}/categories`),
  setCategories: (p: string, rules: CategoryRule[]) => req<CitationGraph>(`${base(p)}/categories`, json(rules, 'PUT')),
  enrich: (p: string) => req<{ looked_up: number; found: number; graph: CitationGraph }>(`${base(p)}/metadata/enrich`, json({ consent: true })),
  evidence: (p: string) => req<EvidenceReport>(`${base(p)}/evidence`),
  extractReferences: (p: string) =>
    req<{ references: { key: string; authors: { family: string; given?: string }[]; etAl: boolean; year?: number; title?: string; doi?: string; style: string; text: string }[]; usable: number; numbered: boolean; graph: CitationGraph }>(
      `${base(p)}/references/extract`,
      { method: 'POST' },
    ),
  curated: (p: string) => req<{ source: string; importedAt: string; items: number } | null>(`${base(p)}/curated`),
  importCurated: (p: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return req<{ source: string; items: number; applied: number; graph: CitationGraph }>(`${base(p)}/curated`, { method: 'POST', body: fd });
  },
  removeCurated: (p: string) => req<CitationGraph>(`${base(p)}/curated`, { method: 'DELETE' }),
  exportUrl: (p: string, kind: 'graphml' | 'json' | 'evidence') => `${base(p)}/export/${kind}`,
};
