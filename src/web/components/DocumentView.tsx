import { SemanticNotice } from './SemanticNotice';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EvidenceReport } from '../../core/evidence';
import type { CitationGraph } from '../../core/model';
import { countByStatus, filterGroups, groupOccurrences, neighbourGroup, occurrencesByPublication, STATUS_TEXT, type CitationGroup, type GroupStatus, type StatusFilter } from '../../core/evidenceView';
import { api } from '../api';
import { locatePhraseBoxes, openPdf, renderPage, type BoxRect, type PdfDoc } from '../pdfRender';
import { CitationList, CitationPanel } from './CitationPanel';
import { SetupChecklist, UploadButton } from './SetupChecklist';
import type { OpenRequest } from './SidePanel';

export interface DocumentFocus {
  pubId?: string;
  spanId?: string;
  nonce: number;
}

interface Props {
  projectId: string;
  graph: CitationGraph;
  evidence: EvidenceReport | undefined;
  focus?: DocumentFocus;
  onOpenReference: (r: OpenRequest) => void;
  onShowInGraph: (pubId: string) => void;
  onOpenFiles: () => void;
  /** A manual label changed only the evidence report (the graph is the same). */
  onEvidence: (e: EvidenceReport) => void;
  onGraph: (g: CitationGraph) => void;
}

interface Mark {
  id: string;
  phrase: string;
  nth: number;
  status: GroupStatus;
  fallback: { rects: CitationGroup['occurrences'][0]['rects']; pageSize: CitationGroup['occurrences'][0]['pageSize'] };
}

interface Placed {
  id: string;
  boxes: BoxRect[];
  approximate: boolean;
}

const STATUS_CHIPS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'Todas' },
  { key: 'localizado', label: STATUS_TEXT.localizado },
  { key: 'ressalva', label: STATUS_TEXT.ressalva },
  { key: 'nao_localizado', label: STATUS_TEXT.nao_localizado },
  { key: 'sem_pdf', label: STATUS_TEXT.sem_pdf },
  { key: 'unresolved', label: STATUS_TEXT.unresolved },
];

function PageView({ doc, n, scale, size, marks, selected, onMark, scroller }: { doc: PdfDoc; n: number; scale: number; size: { w: number; h: number }; marks: Mark[]; selected?: string; onMark: (id: string) => void; scroller: HTMLElement | null }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(n <= 2);
  const [dims, setDims] = useState(size);
  const [ready, setReady] = useState(0);
  const [placed, setPlaced] = useState<Placed[]>([]);

  useEffect(() => {
    if (!wrapRef.current || !scroller) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => setNear(e.isIntersecting)), { root: scroller, rootMargin: '1400px 0px' });
    io.observe(wrapRef.current);
    return () => io.disconnect();
  }, [scroller]);

  useEffect(() => {
    setDims(size);
  }, [size.w, size.h]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const layer = layerRef.current;
    if (!canvas || !layer) return;
    if (!near) {
      canvas.width = 0;
      canvas.height = 0;
      layer.replaceChildren();
      setPlaced([]);
      return;
    }
    let cancelled = false;
    let cancel: (() => void) | undefined;
    renderPage(doc, n, scale, canvas, layer).then(async (r) => {
      cancel = r.cancel;
      if (cancelled) return r.cancel();
      setDims({ w: r.width, h: r.height });
      await r.done;
      if (!cancelled) setReady((x) => x + 1);
    });
    return () => {
      cancelled = true;
      cancel?.();
    };
  }, [doc, n, scale, near]);

  const marksKey = marks.map((m) => `${m.id}:${m.status}`).join('|');
  useEffect(() => {
    const layer = layerRef.current;
    if (!near || !layer || ready === 0) return;
    const out: Placed[] = [];
    for (const m of marks) {
      const hit = locatePhraseBoxes(layer, m.phrase, m.nth);
      if (hit) out.push({ id: m.id, boxes: hit.boxes, approximate: !hit.exact });
      else if (m.fallback.rects.length && m.fallback.pageSize.width > 0) {
        // line-level rectangles reported by the extractor (the marker text could not be found in the text layer)
        const sx = dims.w / m.fallback.pageSize.width;
        const sy = dims.h / m.fallback.pageSize.height;
        out.push({ id: m.id, approximate: true, boxes: m.fallback.rects.map((r) => ({ left: r.x * sx, top: r.y * sy, width: r.w * sx, height: r.h * sy })) });
      }
    }
    setPlaced(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, ready, marksKey, dims.w, dims.h]);

  const statusOf = new Map(marks.map((m) => [m.id, m.status]));
  return (
    <div ref={wrapRef} id={`docpage-${n}`} className="doc-page" style={{ width: dims.w, height: dims.h }}>
      <canvas ref={canvasRef} />
      <div ref={layerRef} className="ct-textlayer" />
      {placed.flatMap((p) =>
        p.boxes.map((b, i) => (
          <div
            key={`${p.id}-${i}`}
            data-span={p.id}
            className={`cm cm-${statusOf.get(p.id) ?? 'ressalva'}${selected === p.id ? ' sel' : ''}${p.approximate ? ' approx' : ''}`}
            style={{ left: b.left - 1, top: b.top - 1, width: b.width + 2, height: b.height + 2 }}
            title={`${STATUS_TEXT[statusOf.get(p.id) ?? 'ressalva']} · clique para ver a evidência`}
            onClick={() => onMark(p.id)}
          />
        )),
      )}
      <span className="doc-page-no">p. {n}</span>
    </div>
  );
}

