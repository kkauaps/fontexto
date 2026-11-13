import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  getNodesBounds,
  getViewportForBounds,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import { toPng, toSvg } from 'html-to-image';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CategoryRule } from '../../core/categories';
import { neighbourhood, type ViewEdge, type ViewGraph, type ViewNode } from '../../core/view';
import { REF_STATUS_COLOR, REF_STATUS_ORDER, REF_STATUS_TEXT, type RefStatus } from '../../core/refStatus';
import { categoryColor } from '../labels';
import { layoutGraph, nodeSize, statusGridLayout, type Positioned } from '../layout';

export type Selection = { type: 'node'; id: string } | { type: 'edge'; id: string } | undefined;

interface NodeData extends Record<string, unknown> {
  vn: ViewNode;
  color: string;
  dim: boolean;
  selected: boolean;
  onToggleGroup?: (category: string) => void;
}

const handleStyle = { opacity: 0, width: 6, height: 6, border: 'none' };

const PublicationNodeView = memo(({ data }: NodeProps<Node<NodeData>>) => {
  const { vn, color, dim, selected } = data;
  const { width, height } = nodeSize(vn);
  return (
    <div
      className={`node-pub${dim ? ' dim' : ''}${selected ? ' selected' : ''}${vn.matchesSearch ? ' match' : ''}${vn.hasPdf ? '' : ' no-pdf'}`}
      style={{ width, height, borderColor: color, ['--cat' as string]: color }}
      title={`${vn.title ?? vn.label}${vn.refStatus ? `\nSituação: ${REF_STATUS_TEXT[vn.refStatus]}` : ''}${vn.hasPdf ? '' : '\n(PDF da fonte não enviado)'}\nClique para ver detalhes`}
    >
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <span className="node-label">{vn.label}</span>
      {vn.inDegree > 1 && <span className="node-badge" title="Citado por N nós visíveis">{vn.inDegree}</span>}
      <Handle type="source" position={Position.Right} style={handleStyle} />
    </div>
  );
});

const DocumentNodeView = memo(({ data }: NodeProps<Node<NodeData>>) => {
  const { vn, dim, selected } = data;
  const { width, height } = nodeSize(vn);
  return (
    <div className={`node-doc${dim ? ' dim' : ''}${selected ? ' selected' : ''}`} style={{ width, height }} title={vn.title ?? vn.label}>
      <span className="node-kicker">Documento principal</span>
      <span className="node-label">{vn.label}</span>
      <Handle type="source" position={Position.Right} style={handleStyle} />
      <Handle type="target" position={Position.Left} style={handleStyle} />
    </div>
  );
});

const GroupNodeView = memo(({ data }: NodeProps<Node<NodeData>>) => {
  const { vn, color, dim, selected, onToggleGroup } = data;
  const { width, height } = nodeSize(vn);
  return (
    <div className={`node-group${dim ? ' dim' : ''}${selected ? ' selected' : ''}`} style={{ width, height, borderColor: color, ['--cat' as string]: color }}>
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <span className="node-label">{vn.label}</span>
      <span className="node-sub">{vn.groupSize} publicações (recolhido)</span>
      <button className="node-expand nodrag" onClick={(e) => (e.stopPropagation(), onToggleGroup?.(vn.category))} title="Expandir grupo">
        +
      </button>
      <Handle type="source" position={Position.Right} style={handleStyle} />
    </div>
  );
});

const nodeTypes = { publication: PublicationNodeView, document: DocumentNodeView, group: GroupNodeView, claim: PublicationNodeView, evidence: PublicationNodeView };

const EDGE_STYLE: Record<string, { stroke: string; dash?: string; width: number; arrow: boolean }> = {
  'cites:confirmed': { stroke: '#3c4657', width: 1.4, arrow: true },
  'cites:unverified': { stroke: '#8a94a6', dash: '6 4', width: 1.4, arrow: true },
  'cites:rejected': { stroke: '#b8c0cc', dash: '2 4', width: 1, arrow: true },
  'related_to:suggested': { stroke: '#8e6bbf', dash: '1 5', width: 1.6, arrow: false },
  'related_to:validated': { stroke: '#8e6bbf', dash: '4 4', width: 1.6, arrow: false },
  'related_to:rejected': { stroke: '#b8c0cc', dash: '1 5', width: 1, arrow: false },
};

