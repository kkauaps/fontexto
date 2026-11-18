import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CitationGraph, PublicationNode } from '../../core/model';
import { buildNetwork, OTHER_CLUSTER, type NetInput, type NetNode, type NetType, type SizeBy } from '../../core/network';
import { boundsOf, layoutNetwork, type LaidOut } from '../../core/networkLayout';
import { REF_STATUS_COLOR } from '../../core/refStatus';
import type { ViewFilters, ViewGraph } from '../../core/view';
import { useAppearance } from '../appearance';
import { isPhoneWidth } from '../fit';
import { useI18n } from '../i18n';
import { canvasPainter, drawScene, fontOf, LIGHT_PALETTE, type Palette } from '../networkDraw';
import { fetchConnections, graphItems, loadConnections, saveConnections, type Progress, type StoredConnections } from '../networkData';
import { download, exportPng, exportSvg } from '../networkExport';
import type { Selection } from './GraphCanvas';

interface Props {
  projectId: string;
  graph: CitationGraph;
  view: ViewGraph;
  filters: ViewFilters;
  onFilters: (f: ViewFilters) => void;
  years: { min?: number; max?: number };
  docCitations?: Map<string, number>;
  openalexIds: Record<string, string | undefined>;
  selection: Selection;
  onSelect: (s: Selection) => void;
  search: string;
  layoutNonce: number;
  exportName: string;
  viewSwitch?: React.ReactNode;
}

type Phase = { kind: 'idle' } | { kind: 'running'; p: Progress } | { kind: 'done'; p: Progress } | { kind: 'failed' };
const TYPES: NetType[] = ['article', 'book', 'thesis', 'web', 'other'];

function readPalette(el: HTMLElement | null, theme: string): Palette {
  if (!el || theme === 'light') return LIGHT_PALETTE;
  const cs = getComputedStyle(el);
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  return { text: v('--text', '#eceef1'), muted: v('--muted', '#9aa3af'), halo: v('--bg', '#121417'), edge: v('--muted', '#9aa3af'), cites: v('--text', '#eceef1'), docFill: '#10B981', docText: '#05221a', accent: v('--accent', '#10B981'), ring: v('--bg', '#121417') };
}