export function DocumentView({ projectId, graph, evidence, focus, onOpenReference, onShowInGraph, onOpenFiles, onGraph, onEvidence }: Props) {
  const [doc, setDoc] = useState<PdfDoc | undefined>();
  const [docError, setDocError] = useState<string | undefined>();
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 612 * 1.2, h: 792 * 1.2 });
  const [scale, setScale] = useState(1.2);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [pubFilter, setPubFilter] = useState<string | undefined>(focus?.pubId);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | undefined>(focus?.spanId);
  const [scrollNonce, setScrollNonce] = useState(0);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const scrollerRef = useCallback((el: HTMLDivElement | null) => setScroller(el), []);

  const labelOf = useCallback((id: string) => graph.nodes[id]?.label ?? id, [graph]);
  const groups = useMemo(() => (evidence ? groupOccurrences(evidence) : []), [evidence]);
  const counts = useMemo(() => (evidence ? countByStatus(evidence) : undefined), [evidence]);
  const filtered = useMemo(() => filterGroups(groups, { status, publicationId: pubFilter, search }, labelOf), [groups, status, pubFilter, search, labelOf]);
  const pubOptions = useMemo(() => {
    if (!evidence) return [];
    const by = occurrencesByPublication(evidence);
    return [...by.entries()].map(([id, n]) => ({ id, n, label: labelOf(id) })).sort((a, b) => a.label.localeCompare(b.label));
  }, [evidence, labelOf]);

  // jump requests coming from the graph
  useEffect(() => {
    if (!focus) return;
    setPubFilter(focus.pubId);
    setStatus('all');
    setSearch('');
    if (focus.spanId) {
      setSelected(focus.spanId);
      setScrollNonce((x) => x + 1);
    } else {
      // land on the first citation of the requested reference (the list button still goes back to all of them)
      const first = focus.pubId ? groups.find((g) => g.occurrences.some((o) => o.publicationId === focus.pubId)) : undefined;
      setSelected(first?.spanId);
      if (first) setScrollNonce((x) => x + 1);
    }
  }, [focus?.nonce, groups.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const mainFileId = evidence?.mainFileId;
  useEffect(() => {
    if (!mainFileId) {
      setDoc(undefined);
      return;
    }
    let cancelled = false;
    setDocError(undefined);
    let task: ReturnType<typeof openPdf> | undefined;
    api
      .pdfSource(projectId, mainFileId)
      .then(async (source) => {
        if (cancelled) return;
        task = openPdf(source);
        const d = await task.promise;
        const p1 = await d.getPage(1);
        const vp = p1.getViewport({ scale });
        if (cancelled) return;
        setSize({ w: vp.width, h: vp.height });
        setDoc(d);
      })
      .catch((e: Error) => !cancelled && setDocError(e.message));
    return () => {
      cancelled = true;
      task?.destroy().catch(() => undefined);
    };
  }, [projectId, mainFileId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!doc) return;
    doc.getPage(1).then((p) => {
      const vp = p.getViewport({ scale });
      setSize({ w: vp.width, h: vp.height });
    });
  }, [doc, scale]);

  const marksByPage = useMemo(() => {
    const m = new Map<number, Mark[]>();
    for (const g of filtered) {
      const first = g.occurrences[0];
      const list = m.get(g.page) ?? [];
      // numeric markers: use the extractor's box (a text search for "3" would hit any number on the page)
      list.push({ id: g.spanId, phrase: /^[[(]?\d/.test(g.marker) ? '' : g.marker, nth: g.nthOnPage, status: g.status, fallback: { rects: first.rects, pageSize: first.pageSize } });
      m.set(g.page, list);
    }
    return m;
  }, [filtered]);

  const select = useCallback((spanId: string | undefined, jump = false) => {
    setSelected(spanId);
    if (jump && spanId) setScrollNonce((x) => x + 1);
  }, []);

  // bring the selected citation into view (the page may still be rendering)
  useEffect(() => {
    if (!selected || !scroller || !doc) return;
    const g = groups.find((x) => x.spanId === selected);
    if (!g) return;
    let frames = 0;
    let raf = 0;
    document.getElementById(`docpage-${g.page}`)?.scrollIntoView({ block: 'start' });
    const tick = () => {
      const el = scroller.querySelector(`[data-span="${selected}"]`);
      if (el) el.scrollIntoView({ block: 'center' });
      else if (frames++ < 240) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scrollNonce, !!doc, scroller]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.viewer, .drawer')) return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      setSelected(undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const selectedGroup = selected ? groups.find((g) => g.spanId === selected) : undefined;
  const step = (dir: 1 | -1) => {
    const g = neighbourGroup(filtered, selected, dir);
    if (g) select(g.spanId, true);
  };

  if (!evidence)
    return (
      <div className="loading">
        <span className="spinner" /> Localizando as citações do documento…
      </div>
    );
  if (!mainFileId) {
    return (
      <div className="doc-empty">
        <h2>Abra o seu documento</h2>
        <p className="muted">Envie o PDF do trabalho e a bibliografia. Cada citação do texto fica marcada; ao clicar nela você vê a frase, a referência e o trecho encontrado no artigo citado.</p>
        <SetupChecklist projectId={projectId} graph={graph} onGraph={onGraph} />
      </div>
    );
  }
  const hasBib = Object.values(graph.files).some((f) => f.role === 'bibtex');
  const refsWithoutPdf = evidence.summary.semPdf;

  return (
    <div className="docview">
      <div className="doc-main">
        <div className="doc-toolbar">
          <div className="doc-chips" role="group" aria-label="Filtrar por status">
            {STATUS_CHIPS.map((c) => (
              <button key={c.key} className={`chip-filter st-${c.key}${status === c.key ? ' on' : ''}`} onClick={() => setStatus(c.key)} aria-pressed={status === c.key}>
                {c.label} <b>{counts?.[c.key] ?? 0}</b>
              </button>
            ))}
          </div>
          {counts && counts.all > 0 && (
            <div className="statbar" title="Proporção de cada status entre as citações">
              {(['localizado', 'ressalva', 'nao_localizado', 'sem_pdf', 'unresolved'] as const).map((k) => (counts[k] > 0 ? <span key={k} className={`seg st-${k}`} style={{ flexGrow: counts[k] }} /> : null))}
            </div>
          )}
          <select value={pubFilter ?? ''} onChange={(e) => setPubFilter(e.target.value || undefined)} aria-label="Filtrar por referência">
            <option value="">Todas as referências</option>
            {pubOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} ({p.n})
              </option>
            ))}
          </select>
          <input type="search" placeholder="Buscar na frase ou referência" value={search} onChange={(e) => setSearch(e.target.value)} />
          <span className="doc-nav">
            <button onClick={() => step(-1)} disabled={filtered.length === 0} title="Citação anterior">
              ‹
            </button>
            <span className="small muted">{filtered.length} marcações no texto</span>
            <button onClick={() => step(1)} disabled={filtered.length === 0} title="Próxima citação">
              ›
            </button>
            <button onClick={() => setScale((s) => Math.max(0.7, +(s - 0.15).toFixed(2)))} title="Diminuir">
              −
            </button>
            <button onClick={() => setScale((s) => Math.min(2.4, +(s + 0.15).toFixed(2)))} title="Aumentar">
              +
            </button>
          </span>
        </div>
        {!hasBib && (
          <div className="notice">
            Sem bibliografia (.bib), as citações não podem ser ligadas às referências.{' '}
            <UploadButton projectId={projectId} role="reference" accept=".bib,text/plain" primary onGraph={onGraph}>
              Enviar .bib
            </UploadButton>
          </div>
        )}
        {hasBib && refsWithoutPdf > 0 && (
          <div className="notice">
            {refsWithoutPdf} citação(ões) sem o PDF da referência; sem ele não há trecho para mostrar.{' '}
            <UploadButton projectId={projectId} role="reference" accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" multiple onGraph={onGraph}>
              Buscar ou enviar PDFs das referências
            </UploadButton>
          </div>
        )}
        {hasBib && evidence.summary.occurrences > 0 && <SemanticNotice projectId={projectId} method={evidence.method} onGraph={onGraph} />}
        {docError && <div className="notice error">{docError}</div>}
        <div className="doc-pages" ref={scrollerRef}>
          {doc ? (
            Array.from({ length: doc.numPages }, (_, i) => i + 1).map((n) => (
              <PageView key={n} doc={doc} n={n} scale={scale} size={size} marks={marksByPage.get(n) ?? []} selected={selected} onMark={(id) => select(id)} scroller={scroller} />
            ))
          ) : (
            <div className="loading doc-loading">
              <span className="spinner" /> Abrindo o PDF…
            </div>
          )}
        </div>
      </div>
      <aside className="doc-side">
        {selectedGroup ? (
          <CitationPanel
            key={selectedGroup.spanId}
            projectId={projectId}
            graph={graph}
            group={selectedGroup}
            method={evidence.method}
            onBack={() => select(undefined)}
            onOpenReference={onOpenReference}
            onShowInGraph={onShowInGraph}
            onOpenFiles={onOpenFiles}
            onLabel={async (occId, status) => onEvidence(await api.evidenceLabel(projectId, occId, status))}
          />
        ) : (
          <CitationList groups={filtered} graph={graph} onSelect={(id) => select(id, true)} method={evidence.method} />
        )}
      </aside>
    </div>
  );
}
