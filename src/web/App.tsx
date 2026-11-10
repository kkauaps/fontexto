import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { categoryOf, type CategoryRule } from '../core/categories';
import type { CitationGraph, ReviewAction } from '../core/model';
import { buildView, DEFAULT_FILTERS, type GraphMode, type ViewFilters } from '../core/view';
import { api, type ProjectSummary } from './api';
import { FiltersPanel } from './components/FiltersPanel';
import { GraphCanvas, type Selection } from './components/GraphCanvas';
import { PdfViewer } from './components/PdfViewer';
import { ProjectPanel } from './components/ProjectPanel';
import { SidePanel, type OpenRequest } from './components/SidePanel';

const LAST_PROJECT = 'citationtrace:lastProject';

export function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState<string | undefined>(
    () => new URLSearchParams(window.location.search).get('project') ?? localStorage.getItem(LAST_PROJECT) ?? undefined,
  );
  const [graph, setGraph] = useState<CitationGraph | undefined>();
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [filters, setFilters] = useState<ViewFilters>(DEFAULT_FILTERS);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Selection>();
  const [viewer, setViewer] = useState<OpenRequest | undefined>();
  const [panelOpen, setPanelOpen] = useState(false);
  const [layoutNonce, setLayoutNonce] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const [externalAvailable, setExternalAvailable] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    api.health().then((h) => setExternalAvailable(h.externalMetadataAvailable), () => setError('API indisponível. Inicie o servidor (npm run dev).'));
    api.listProjects().then(setProjects, () => undefined);
  }, []);

  useEffect(() => {
    if (!projectId) return;
    localStorage.setItem(LAST_PROJECT, projectId);
    setGraph(undefined);
    setSelection(undefined);
    api.graph(projectId).then(setGraph, (e: Error) => {
      setError(e.message);
      setProjectId(undefined);
      localStorage.removeItem(LAST_PROJECT);
    });
    api.categories(projectId).then(setRules, () => setRules([]));
  }, [projectId]);

  useEffect(() => {
    if (projectId && graph) api.categories(projectId).then(setRules, () => undefined);
  }, [projectId, graph?.builtAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const view = useMemo(() => (graph ? buildView(graph, filters, collapsed) : undefined), [graph, filters, collapsed]);
  const categories = useMemo(() => {
    if (!graph) return [];
    const s = new Set<string>(rules.map((r) => r.name));
    for (const n of Object.values(graph.nodes)) if (n.kind === 'publication') s.add(categoryOf(n));
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [graph, rules]);
  const years = useMemo(() => {
    const ys = graph ? Object.values(graph.nodes).flatMap((n) => (n.kind === 'publication' && n.year ? [n.year] : [])) : [];
    return { min: ys.length ? Math.min(...ys) : undefined, max: ys.length ? Math.max(...ys) : undefined };
  }, [graph]);

  const toggleGroup = useCallback((c: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }, []);

  const stats = useMemo(() => {
    if (!graph) return undefined;
    const edges = Object.values(graph.edges);
    return {
      pubs: Object.values(graph.nodes).filter((n) => n.kind === 'publication').length,
      confirmed: edges.filter((e) => e.kind === 'cites' && e.status === 'confirmed').length,
      unverified: edges.filter((e) => e.kind === 'cites' && e.status === 'unverified').length,
      pending: graph.identityReviews.filter((r) => !r.decision).length + graph.fileLinks.filter((l) => l.status === 'ambiguous').length,
    };
  }, [graph]);

  const onReview = async (edgeId: string, action: ReviewAction) => {
    if (!projectId) return;
    setGraph(await api.edgeReview(projectId, edgeId, action));
  };
  const onCategory = async (pubId: string, value: string | null | undefined) => {
    if (!projectId) return;
    setGraph(await api.category(projectId, pubId, value));
  };
  const setMode = (mode: GraphMode) => {
    setFilters((f) => ({ ...f, mode }));
    setSelection(undefined);
  };
  const evidenceCount = graph ? Object.values(graph.nodes).filter((n) => n.kind === 'claim' || n.kind === 'evidence').length : 0;

  if (!projectId) {
    return (
      <div className="welcome">
        <h1>CitationTrace</h1>
        <p className="muted">Grafo de citações e evidências — processamento local, sem envio de documentos a serviços externos.</p>
        {error && <div className="notice error">{error}</div>}
        <section>
          <h3>Projetos</h3>
          {projects.length === 0 && <p className="muted small">Nenhum projeto ainda.</p>}
          <ul className="list">
            {projects.map((p) => (
              <li key={p.id}>
                <button className="linklike" onClick={() => setProjectId(p.id)}>
                  {p.name}
                </button>{' '}
                <span className="small muted">{new Date(p.createdAt).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3>Novo projeto</h3>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newName.trim()) return;
              api.createProject(newName.trim()).then((p) => {
                setProjects((ps) => [...ps, p]);
                setProjectId(p.id);
                setPanelOpen(true);
              }, (err: Error) => setError(err.message));
            }}
          >
            <input placeholder="Nome (ex.: TCC 2026)" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button className="primary" type="submit">
              Criar
            </button>
          </form>
        </section>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <strong className="brand">CitationTrace</strong>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value || undefined)} aria-label="Projeto">
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="">+ Projetos…</option>
        </select>
        <div className="segmented" role="tablist">
          <button role="tab" aria-selected={filters.mode === 'bibliographic'} className={filters.mode === 'bibliographic' ? 'on' : ''} onClick={() => setMode('bibliographic')}>
            A · Bibliográfico
          </button>
          <button role="tab" aria-selected={filters.mode === 'evidence'} className={filters.mode === 'evidence' ? 'on' : ''} onClick={() => setMode('evidence')}>
            B · Evidências
          </button>
        </div>
        <input
          className="search"
          type="search"
          placeholder="Pesquisar publicação, autor ou DOI"
          value={filters.search ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
        />
        {stats && (
          <span className="stats small">
            {stats.pubs} publicações · {stats.confirmed} citações confirmadas · {stats.unverified} a verificar
            {stats.pending > 0 && <span className="badge warn"> {stats.pending} pendência(s)</span>}
          </span>
        )}
        <button onClick={() => setLayoutNonce((n) => n + 1)}>Reorganizar</button>
        <button className="primary" onClick={() => setPanelOpen(true)}>
          Arquivos e revisão
        </button>
      </header>
      {error && (
        <div className="notice error" onClick={() => setError(undefined)}>
          {error}
        </div>
      )}
      <div className="main">
        <FiltersPanel
          filters={filters}
          onChange={setFilters}
          categories={categories}
          rules={rules}
          collapsed={collapsed}
          onToggleGroup={toggleGroup}
          years={years}
          hiddenCount={view?.hiddenCount ?? 0}
        />
        <div className="canvas">
          {filters.mode === 'evidence' && evidenceCount === 0 && (
            <div className="mode-note">
              Grafo de evidências (Fase 2): afirmações e passagens ainda não são extraídas. O modelo de dados já suporta nós de afirmação/evidência e
              os estados de verificação; nada é exibido para não apresentar resultados inventados.
            </div>
          )}
          {graph && view ? (
            <ReactFlowProvider>
              <GraphCanvas
                view={view}
                rules={rules}
                selection={selection}
                onSelect={setSelection}
                onToggleGroup={toggleGroup}
                layoutNonce={layoutNonce}
                search={filters.search ?? ''}
                exportName={projectId}
              />
            </ReactFlowProvider>
          ) : (
            <div className="loading">Carregando grafo…</div>
          )}
          {graph && Object.keys(graph.files).length === 0 && (
            <div className="mode-note">
              Projeto vazio. Abra <button className="linklike" onClick={() => setPanelOpen(true)}>Arquivos e revisão</button> para enviar o .bib, o PDF
              principal e os PDFs das referências.
            </div>
          )}
        </div>
        {graph && selection && view && (
          <SidePanel
            graph={graph}
            selection={selection}
            viewEdges={view.edges}
            rules={rules}
            onClose={() => setSelection(undefined)}
            onSelect={setSelection}
            onOpen={setViewer}
            onReview={onReview}
            onCategory={onCategory}
          />
        )}
      </div>
      {viewer && <PdfViewer projectId={projectId} request={viewer} onClose={() => setViewer(undefined)} />}
      {panelOpen && graph && (
        <ProjectPanel
          projectId={projectId}
          graph={graph}
          externalAvailable={externalAvailable}
          onGraph={setGraph}
          onOpen={(r) => {
            setViewer(r);
          }}
          onClose={() => setPanelOpen(false)}
          onDeleted={() => {
            setPanelOpen(false);
            setProjects((ps) => ps.filter((p) => p.id !== projectId));
            localStorage.removeItem(LAST_PROJECT);
            setProjectId(undefined);
          }}
        />
      )}
    </div>
  );
}
