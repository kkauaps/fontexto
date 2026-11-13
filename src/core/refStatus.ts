/**
 * One verification status per bibliography entry, derived from the citation checks of the main document.
 * Drives the graph colors and the "Referências" table, so both say the same thing.
 */
import type { EvidenceReport } from './evidence.js';
import type { CitationGraph, PublicationNode } from './model.js';

export type RefStatus = 'ok' | 'ressalva' | 'nao_localizado' | 'sem_pdf' | 'nao_citada';

export interface RefRow {
  pub: PublicationNode;
  status: RefStatus;
  counts: { localizado: number; ressalva: number; nao_localizado: number };
  citations: number;
  hasPdf: boolean;
  /** Occurrences the researcher labelled by hand. */
  manual: number;
}

export const REF_STATUS_ORDER: RefStatus[] = ['ok', 'ressalva', 'nao_localizado', 'sem_pdf', 'nao_citada'];

export const REF_STATUS_TEXT: Record<RefStatus, string> = {
  ok: 'Citações localizadas',
  ressalva: 'Com ressalva',
  nao_localizado: 'Trecho não localizado',
  sem_pdf: 'Sem PDF da fonte',
  nao_citada: 'Não citada no texto',
};

export const REF_STATUS_COLOR: Record<RefStatus, string> = {
  ok: '#0f9aa6',
  ressalva: '#d9a21f',
  nao_localizado: '#6b7385',
  sem_pdf: '#94a3b8',
  nao_citada: '#cbd5e1',
};

/**
 * Worst status wins among the occurrences that could be checked: ressalva > não localizado > ok.
 * A source without PDF is "sem PDF" (never red, never "não existe": it exists, we just cannot read it).
 */
export function refRows(graph: CitationGraph, evidence: Pick<EvidenceReport, 'occurrences'> | undefined): RefRow[] {
  const byPub = new Map<string, RefRow['counts'] & { manual: number; total: number }>();
  for (const o of evidence?.occurrences ?? []) {
    if (!o.publicationId || o.resolution !== 'resolved') continue;
    const c = byPub.get(o.publicationId) ?? { localizado: 0, ressalva: 0, nao_localizado: 0, manual: 0, total: 0 };
    c.total++;
    if (o.override) c.manual++;
    const st = o.status ?? 'nao_localizado';
    if (st === 'nao_localizado' && !o.override && (o.reason === 'sem_pdf' || o.reason === 'sem_texto')) {
      /* not checkable: counted in total only */
    } else c[st]++;
    byPub.set(o.publicationId, c);
  }
  const rows: RefRow[] = [];
  for (const n of Object.values(graph.nodes)) {
    if (n.kind !== 'publication') continue;
    const c = byPub.get(n.id);
    const hasPdf = n.fileIds.length > 0;
    if (!c && !n.inMainBibliography) continue;
    const counts = { localizado: c?.localizado ?? 0, ressalva: c?.ressalva ?? 0, nao_localizado: c?.nao_localizado ?? 0 };
    const checked = counts.localizado + counts.ressalva + counts.nao_localizado;
    const status: RefStatus = !c
      ? 'nao_citada'
      : counts.ressalva > 0
        ? 'ressalva'
        : counts.nao_localizado > 0
          ? 'nao_localizado'
          : checked > 0
            ? 'ok'
            : 'sem_pdf';
    rows.push({ pub: n, status, counts, citations: c?.total ?? 0, hasPdf, manual: c?.manual ?? 0 });
  }
  return rows.sort((a, b) => REF_STATUS_ORDER.indexOf(a.status) - REF_STATUS_ORDER.indexOf(b.status) || a.pub.label.localeCompare(b.pub.label));
}

export function refStatusMap(rows: RefRow[]): Map<string, RefStatus> {
  return new Map(rows.map((r) => [r.pub.id, r.status]));
}
