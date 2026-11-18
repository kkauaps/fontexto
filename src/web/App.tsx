import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { categoryOf, type CategoryRule } from '../core/categories';
import type { CitationGraph, ReviewAction } from '../core/model';
import { buildView, DEFAULT_FILTERS, type ViewFilters } from '../core/view';
import { api, edition, type ProjectSummary } from './api';
import { Landing, type FlowMode } from './components/Landing';
import { UploadFlow } from './components/UploadFlow';
import { BackPill, HeaderControls } from './components/HeaderControls';
import { MobileBottomNav, type MobileAppTab } from './components/MobileBottomNav';
import { isPhoneWidth } from './fit';
import { BrandMark } from './components/BrandMark';
import { SetupChecklist } from './components/SetupChecklist';
import type { EvidenceReport } from '../core/evidence';
import { DocumentView, type DocumentFocus } from './components/DocumentView';
import { FiltersPanel } from './components/FiltersPanel';
import { GraphCanvas, type Selection } from './components/GraphCanvas';
import { NetworkGraph } from './components/NetworkGraph';
import { PdfViewer } from './components/PdfViewer';
import { ProjectPanel } from './components/ProjectPanel';
import { SidePanel, type OpenRequest } from './components/SidePanel';
import { ReferencesView, type OaState } from './components/ReferencesView';
import { REF_STATUS_ORDER, refRows, refStatusMap, type RefStatus } from '../core/refStatus';
import { replaceSearch, translateRuntime, useI18n } from './i18n';

type Tab = 'doc' | 'refs' | 'graph';
const INITIAL_FILTERS: ViewFilters = { ...DEFAULT_FILTERS, interSource: false, colorBy: 'status' };

const LAST_PROJECT = 'fontexto:lastProject';

const GRAPH_VIEW_KEY = 'fontexto:graph-view';
const NO_COLLAPSE: Set<string> = new Set();