export function NetworkGraph({ projectId, graph, view, filters, onFilters, years, docCitations, openalexIds, selection, onSelect, search, layoutNonce, exportName, viewSwitch }: Props) {
  const { t } = useI18n();
  const { appearance } = useAppearance();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [stored, setStored] = useState<StoredConnections | undefined>(() => loadConnections(projectId));
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [sizeBy, setSizeBy] = useState<SizeBy>('inText');
  const [colorMode, setColorMode] = useState<'topic' | 'status'>('topic');
  const [timeline, setTimeline] = useState(false);
  const [showDoc, setShowDoc] = useState(true);
  const [onlyLinked, setOnlyLinked] = useState(false);
  const [hiddenClusters, setHiddenClusters] = useState<Set<string>>(new Set());
  const [hiddenTypes, setHiddenTypes] = useState<Set<NetType>>(new Set());
  const [hover, setHover] = useState<string | undefined>();
  const [tip, setTip] = useState<{ x: number; y: number; id: string } | undefined>();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(() => !isPhoneWidth());
  const transform = useRef<ZoomTransform>(zoomIdentity);
  const zoomer = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | undefined>(undefined);
  const raf = useRef(0);
  const abort = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    setStored(loadConnections(projectId));
    setPhase({ kind: 'idle' });
    return () => abort.current?.abort();
  }, [projectId]);

  // ---- data -> network
  const works = useMemo(() => new Map(Object.entries(stored?.works ?? {})), [stored]);
  const net = useMemo(() => {
    const inputs: NetInput[] = [];
    for (const vn of view.nodes) {
      if (vn.kind !== 'document' && vn.kind !== 'publication') continue;
      const g = graph.nodes[vn.id] as PublicationNode | undefined;
      inputs.push({ id: vn.id, kind: vn.kind, label: vn.label, title: vn.title, year: vn.year, entryType: g?.kind === 'publication' ? g.entryType : undefined, url: g?.kind === 'publication' ? g.url : undefined, inText: docCitations?.get(vn.id) ?? 0 });
    }
    const ids = new Set(inputs.map((n) => n.id));
    const docIds = new Set(inputs.filter((n) => n.kind === 'document').map((n) => n.id));
    const docEdges = view.edges.filter((e) => docIds.has(e.source) && ids.has(e.target) && e.kind === 'cites');
    return buildNetwork(inputs, works, docEdges);
  }, [view, graph, works, docCitations]);

  const refStatus = useMemo(() => new Map(view.nodes.map((n) => [n.id, n.refStatus])), [view]);
  const clusterColor = useMemo(() => new Map(net.clusters.map((c) => [c.key, c.color])), [net]);
  const colorOf = useCallback(
    (n: NetNode) => {
      if (colorMode === 'status') {
        const s = refStatus.get(n.id);
        if (s) return REF_STATUS_COLOR[s];
      }
      return clusterColor.get(n.cluster) ?? '#9AA3AF';
    },
    [colorMode, refStatus, clusterColor],
  );

  // portrait screens (phones) get a taller arrangement; only the orientation matters, not every resize
  const portrait = size.h > size.w * 1.2;
  const pos = useMemo(() => layoutNetwork(net, { sizeBy, timeline, showDoc, aspect: portrait ? 1.5 : 0.72 }), [net, sizeBy, timeline, showDoc, portrait, layoutNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const linked = new Set<string>();
    for (const e of net.edges) if (e.kind !== 'doc') (linked.add(e.source), linked.add(e.target));
    return net.nodes.filter((n) => {
      if (!pos.has(n.id)) return false;
      if (n.kind === 'document') return showDoc;
      if (hiddenClusters.has(n.cluster)) return false;
      if (hiddenTypes.has(n.type)) return false;
      if (onlyLinked && !linked.has(n.id)) return false;
      return true;
    });
  }, [net, pos, hiddenClusters, hiddenTypes, onlyLinked, showDoc]);
  const shownIds = useMemo(() => new Set(shown.map((n) => n.id)), [shown]);
  const shownEdges = useMemo(() => net.edges.filter((e) => shownIds.has(e.source) && shownIds.has(e.target)), [net, shownIds]);
  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of shownEdges) {
      if (e.kind === 'doc') continue;
      if (!m.has(e.source)) m.set(e.source, new Set());
      if (!m.has(e.target)) m.set(e.target, new Set());
      m.get(e.source)?.add(e.target);
      m.get(e.target)?.add(e.source);
    }
    return m;
  }, [shownEdges]);
  const selectedId = selection?.type === 'node' ? selection.id : undefined;
  const focusId = hover ?? selectedId;
  const focus = useMemo(() => {
    if (!focusId || !shownIds.has(focusId)) return undefined;
    const node = net.nodes.find((n) => n.id === focusId);
    if (node?.kind === 'document') return undefined;
    return new Set([focusId, ...(neighbours.get(focusId) ?? [])]);
  }, [focusId, neighbours, shownIds, net]);
  const matches = useMemo(() => (search.trim() ? new Set(view.nodes.filter((n) => n.matchesSearch).map((n) => n.id)) : undefined), [search, view]);
  const linkCount = useMemo(() => net.edges.filter((e) => e.kind !== 'doc').length, [net]);
  const topicCount = net.clusters.filter((c) => c.key !== OTHER_CLUSTER).length;

  // ---- drawing
  const palette = useMemo(() => readPalette(wrap.current, appearance.theme), [appearance.theme, size]); // eslint-disable-line react-hooks/exhaustive-deps
  const draw = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const tr = transform.current;
    const phone = size.w < 600;
    const labels = Math.round(Math.min(shown.length, (phone ? 6 : 14) * Math.max(1, tr.k) ** 1.6));
    drawScene(canvasPainter(ctx), shown, shownEdges, pos, {
      k: tr.k,
      tx: tr.x,
      ty: tr.y,
      palette,
      colorOf,
      focus,
      hover,
      selected: selectedId,
      matches,
      maxLabels: labels,
      labelSize: phone ? 11 : 12,
      measure: (s, sz, w) => ((ctx.font = fontOf(sz, w)), ctx.measureText(s).width),
      minR: phone ? 3 : 2.5,
    });
  }, [size, shown, shownEdges, pos, palette, colorOf, focus, hover, selectedId, matches]);
  const schedule = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(draw);
  }, [draw]);
  useEffect(schedule, [schedule]);

  // canvas size follows the container
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(50, Math.round(r.width)), h: Math.max(50, Math.round(r.height)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    c.style.width = `${size.w}px`;
    c.style.height = `${size.h}px`;
    schedule();
  }, [size, schedule]);

  // zoom & pan (wheel, drag, pinch)
  const drawRef = useRef(schedule);
  drawRef.current = schedule;
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const z = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.08, 8])
      .clickDistance(4)
      .on('zoom', (ev: { transform: ZoomTransform }) => {
        transform.current = ev.transform;
        drawRef.current();
      });
    zoomer.current = z;
    select(c).call(z).on('dblclick.zoom', null);
    return () => void select(c).on('.zoom', null);
  }, []);

  const fit = useCallback(
    (only?: Set<string>) => {
      const c = canvas.current;
      const z = zoomer.current;
      if (!c || !z) return;
      const pts: LaidOut[] = [];
      for (const n of shown) {
        if (only && !only.has(n.id)) continue;
        const q = pos.get(n.id);
        if (q) pts.push(q);
      }
      if (!pts.length) return;
      const b = boundsOf(pts, 30);
      const pad = size.w < 600 ? 12 : 24;
      // the controls float over the top of the canvas (and the topic legend over the bottom on phones): fit the
      // picture in the free area between them, not under them
      const box = c.getBoundingClientRect();
      const host = c.parentElement;
      const topBar = host?.querySelector<HTMLElement>('.net-top')?.getBoundingClientRect();
      const legend = host?.querySelector<HTMLElement>('.net-legend')?.getBoundingClientRect();
      const top = topBar && topBar.height ? Math.max(0, topBar.bottom - box.top) + 8 : 0;
      const bottom = legend && legend.height && size.w < 600 ? Math.max(0, box.bottom - legend.top) + 8 : 0;
      const availH = Math.max(80, size.h - top - bottom);
      const k = Math.min((size.w - pad * 2) / (b.maxX - b.minX), (availH - pad * 2) / (b.maxY - b.minY), only ? 2.2 : 1.6);
      const tr = zoomIdentity
        .translate(size.w / 2, top + availH / 2)
        .scale(k)
        .translate(-(b.minX + b.maxX) / 2, -(b.minY + b.maxY) / 2);
      select(c).call(z.transform, tr);
    },
    [shown, pos, size],
  );
  // refit when the picture changes shape (not on hover/selection)
  const fitKey = `${[...shownIds].sort().join(',')}|${timeline}|${sizeBy}|${size.w}x${size.h}|${layoutNonce}|${net.edges.length}`;
  useEffect(() => fit(), [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (matches?.size) fit(matches);
  }, [matches]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- picking
  const pick = useCallback(
    (clientX: number, clientY: number) => {
      const c = canvas.current;
      if (!c) return undefined;
      const r = c.getBoundingClientRect();
      const [gx, gy] = transform.current.invert([clientX - r.left, clientY - r.top]);
      const k = transform.current.k;
      let best: { id: string; d: number } | undefined;
      for (const n of shown) {
        const q = pos.get(n.id);
        if (!q) continue;
        const d = Math.hypot(q.x - gx, q.y - gy);
        const reach = Math.max(q.r, (size.w < 600 ? 12 : 7) / k) + (n.kind === 'document' ? 3 : 0);
        if (d <= reach && (!best || d < best.d)) best = { id: n.id, d };
      }
      return best ? { id: best.id, x: clientX - r.left, y: clientY - r.top } : undefined;
    },
    [shown, pos, size.w],
  );
  const onMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' || e.buttons) return;
    const h = pick(e.clientX, e.clientY);
    setHover(h?.id);
    setTip(h);
  };
  const onClick = (e: React.MouseEvent) => {
    const h = pick(e.clientX, e.clientY);
    onSelect(h ? { type: 'node', id: h.id } : undefined);
    if (isPhoneWidth()) setTip(h);
  };

  // ---- OpenAlex links
  const findLinks = async () => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    const items = graphItems(graph, openalexIds);
    const total = items.length;
    setPhase({ kind: 'running', p: { done: 0, total, found: 0, busy: 0 } });
    try {
      const { store, busy, failed } = await fetchConnections(
        items,
        stored,
        (p, partial) => {
          setPhase({ kind: 'running', p });
          setStored({ ...partial, works: { ...partial.works } });
        },
        ac.signal,
      );
      saveConnections(projectId, store);
      setStored(store);
      setPhase(failed ? { kind: 'failed' } : { kind: 'done', p: { done: total - busy, total, found: Object.keys(store.works).length, busy } });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setPhase({ kind: 'failed' });
    }
  };

  // ---- export
  const exportAs = async (format: 'png' | 'svg') => {
    setExportOpen(false);
    const doc = net.nodes.find((n) => n.kind === 'document');
    const input = {
      nodes: shown,
      edges: shownEdges,
      pos,
      colorOf,
      legend: net.clusters.filter((c) => c.count > 0).map((c) => ({ color: c.color, label: c.key === OTHER_CLUSTER ? t.netOther : c.label, count: c.count })),
      title: doc?.label ?? exportName,
      subtitle: t.netStats(shown.filter((n) => n.kind === 'publication').length, shownEdges.filter((e) => e.kind !== 'doc').length, topicCount),
      edgeLegend: { cites: t.netEdgeCites, coupling: t.netEdgeCoupling, similar: shownEdges.some((e) => e.kind === 'similar') ? t.netEdgeSimilar : undefined },
      madeWith: t.netMadeWith,
    };
    try {
      if (format === 'png') download(await exportPng(input, 1), `${exportName}-graph.png`);
      else download(new Blob([exportSvg(input)], { type: 'image/svg+xml' }), `${exportName}-graph.svg`);
    } catch (e) {
      console.error('[fontexto] export failed', e);
    }
  };

  const tipNode = tip ? net.nodes.find((n) => n.id === tip.id) : undefined;
  const status =
    phase.kind === 'running'
      ? t.netFinding(phase.p.done, phase.p.total)
      : phase.kind === 'failed'
        ? t.netFailed
        : phase.kind === 'done' && phase.p.busy > 0
          ? t.netBusy(phase.p.busy)
          : net.identified > 0
            ? t.netFoundSummary(net.identified, net.nodes.filter((n) => n.kind === 'publication').length)
            : t.netKeywordsOnly;
  const toggle = <T,>(set: Set<T>, v: T, apply: (s: Set<T>) => void) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    apply(n);
  };
  const typeCounts = useMemo(() => {
    const m = new Map<NetType, number>();
    for (const n of net.nodes) if (n.kind === 'publication') m.set(n.type, (m.get(n.type) ?? 0) + 1);
    return m;
  }, [net]);
  const yearOptions = useMemo(() => {
    if (!years.min || !years.max) return [];
    const out: number[] = [];
    for (let y = years.min; y <= years.max; y++) out.push(y);
    return out;
  }, [years]);
  const filtered = hiddenClusters.size > 0 || hiddenTypes.size > 0 || onlyLinked || filters.yearMin !== undefined || filters.yearMax !== undefined;

  return (
    <div className="net" ref={wrap}>
      <canvas
        ref={canvas}
        className="net-canvas"
        role="img"
        aria-label={`${t.netAria} ${t.netStats(net.nodes.length - (showDoc ? 1 : 0), linkCount, topicCount)}`}
        onPointerMove={onMove}
        onPointerLeave={() => (setHover(undefined), setTip(undefined))}
        onClick={onClick}
        style={{ cursor: hover ? 'pointer' : 'grab' }}
      />
      {tip && tipNode && (
        <div className="net-tip" style={{ left: Math.min(tip.x + 14, size.w - 270), top: Math.min(tip.y + 14, size.h - 120) }} role="tooltip">
          <strong>{tipNode.title ?? tipNode.label}</strong>
          {tipNode.title && tipNode.title !== tipNode.label && (
            <span className="muted">
              {tipNode.label}
              {tipNode.year && !tipNode.label.includes(String(tipNode.year)) ? ` · ${tipNode.year}` : ''}
            </span>
          )}
          {tipNode.kind === 'publication' && (
            <>
              {tipNode.cluster !== OTHER_CLUSTER && (
                <span>
                  <i className="net-dot" style={{ background: clusterColor.get(tipNode.cluster) }} /> {net.clusters.find((c) => c.key === tipNode.cluster)?.label}
                </span>
              )}
              {tipNode.inText > 0 && <span>{t.netInText(tipNode.inText)}</span>}
              {tipNode.degree > 0 && <span>{t.netLinks(tipNode.degree)}</span>}
              {tipNode.citedBy !== undefined && <span className="muted">{t.netCitedBy(tipNode.citedBy)}</span>}
            </>
          )}
        </div>
      )}

      <div className="net-top">
        <div className="net-status">
          {viewSwitch}
          <button className={phase.kind === 'running' ? '' : 'primary'} disabled={phase.kind === 'running'} onClick={findLinks} title={t.netFindLinksTitle}>
            {phase.kind === 'running' && <span className="spinner" />} {net.identified > 0 ? t.netRefreshLinks : t.netFindLinks}
          </button>
          <span className="small muted net-status-text" aria-live="polite">
            {status}
          </span>
        </div>
        <div className="net-actions">
          <button onClick={() => fit()}>{t.centerGraph}</button>
          <div className="net-menu">
            <button aria-expanded={exportOpen} onClick={() => setExportOpen((v) => !v)} title={t.netExportTitle}>
              {t.netExport}
            </button>
            {exportOpen && (
              <div className="net-menu-list" role="menu">
                <button role="menuitem" onClick={() => void exportAs('png')}>
                  {t.netExportPng} · 1600×900
                </button>
                <button role="menuitem" onClick={() => void exportAs('svg')}>
                  {t.netExportSvg}
                </button>
              </div>
            )}
          </div>
          <button aria-expanded={optionsOpen} className={optionsOpen ? 'on' : ''} onClick={() => setOptionsOpen((v) => !v)}>
            {t.netOptions}
          </button>
        </div>
      </div>

      {optionsOpen && (
        <div className="net-options">
          <div className="net-field">
            <span>{t.colors}</span>
            <div className="seg" role="radiogroup" aria-label={t.colorBy}>
              <button role="radio" aria-checked={colorMode === 'topic'} className={colorMode === 'topic' ? 'on' : ''} onClick={() => setColorMode('topic')}>
                {t.theme}
              </button>
              <button role="radio" aria-checked={colorMode === 'status'} className={colorMode === 'status' ? 'on' : ''} onClick={() => setColorMode('status')}>
                {t.situation}
              </button>
            </div>
          </div>
          <label className="net-field">
            <span>{t.netSizeBy}</span>
            <select value={sizeBy} onChange={(e) => setSizeBy(e.target.value as SizeBy)}>
              <option value="inText">{t.netSizeInText}</option>
              <option value="degree">{t.netSizeDegree}</option>
              <option value="citedBy">{t.netSizeCitedBy}</option>
            </select>
          </label>
          {yearOptions.length > 1 && (
            <div className="net-field">
              <span>{t.netYears}</span>
              <div className="net-years">
                <select aria-label={t.netYearFrom} value={filters.yearMin ?? ''} onChange={(e) => onFilters({ ...filters, yearMin: e.target.value ? Number(e.target.value) : undefined })}>
                  <option value="">{t.netYearFrom}</option>
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                <select aria-label={t.netYearTo} value={filters.yearMax ?? ''} onChange={(e) => onFilters({ ...filters, yearMax: e.target.value ? Number(e.target.value) : undefined })}>
                  <option value="">{t.netYearTo}</option>
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {typeCounts.size > 1 && (
          <div className="net-field">
            <span>{t.netTypes}</span>
            <div className="net-chips">
              {TYPES.filter((ty) => typeCounts.get(ty)).map((ty) => (
                <button key={ty} className={`chip-filter${hiddenTypes.has(ty) ? '' : ' on'}`} aria-pressed={!hiddenTypes.has(ty)} onClick={() => toggle(hiddenTypes, ty, setHiddenTypes)}>
                  {t.netType[ty]} ({typeCounts.get(ty)})
                </button>
              ))}
            </div>
          </div>
          )}
          <label className="check">
            <input type="checkbox" checked={timeline} onChange={(e) => setTimeline(e.target.checked)} /> {t.netTimeline}
          </label>
          <label className="check">
            <input type="checkbox" checked={onlyLinked} onChange={(e) => setOnlyLinked(e.target.checked)} /> {t.netOnlyConnected}
          </label>
          <label className="check">
            <input type="checkbox" checked={showDoc} onChange={(e) => setShowDoc(e.target.checked)} /> {t.netShowDoc}
          </label>
          {filtered && (
            <button
              className="linklike"
              onClick={() => {
                setHiddenClusters(new Set());
                setHiddenTypes(new Set());
                setOnlyLinked(false);
                onFilters({ ...filters, yearMin: undefined, yearMax: undefined });
              }}
            >
              {t.netShowAll}
            </button>
          )}
        </div>
      )}

      <div className="net-legend" aria-label={t.legend}>
        <button className="net-legend-head linklike" aria-expanded={legendOpen} onClick={() => setLegendOpen((v) => !v)}>
          <strong className="small">
            {t.netTopics} ({topicCount})
          </strong>
          <span aria-hidden>{legendOpen ? '▾' : '▸'}</span>
        </button>
        {legendOpen && (
        <>
        <div className="net-legend-items">
          {net.clusters.map((c) => (
            <button
              key={c.key}
              className={`net-legend-item${hiddenClusters.has(c.key) ? ' off' : ''}`}
              aria-pressed={!hiddenClusters.has(c.key)}
              onClick={() => toggle(hiddenClusters, c.key, setHiddenClusters)}
              title={c.source === 'keyword' ? t.netKeywordSource : c.label}
            >
              <i className="net-dot" style={{ background: c.color }} />
              <span className="net-legend-label">{c.key === OTHER_CLUSTER ? t.netOther : c.label}</span>
              <span className="muted">{c.count}</span>
            </button>
          ))}
        </div>
        <div className="net-edge-legend small muted">
          <span>
            <svg width="22" height="8" aria-hidden>
              <line x1="1" y1="4" x2="21" y2="4" stroke="currentColor" strokeWidth="1.8" />
            </svg>
            {t.netEdgeCites}
          </span>
          <span>
            <svg width="22" height="8" aria-hidden>
              <line x1="1" y1="4" x2="21" y2="4" stroke="currentColor" strokeWidth="1.4" strokeDasharray="5 4" />
            </svg>
            {t.netEdgeCoupling}
          </span>
          {net.edges.some((e) => e.kind === 'similar') && (
            <span>
              <svg width="22" height="8" aria-hidden>
                <line x1="1" y1="4" x2="21" y2="4" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 4" />
              </svg>
              {t.netEdgeSimilar}
            </span>
          )}
        </div>
        </>
        )}
      </div>
      {shown.length === 0 && <div className="empty-state net-empty">{t.noNodesForFilters}</div>}
    </div>
  );
}
