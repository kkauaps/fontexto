/** Grouping and filtering of citation occurrences for the document view (pure, unit-tested). */
import type { CitationOccurrence, EvidenceReport, EvidenceStatus } from './evidence.js';

export type GroupStatus = EvidenceStatus | 'unresolved';
export type StatusFilter = 'all' | GroupStatus;

export interface CitationGroup {
  spanId: string;
  marker: string;
  page: number;
  nthOnPage: number;
  occurrences: CitationOccurrence[];
  /** Worst status among the occurrences (so a doubtful reference is never hidden by a good one). */
  status: GroupStatus;
}

const SEVERITY: Record<GroupStatus, number> = { localizado: 1, ressalva: 2, nao_localizado: 3, unresolved: 4 };

export const occurrenceStatus = (o: CitationOccurrence): GroupStatus => (o.resolution === 'resolved' ? (o.status ?? 'nao_localizado') : 'unresolved');

/** Occurrences sharing one marker (a parenthetical with several references), in document order. */
export function groupOccurrences(report: Pick<EvidenceReport, 'occurrences'>): CitationGroup[] {
  const groups = new Map<string, CitationGroup>();
  for (const o of report.occurrences) {
    const g = groups.get(o.spanId);
    if (g) g.occurrences.push(o);
    else groups.set(o.spanId, { spanId: o.spanId, marker: o.marker, page: o.page, nthOnPage: o.nthOnPage, occurrences: [o], status: 'localizado' });
  }
  for (const g of groups.values()) {
    g.status = g.occurrences.map(occurrenceStatus).reduce((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a));
  }
  return [...groups.values()];
}

export interface GroupFilters {
  status: StatusFilter;
  publicationId?: string;
  search?: string;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function filterGroups(groups: CitationGroup[], f: GroupFilters, labelOf: (pubId: string) => string = (id) => id): CitationGroup[] {
  const q = f.search ? fold(f.search.trim()) : '';
  return groups.filter((g) => {
    if (f.publicationId && !g.occurrences.some((o) => o.publicationId === f.publicationId)) return false;
    if (f.status !== 'all' && !g.occurrences.some((o) => occurrenceStatus(o) === f.status)) return false;
    if (q) {
      const hay = fold([g.marker, ...g.occurrences.flatMap((o) => [o.sentence, o.publicationId ? labelOf(o.publicationId) : ''])].join(' '));
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export interface StatusCounts {
  all: number;
  localizado: number;
  ressalva: number;
  nao_localizado: number;
  unresolved: number;
}

/** Counts of occurrences (not groups), the same unit as the report summary. */
export function countByStatus(report: Pick<EvidenceReport, 'occurrences'>): StatusCounts {
  const c: StatusCounts = { all: 0, localizado: 0, ressalva: 0, nao_localizado: 0, unresolved: 0 };
  for (const o of report.occurrences) {
    c.all++;
    c[occurrenceStatus(o)]++;
  }
  return c;
}

/** Number of citation occurrences per publication (all statuses). */
export function occurrencesByPublication(report: Pick<EvidenceReport, 'occurrences'>): Map<string, number> {
  const m = new Map<string, number>();
  for (const o of report.occurrences) if (o.publicationId) m.set(o.publicationId, (m.get(o.publicationId) ?? 0) + 1);
  return m;
}

/** Next/previous group (wrapping) relative to `current`; the first/last one when `current` is not in the list. */
export function neighbourGroup(list: CitationGroup[], current: string | undefined, dir: 1 | -1): CitationGroup | undefined {
  if (list.length === 0) return undefined;
  const i = list.findIndex((g) => g.spanId === current);
  if (i < 0) return dir === 1 ? list[0] : list[list.length - 1];
  return list[(i + dir + list.length) % list.length];
}

export const STATUS_TEXT: Record<GroupStatus, string> = {
  localizado: 'Localizado',
  ressalva: 'Ressalva',
  nao_localizado: 'Não localizado',
  unresolved: 'Referência não identificada',
};

export const REASON_TEXT: Record<string, string> = {
  sem_pdf: 'PDF da referência não enviado',
  sem_texto: 'PDF sem texto extraível',
  frase_curta: 'frase com pouco conteúdo para buscar',
  sem_passagem: 'nenhuma passagem parecida',
  baixa_similaridade: 'só parte dos termos coincide',
  numero_ausente: 'número da frase não aparece no PDF da fonte',
  pagina_citada: 'página citada não confere',
  citacao_direta: 'citação direta não encontrada literalmente',
  so_resumo: 'só o resumo parece tratar do tema',
  fonte_sem_trecho: 'nota de fonte de quadro: o apoio está nas linhas do próprio quadro',
};