export function edgeStyleFor(e: Pick<ViewEdge, 'kind' | 'status'>) {
  return EDGE_STYLE[`${e.kind}:${e.status}`] ?? { stroke: '#6b7385', width: 1.2, arrow: e.kind !== 'related_to', dash: e.status === 'confirmed' || e.status === 'validated' ? undefined : '5 4' };
}

interface Props {
  view: ViewGraph;
  rules: CategoryRule[];
  selection: Selection;
  onSelect: (s: Selection) => void;
  onToggleGroup: (category: string) => void;
  layoutNonce: number;
  search: string;
  exportName: string;
  colorBy?: 'status' | 'category';
}

export function GraphCanvas({ view, rules, selection, onSelect, onToggleGroup, layoutNonce, search, exportName, colorBy = 'category' }: Props) {
  const rf = useReactFlow();
  const [positions, setPositions] = useState<Map<string, Positioned>>(new Map());
  const [layingOut, setLayingOut] = useState(false);
  const structureKey = useMemo(() => view.nodes.map((n) => n.id).join('|') + '#' + view.edges.map((e) => e.id).join('|'), [view]);
  // Latest view, read by the layout effect, which only re-runs when the structure changes
  // (not on search/selection), so the user's viewport and drags are preserved.
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    let cancelled = false;
    setLayingOut(true);
    const v = viewRef.current;
    const docIds = new Set(v.nodes.filter((n) => n.kind === 'document').map((n) => n.id));
    const starOnly = v.edges.every((e) => docIds.has(e.source) && e.kind !== 'related_to');
    (starOnly ? Promise.resolve(statusGridLayout(v)) : layoutGraph(v))
      .then((pos) => {
        if (cancelled) return;
        setPositions(pos);
        requestAnimationFrame(() => rf.fitView({ padding: 0.12, duration: 300 }));
      })
      .finally(() => !cancelled && setLayingOut(false));
    return () => {
      cancelled = true;
    };
  }, [structureKey, layoutNonce, rf]);

  const focus = useMemo(() => {
    if (!selection) return undefined;
    if (selection.type === 'node') return neighbourhood(view, selection.id);
    const e = view.edges.find((x) => x.id === selection.id);
    return e ? { nodes: new Set([e.source, e.target]), edges: new Set([e.id]) } : undefined;
  }, [selection, view]);

  const nodes: Node<NodeData>[] = useMemo(
    () =>
      view.nodes.map((vn) => {
        const p = positions.get(vn.id);
        const size = nodeSize(vn);
        return {
          id: vn.id,
          type: vn.kind,
          width: size.width,
          height: size.height,
          position: { x: p?.x ?? 0, y: p?.y ?? 0 },
          data: {
            vn,
            color: colorBy === 'status' && vn.refStatus ? REF_STATUS_COLOR[vn.refStatus] : categoryColor(vn.category, rules),
            dim: Boolean(focus && !focus.nodes.has(vn.id)),
            selected: selection?.type === 'node' && selection.id === vn.id,
            onToggleGroup,
          },
          hidden: !p,
        };
      }),
    [view, positions, rules, focus, selection, onToggleGroup, colorBy],
  );

  const edges: Edge[] = useMemo(
    () =>
      view.edges.map((e) => {
        const fromDoc = view.nodes.find((n) => n.id === e.source)?.kind === 'document';
        const st = colorBy === 'status' && fromDoc && e.status === 'confirmed' ? { stroke: '#c5d3cd', width: 1, arrow: false, dash: undefined } : edgeStyleFor(e);
        const dim = Boolean(focus && !focus.edges.has(e.id));
        const sel = selection?.type === 'edge' && selection.id === e.id;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: 'default',
          label: e.count > 1 ? `×${e.count}` : undefined,
          interactionWidth: 14,
          style: { stroke: sel ? '#10b981' : st.stroke, strokeWidth: sel ? st.width + 1.4 : st.width, strokeDasharray: st.dash, opacity: dim ? 0.12 : 1 },
          markerEnd: st.arrow ? { type: MarkerType.ArrowClosed, color: sel ? '#10b981' : st.stroke, width: 16, height: 16 } : undefined,
          zIndex: sel ? 10 : 0,
        };
      }),
    [view, focus, selection, colorBy],
  );
  const legend = useMemo(() => {
    const c = new Map<RefStatus, number>();
    for (const n of view.nodes) if (n.refStatus) c.set(n.refStatus, (c.get(n.refStatus) ?? 0) + 1);
    return REF_STATUS_ORDER.filter((s) => c.get(s)).map((s) => ({ s, n: c.get(s) as number }));
  }, [view]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setPositions((prev) => {
      let next: Map<string, Positioned> | undefined;
      for (const c of changes) {
        if (c.type === 'position' && c.position) {
          next ??= new Map(prev);
          const old = next.get(c.id);
          if (old) next.set(c.id, { ...old, x: c.position.x, y: c.position.y });
        }
      }
      return next ?? prev;
    });
  }, []);

  // Center on search results.
  useEffect(() => {
    if (!search.trim()) return;
    const hits = view.nodes.filter((n) => n.matchesSearch).map((n) => ({ id: n.id }));
    if (hits.length) rf.fitView({ nodes: hits, maxZoom: 1.3, padding: 0.4, duration: 350 });
  }, [search, view, rf]);

  const doExport = useCallback(
    async (format: 'svg' | 'png') => {
      const el = document.querySelector<HTMLElement>('.react-flow__viewport');
      if (!el) return;
      const bounds = getNodesBounds(rf.getNodes().filter((n) => !n.hidden));
      const width = Math.min(8000, Math.max(800, bounds.width + 160));
      const height = Math.min(8000, Math.max(600, bounds.height + 160));
      const vp = getViewportForBounds(bounds, width, height, 0.05, 4, 0.08);
      const opts = {
        backgroundColor: '#ffffff',
        width,
        height,
        style: { width: `${width}px`, height: `${height}px`, transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` },
        pixelRatio: format === 'png' ? 2 : 1,
      };
      const url = format === 'svg' ? await toSvg(el, opts) : await toPng(el, opts);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${exportName}.${format}`;
      a.click();
    },
    [rf, exportName],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={(_, n) => onSelect({ type: 'node', id: n.id })}
      onEdgeClick={(_, e) => onSelect({ type: 'edge', id: e.id })}
      onPaneClick={() => onSelect(undefined)}
      nodesConnectable={false}
      elementsSelectable
      minZoom={0.05}
      maxZoom={3}
      onlyRenderVisibleElements={view.nodes.length > 300}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} size={1} color="#e0ece6" />
      <Controls showInteractive={false} position="bottom-left" />
      <MiniMap pannable zoomable nodeColor={(n) => (n.data as NodeData).color} position="bottom-right" />
      {colorBy === 'status' && legend.length > 0 && (
        <Panel position="top-left" className="graph-legend" aria-label="Legenda">
          {legend.map(({ s, n }) => (
            <span key={s}>
              <i style={{ background: REF_STATUS_COLOR[s] }} /> {REF_STATUS_TEXT[s]} ({n})
            </span>
          ))}
          <span className="muted">borda tracejada = PDF da fonte não enviado · clique num nó para detalhes</span>
        </Panel>
      )}
      <Panel position="top-right" className="canvas-actions">
        {layingOut && <span className="muted small">organizando…</span>}
        <button onClick={() => rf.fitView({ padding: 0.12, duration: 300 })}>Centralizar</button>
        <button onClick={() => doExport('svg')}>SVG</button>
        <button onClick={() => doExport('png')}>PNG</button>
      </Panel>
      {view.nodes.length === 0 && (
        <Panel position="top-center" className="empty-state">
          Nenhum nó para exibir com os filtros atuais.
        </Panel>
      )}
    </ReactFlow>
  );
}