export function App() {
  const { t, locale } = useI18n();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState<string | undefined>(
    () => new URLSearchParams(window.location.search).get('project') ?? undefined,
  );
  const [graph, setGraph] = useState<CitationGraph | undefined>();
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [filters, setFilters] = useState<ViewFilters>(INITIAL_FILTERS);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Selection>();
  const [viewer, setViewer] = useState<OpenRequest | undefined>();
  const [tab, setTab] = useState<Tab>('doc');
  const docMode = tab === 'doc';
  const setDocMode = (on: boolean) => setTab(on ? 'doc' : 'graph');
  const [oa, setOa] = useState<Record<string, OaState>>({});
  const [graphView, setGraphView] = useState<'network' | 'diagram'>(() => {
    try {
      return localStorage.getItem(GRAPH_VIEW_KEY) === 'diagram' ? 'diagram' : 'network';
    } catch {
      return 'network';
    }
  });
  const pendingOa = useRef<Record<string, OaState> | undefined>(undefined);
  const [docFocus, setDocFocus] = useState<DocumentFocus | undefined>();
  const [evidence, setEvidence] = useState<EvidenceReport | undefined>();
  const [panelOpen, setPanelOpen] = useState(false);
  const [layoutNonce, setLayoutNonce] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const [externalAvailable, setExternalAvailable] = useState(false);
  const [flow, setFlow] = useState<FlowMode | undefined>();
  const [phone, setPhone] = useState(() => isPhoneWidth());
  const [phoneTab, setPhoneTab] = useState<MobileAppTab>('doc');
  const [sourceRequest, setSourceRequest] = useState<OpenRequest | undefined>();

  useEffect(() => {
    const onResize = () => setPhone(isPhoneWidth());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const openReference = useCallback((r: OpenRequest) => {
    if (isPhoneWidth()) {
      setSourceRequest(r);
      setPhoneTab('source');
      // phones show the source as a full tab: leave the graph so the tab bar and viewer are visible
      setTab((cur) => (cur === 'graph' ? 'doc' : cur));
    } else setViewer(r);
  }, []);

  useEffect(() => {
    api.health().then(
      (h) => setExternalAvailable(h.externalMetadataAvailable),
      () => setError(edition === 'web' ? '__browser__' : '__api__'),
    );
    api.listProjects().then(setProjects, () => undefined);
  }, []);

  useEffect(() => {
    if (!projectId) {
      replaceSearch({ project: null });
      return;
    }
    replaceSearch({ project: projectId });
    setGraph(undefined);
    setEvidence(undefined);
    setSelection(undefined);
    setOa(pendingOa.current ?? {});
    pendingOa.current = undefined;
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

  const showInDocument = useCallback((pubId?: string) => {
    setDocFocus((f) => ({ pubId, nonce: (f?.nonce ?? 0) + 1 }));
    setDocMode(true);
    setTab('doc');
    if (isPhoneWidth()) setPhoneTab('doc');
  }, []);

  useEffect(() => {
    document.title = t.pageTitle(projectId ? (projects.find((p) => p.id === projectId)?.name ?? undefined) : undefined);
  }, [projectId, projects, t, locale]);

  const rows = useMemo(() => (graph ? refRows(graph, evidence) : []), [graph, evidence]);
  /** Citations of each reference in the main text, with the per-status breakdown (same numbers as the References table). */
  const docCitations = useMemo(() => (evidence ? new Map(rows.filter((r) => r.citations > 0).map((r) => [r.pub.id, r.citations])) : undefined), [rows, evidence]);
  const citeBreakdown = useMemo(() => new Map(rows.map((r) => [r.pub.id, r.counts])), [rows]);
  const statusMap = useMemo(() => refStatusMap(rows), [rows]);
  const rowsById = useMemo(() => new Map(rows.map((r) => [r.pub.id, r])), [rows]);
  const refCounts = useMemo(() => Object.fromEntries(REF_STATUS_ORDER.map((s) => [s, rows.filter((r) => r.status === s).length])) as Record<RefStatus, number>, [rows]);
  const view = useMemo(() => (graph ? buildView(graph, filters, collapsed, statusMap) : undefined), [graph, filters, collapsed, statusMap]);
  const networkOn = graphView === 'network' && filters.mode === 'bibliographic';
  // the network view groups by topic itself: category groups are never collapsed there
  const netView = useMemo(() => (graph && networkOn ? buildView(graph, filters, NO_COLLAPSE, statusMap) : undefined), [graph, filters, statusMap, networkOn]);
  const openalexIds = useMemo(() => {
    const out: Record<string, string | undefined> = {};
    for (const [id, s] of Object.entries(oa)) if ('result' in s && s.result?.openalexId) out[id] = s.result.openalexId;
    return out;
  }, [oa]);
  const chooseGraphView = (v: 'network' | 'diagram') => {
    setGraphView(v);
    try {
      localStorage.setItem(GRAPH_VIEW_KEY, v);
    } catch {
      /* private mode */
    }
  };
  const viewSwitch = filters.mode === 'bibliographic' && (
    <div className="seg view-switch" role="radiogroup" aria-label={t.netViewLabel}>
      <button role="radio" aria-checked={graphView === 'network'} className={graphView === 'network' ? 'on' : ''} onClick={() => chooseGraphView('network')}>
        {t.netViewNetwork}
      </button>
      <button role="radio" aria-checked={graphView === 'diagram'} className={graphView === 'diagram' ? 'on' : ''} onClick={() => chooseGraphView('diagram')}>
        {t.netViewDiagram}
      </button>
    </div>
  );
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
    return {
      pubs: rows.length,
      noPdf: rows.filter((r) => !r.hasPdf).length,
      pending: graph.identityReviews.filter((r) => !r.decision).length + graph.fileLinks.filter((l) => l.status === 'ambiguous').length,
    };
  }, [graph, rows]);

  const onReview = async (edgeId: string, action: ReviewAction) => {
    if (!projectId) return;
    setGraph(await api.edgeReview(projectId, edgeId, action));
  };
  const onCategory = async (pubId: string, value: string | null | undefined) => {
    if (!projectId) return;
    setGraph(await api.category(projectId, pubId, value));
  };
  const showGraph = () => {
    setTab('graph');
    setFilters((f) => ({ ...f, mode: 'bibliographic' }));
  };

  const backLabel = panelOpen ? t.backToFiles : tab === 'doc' ? t.backToDocument : tab === 'refs' ? t.backToReferences : t.backToGraph;

  if (!projectId) {
    if (flow) {
      return (
        <UploadFlow
          mode={flow}
          onBack={() => setFlow(undefined)}
          onDone={(id, p, oaStates) => {
            pendingOa.current = oaStates;
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
        <button className="brand-btn" onClick={() => setProjectId(undefined)} aria-label={t.backHomeAria} title={t.backHomeTitle}>
          <BrandMark />
        </button>
        <BackPill className="topbar-back" onClick={() => setProjectId(undefined)} label={t.backToStart} />
        <select className="hdr-project" value={projectId} onChange={(e) => setProjectId(e.target.value || undefined)} aria-label={t.project}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="">{t.moreProjects}</option>
        </select>
        <nav className="tabs" role="tablist" aria-label={t.views}>
          <button role="tab" aria-selected={tab === 'doc'} className={tab === 'doc' ? 'on' : ''} onClick={() => setTab('doc')} title={t.tabDocumentTitle}>
            {t.tabDocument}
            {evidence && evidence.summary.occurrences > 0 ? ` (${t.tabCitations(evidence.summary.occurrences)})` : ''}
          </button>
          <button role="tab" aria-selected={tab === 'refs'} className={tab === 'refs' ? 'on' : ''} onClick={() => setTab('refs')} title={t.tabReferencesTitle}>
            {t.tabReferences}
            {rows.length ? ` (${rows.length})` : ''}
          </button>
          <button role="tab" aria-selected={tab === 'graph'} className={tab === 'graph' ? 'on' : ''} onClick={showGraph} title={t.tabGraphTitle}>
            {t.tabGraph}
          </button>
        </nav>
        {tab === 'graph' && (
          <input
            className="search"
            type="search"
            placeholder={t.searchPlaceholder}
            value={filters.search ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          />
        )}
        {stats && (
          <span className="stats small">
            {t.refsCount(stats.pubs)}
            {stats.noPdf > 0 ? ` · ${t.withoutPdf(stats.noPdf)}` : ''}
            {stats.pending > 0 && <span className="badge warn"> {t.pending(stats.pending)}</span>}
          </span>
        )}
        {tab === 'graph' && !phone && <button onClick={() => setLayoutNonce((n) => n + 1)}>{t.relayout}</button>}
        <button className="primary topbar-files" onClick={() => setPanelOpen(true)}>
          {t.filesAndReview}
        </button>
        <HeaderControls onFiles={phone ? () => setPanelOpen(true) : undefined} onGraph={phone ? showGraph : undefined} />
      </header>
      {error && (
        <div className="notice error" onClick={() => setError(undefined)}>
          {error === '__browser__' ? t.errorBrowser : error === '__api__' ? t.errorApiDown : translateRuntime(t, error)}
        </div>
      )}
      {docMode && !graph && (
        <div className="loading">
          <span className="spinner" /> {t.loadingProject}
        </div>
      )}
      {((phone && tab !== 'graph' && phoneTab === 'doc') || (!phone && docMode)) && graph && (
        <div className="main">
          <DocumentView
            projectId={projectId}
            graph={graph}
            evidence={evidence}
            focus={docFocus}
            onOpenReference={openReference}
            onShowInGraph={(pubId) => {
              setDocMode(false);
              setSelection({ type: 'node', id: pubId });
            }}
            onOpenFiles={() => {
              setTab('refs');
              setPhoneTab('refs');
            }}
            onEvidence={setEvidence}
            onGraph={setGraph}
          />
        </div>
      )}
      {((phone && tab !== 'graph' && phoneTab === 'refs') || (!phone && tab === 'refs')) && graph && (
        <div className="main">
          <ReferencesView
            projectId={projectId}
            graph={graph}
            evidence={evidence}
            oa={oa}
            setOa={setOa}
            onGraph={setGraph}
            onOpen={openReference}
            onShowInDocument={showInDocument}
            onShowInGraph={(pubId) => {
              showGraph();
              setSelection({ type: 'node', id: pubId });
            }}
          />
        </div>
      )}
      {phone && tab !== 'graph' && phoneTab === 'source' && graph && (
        <div className="main main-source">
          {sourceRequest ? (
            <PdfViewer projectId={projectId} request={sourceRequest} embedded onClose={() => setPhoneTab('doc')} />
          ) : (
            <div className="doc-empty">
              <h2>{t.tabSourceEmpty}</h2>
              <p className="muted">{t.tabSourceEmptyHint}</p>
              <button type="button" className="primary" onClick={() => setPhoneTab('refs')}>
                {t.tabReferences}
              </button>
            </div>
          )}
        </div>
      )}
      {tab === 'graph' && (
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
            refCounts={refCounts}
            network={networkOn}
          />
          <div className="canvas">
            {graph && networkOn && netView ? (
              <NetworkGraph
                projectId={projectId}
                graph={graph}
                view={netView}
                filters={filters}
                onFilters={setFilters}
                years={years}
                docCitations={docCitations}
                openalexIds={openalexIds}
                selection={selection}
                onSelect={setSelection}
                search={filters.search ?? ''}
                layoutNonce={layoutNonce}
                exportName={projectId}
                viewSwitch={viewSwitch}
              />
            ) : graph && view ? (
              <ReactFlowProvider>
                {viewSwitch && <div className="view-switch-float">{viewSwitch}</div>}
                <GraphCanvas
                  view={view}
                  rules={rules}
                  selection={selection}
                  onSelect={setSelection}
                  onToggleGroup={toggleGroup}
                  layoutNonce={layoutNonce}
                  search={filters.search ?? ''}
                  exportName={projectId}
                  colorBy={filters.colorBy}
                  docCitations={docCitations}
                  citeBreakdown={citeBreakdown}
                />
              </ReactFlowProvider>
            ) : (
              <div className="loading">
                <span className="spinner" /> {t.buildingGraph}
              </div>
            )}
            {graph && Object.keys(graph.files).length === 0 && (
              <div className="empty-card">
                <h2>{t.startByUploading}</h2>
                <p className="muted">{t.startByUploadingHint}</p>
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
              onOpen={openReference}
              docCitations={docCitations}
              onShowInDocument={showInDocument}
              onReview={onReview}
              onCategory={onCategory}
              refRows={rowsById}
            />
          )}
        </div>
      )}
      {viewer && !phone && <PdfViewer projectId={projectId} request={viewer} backLabel={backLabel} onClose={() => setViewer(undefined)} />}
      {panelOpen && graph && (
        <ProjectPanel
          projectId={projectId}
          graph={graph}
          externalAvailable={externalAvailable}
          onGraph={setGraph}
          onOpen={(r) => {
            openReference(r);
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
      {phone ? (
        <MobileBottomNav
          tab={tab === 'graph' ? undefined : phoneTab}
          onTab={(next) => {
            setPhoneTab(next);
            // any tab leaves the graph; "source" keeps the document as the underlying desktop tab
            setTab(next === 'refs' ? 'refs' : 'doc');
          }}
        />
      ) : !phone ? (
        <nav className="m-tabs" role="tablist" aria-label={t.views}>
          <button type="button" role="tab" aria-selected={tab === 'doc'} className={tab === 'doc' ? 'on' : ''} onClick={() => setTab('doc')}>
            {t.tabDocument}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'refs'} className={tab === 'refs' ? 'on' : ''} onClick={() => setTab('refs')}>
            {t.tabReferences}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'graph'} className={tab === 'graph' ? 'on' : ''} onClick={showGraph}>
            {t.tabGraph}
          </button>
        </nav>
      ) : null}
    </div>
  );
}
