import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { categoryOf, type CategoryRule } from '../core/categories';
import type { CitationGraph, ReviewAction } from '../core/model';
import { buildView, DEFAULT_FILTERS, type GraphMode, type ViewFilters } from '../core/view';
import { api, type ProjectSummary } from './api';
import { BRAND, pageTitle } from './brand';
import { Landing, type FlowMode } from './components/Landing';
import { UploadFlow } from './components/UploadFlow';
import lockup from './assets/fontexto-lockup.svg';
import { SetupChecklist } from './components/SetupChecklist';
import { occurrencesByPublication } from '../core/evidenceView';
import type { EvidenceReport } from '../core/evidence';
import { DocumentView, type DocumentFocus } from './components/DocumentView';
import { FiltersPanel } from './components/FiltersPanel';
import { GraphCanvas, type Selection } from './components/GraphCanvas';
import { PdfViewer } from './components/PdfViewer';
import { ProjectPanel } from './components/ProjectPanel';
import { SidePanel, type OpenRequest } from './components/SidePanel';

const LAST_PROJECT = 'fontexto:lastProject';

export function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState<string | undefined>(
    () => new URLSearchParams(window.location.search).get('project') ?? undefined,
  );
  const [graph, setGraph] = useState<CitationGraph | undefined>();
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [filters, setFilters] = useState<ViewFilters>(DEFAULT_FILTERS);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Selection>();
  const [viewer, setViewer] = useState<OpenRequest | undefined>();
  const [docMode, setDocMode] = useState(false);
  const [docFocus, setDocFocus] = useState<DocumentFocus | undefined>();
  const [evidence, setEvidence] = useState<EvidenceReport | undefined>();
  const [panelOpen, setPanelOpen] = useState(false);
  const [layoutNonce, setLayoutNonce] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const [externalAvailable, setExternalAvailable] = useState(false);
  const [flow, setFlow] = useState<FlowMode | undefined>();

  useEffect(() => {
    api.health().then((h) => setExternalAvailable(h.externalMetadataAvailable), () => setError('API indisponível. Inicie o servidor (npm run dev).'));
    api.listProjects().then(setProjects, () => undefined);
  }, []);

  useEffect(() => {
    if (!projectId) {
      if (window.location.search) history.replaceState(null, '', window.location.pathname);
      return;
    }
    history.replaceState(null, '', `?project=${encodeURIComponent(projectId)}`);
    setGraph(undefined);
    setEvidence(undefined);
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

  useEffect(() => {
    if (!projectId || !graph) return;
    let cancelled = false;
    api.evidence(projectId).then(
      (r) => !cancelled && setEvidence(r),
      () => !cancelled && setEvidence(undefined),
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, graph?.builtAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const docCitations = useMemo(() => (evidence ? occurrencesByPublication(evidence) : undefined), [evidence]);
  const showInDocument = useCallback((pubId?: string) => {
    setDocFocus((f) => ({ pubId, nonce: (f?.nonce ?? 0) + 1 }));
    setDocMode(true);
  }, []);

  useEffect(() => {
    document.title = pageTitle(projectId ? (projects.find((p) => p.id === projectId)?.name ?? undefined) : undefined);
  }, [projectId, projects]);

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
    setDocMode(false);
    setFilters((f) => ({ ...f, mode }));
    setSelection(undefined);
  };
  const evidenceCount = graph ? Object.values(graph.nodes).filter((n) => n.kind === 'claim' || n.kind === 'evidence').length : 0;

  if (!projectId) {
    if (flow) {
      return (
        <UploadFlow
          mode={flow}
          onBack={() => setFlow(undefined)}
          onDone={(id, p) => {
            setProjects((ps) => (ps.some((x) => x.id === id) ? ps : [...ps, p]));
            setFlow(undefined);
            setDocMode(true);
            setProjectId(id);
          }}
        />
      );
    }
    return <Landing projects={projects} error={error} onStart={setFlow} onOpen={setProjectId} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand-btn" onClick={() => setProjectId(undefined)} aria-label={`${BRAND.name}: voltar ao início`} title="Voltar ao início">
          <img src={lockup} alt={BRAND.name} height={26} />
        </button>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value || undefined)} aria-label="Projeto">
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="">+ Projetos…</option>
        </select>
        <nav className="tabs" role="tablist" aria-label="Visões">
          <button role="tab" aria-selected={!docMode && filters.mode === 'bibliographic'} className={!docMode && filters.mode === 'bibliographic' ? 'on' : ''} onClick={() => setMode('bibliographic')}>
            A · Bibliográfico
          </button>
          <button role="tab" aria-selected={!docMode && filters.mode === 'evidence'} className={!docMode && filters.mode === 'evidence' ? 'on' : ''} onClick={() => setMode('evidence')}>
            B · Evidências
          </button>
          <button role="tab" aria-selected={docMode} className={docMode ? 'on' : ''} onClick={() => setDocMode(true)}>
            C · Documento{evidence && evidence.summary.occurrences > 0 ? ` (${evidence.summary.occurrences})` : ''}
          </button>
        </nav>
        {!docMode && (
        <input
          className="search"
          type="search"
          placeholder="Pesquisar publicação, autor ou DOI"
          value={filters.search ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
        />
        )}
        {stats && (
          <span className="stats small">
            {stats.pubs} publicações · {stats.confirmed} citações confirmadas · {stats.unverified} a verificar
            {stats.pending > 0 && <span className="badge warn"> {stats.pending} pendência(s)</span>}
          </span>
        )}
        {!docMode && <button onClick={() => setLayoutNonce((n) => n + 1)}>Reorganizar</button>}
        <button className="primary" onClick={() => setPanelOpen(true)}>
          Arquivos e revisão
        </button>
      </header>
      {error && (
        <div className="notice error" onClick={() => setError(undefined)}>
          {error}
        </div>
      )}
      {docMode && !graph && (
        <div className="loading">
          <span className="spinner" /> Carregando projeto…
        </div>
      )}
      {docMode && graph && (
        <div className="main">
          <DocumentView
            projectId={projectId}
            graph={graph}
            evidence={evidence}
            focus={docFocus}
            onOpenReference={setViewer}
            onShowInGraph={(pubId) => {
              setDocMode(false);
              setSelection({ type: 'node', id: pubId });
            }}
            onOpenFiles={() => setPanelOpen(true)}
            onGraph={setGraph}
          />
        </div>
      )}
      {!docMode && (
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
            <div className="loading">
              <span className="spinner" /> Montando o grafo…
            </div>
          )}
          {graph && Object.keys(graph.files).length === 0 && (
            <div className="empty-card">
              <h2>Comece enviando seus arquivos</h2>
              <p className="muted">Com o PDF do documento e a bibliografia, o grafo e a aba “C · Documento” são montados automaticamente.</p>
              <SetupChecklist projectId={projectId} graph={graph} onGraph={setGraph} />
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
            docCitations={docCitations}
            onShowInDocument={showInDocument}
            onReview={onReview}
            onCategory={onCategory}
          />
        )}
      </div>
      )}
      {viewer && <PdfViewer projectId={projectId} request={viewer} backLabel={panelOpen ? 'Voltar aos arquivos' : docMode ? 'Voltar ao documento' : 'Voltar ao grafo'} onClose={() => setViewer(undefined)} />}
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
