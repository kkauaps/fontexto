/**
 * Exports and privacy redaction.
 *
 * `redactForSharing` produces a copy of the graph that is safe to share: public
 * bibliographic metadata is kept, while text derived from private files
 * (reference snippets, citation context, evidence passages, file names and
 * storage paths) is removed.
 */
import type { Anchor, CitationGraph, FileRecord, GraphNode, Provenance } from './model.js';

export const REDACTED = '[redacted: private document]';

function redactAnchor(a: Anchor | undefined, privateFiles: Set<string>): Anchor | undefined {
  if (!a) return a;
  if (!privateFiles.has(a.fileId)) return { ...a };
  return { fileId: a.fileId, page: a.page };
}

export function redactForSharing(graph: CitationGraph): CitationGraph {
  const g: CitationGraph = JSON.parse(JSON.stringify(graph));
  const privateFiles = new Set(Object.values(g.files).filter((f) => f.visibility !== 'shareable').map((f) => f.id));

  const files: Record<string, FileRecord> = {};
  for (const f of Object.values(g.files)) {
    const isPrivate = privateFiles.has(f.id);
    files[f.id] = {
      ...f,
      originalName: isPrivate ? REDACTED : f.originalName,
      // Storage paths are machine-specific and never shared.
      storage: { kind: 'managed', relPath: '' },
      sha256: isPrivate ? '' : f.sha256,
      extraction: { status: f.extraction.status },
    };
  }
  g.files = files;

  for (const e of Object.values(g.edges)) {
    e.provenance = e.provenance.map((p): Provenance => {
      const fromPrivate = p.sourceFileId !== undefined && privateFiles.has(p.sourceFileId);
      return {
        ...p,
        referenceText: fromPrivate && p.referenceText ? REDACTED : p.referenceText,
        text: fromPrivate && p.text ? REDACTED : p.text,
        referenceAnchor: redactAnchor(p.referenceAnchor, privateFiles),
        citationAnchors: p.citationAnchors?.map((a) => redactAnchor(a, privateFiles)!),
        evidenceAnchor: redactAnchor(p.evidenceAnchor, privateFiles),
      };
    });
    e.reviews = e.reviews?.map((r) => ({ ...r, note: undefined }));
  }

  for (const [id, n] of Object.entries(g.nodes) as [string, GraphNode][]) {
    if (n.kind === 'document' && n.fileId && privateFiles.has(n.fileId)) {
      g.nodes[id] = { ...n, label: 'Documento principal (privado)', title: undefined };
    }
    if ((n.kind === 'claim' || n.kind === 'evidence') && n.anchor && privateFiles.has(n.anchor.fileId)) {
      g.nodes[id] = { ...n, text: REDACTED, label: REDACTED, anchor: redactAnchor(n.anchor, privateFiles)! } as GraphNode;
    }
  }

  g.unresolvedReferences = g.unresolvedReferences.map((u) => (privateFiles.has(u.fileId) ? { ...u, text: REDACTED } : u));
  g.citationIssues = g.citationIssues.map((c) => (privateFiles.has(c.fileId) ? { ...c, marker: REDACTED } : c));
  g.warnings = [];
  return g;
}

const xml = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Strip characters not allowed in XML 1.0.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

/** GraphML export (yEd / Gephi / Cytoscape compatible). Always redacted. */
export function toGraphML(graph: CitationGraph): string {
  const g = redactForSharing(graph);
  const nodeKeys = ['label', 'kind', 'title', 'authors', 'year', 'doi', 'venue', 'category', 'category_source', 'has_pdf'] as const;
  const edgeKeys = ['kind', 'status', 'methods'] as const;
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    ...nodeKeys.map((k) => `  <key id="n_${k}" for="node" attr.name="${k}" attr.type="string"/>`),
    ...edgeKeys.map((k) => `  <key id="e_${k}" for="edge" attr.name="${k}" attr.type="string"/>`),
    `  <graph id="${xml(g.projectId)}" edgedefault="directed">`,
  ];
  for (const n of Object.values(g.nodes).sort((a, b) => a.id.localeCompare(b.id))) {
    const pub = n.kind === 'publication' ? n : undefined;
    const data: Record<(typeof nodeKeys)[number], unknown> = {
      label: n.label,
      kind: n.kind,
      title: pub?.title ?? (n.kind === 'document' ? n.title : undefined),
      authors: pub?.authors.map((a) => a.raw).join('; '),
      year: pub?.year,
      doi: pub?.doi,
      venue: pub?.venue,
      category: pub?.category?.value,
      category_source: pub?.category?.source,
      has_pdf: pub ? String(pub.fileIds.length > 0) : undefined,
    };
    out.push(`    <node id="${xml(n.id)}">`);
    for (const k of nodeKeys) if (data[k] !== undefined && data[k] !== '') out.push(`      <data key="n_${k}">${xml(data[k])}</data>`);
    out.push('    </node>');
  }
  for (const e of Object.values(g.edges).sort((a, b) => a.id.localeCompare(b.id))) {
    out.push(`    <edge id="${xml(e.id)}" source="${xml(e.source)}" target="${xml(e.target)}">`);
    out.push(`      <data key="e_kind">${xml(e.kind)}</data>`);
    out.push(`      <data key="e_status">${xml(e.status)}</data>`);
    out.push(`      <data key="e_methods">${xml([...new Set(e.provenance.map((p) => p.method))].join(','))}</data>`);
    out.push('    </edge>');
  }
  out.push('  </graph>', '</graphml>');
  return out.join('\n') + '\n';
}
