/** Grouping and filtering of citation occurrences for the document view (pure, unit-tested). */
import type { CitationOccurrence, EvidenceReport, EvidenceStatus } from './evidence.js';
import type { CitationGraph, PublicationNode } from './model.js';

export type GroupStatus = EvidenceStatus | 'unresolved' | 'sem_pdf';
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

const SEVERITY: Record<GroupStatus, number> = { localizado: 1, sem_pdf: 2, ressalva: 3, nao_localizado: 4, unresolved: 5 };

/** View-level status: a missing/unreadable PDF is not the same as “we looked and found nothing”. */
export const occurrenceStatus = (o: CitationOccurrence): GroupStatus => {
  if (o.resolution !== 'resolved') return 'unresolved';
  const st = o.status ?? 'nao_localizado';
  if (st === 'nao_localizado' && (o.reason === 'sem_pdf' || o.reason === 'sem_texto')) return 'sem_pdf';
  return st;
};

/**
 * Turns extracted PDF text into readable paragraphs. pdf.js often yields one long line
 * (“só um bloco”); sentence boundaries become paragraph breaks. Soft-hyphen line wraps
 * are joined when the extractor did keep newlines.
 */
export function formatPassage(text: string): string {
  let s = text.replace(/\u00ad/g, '').replace(/\r\n?/g, '\n').trim();
  if (!s) return s;
  if (s.includes('\n')) {
    s = s.replace(/(\w)-\n(\w)/g, '$1$2').replace(/[^\S\n]*\n[^\S\n]*/g, '\n');
    s = s.replace(/([^\n])\n(?!\n)/g, '$1 ').replace(/\n{3,}/g, '\n\n');
    return s.trim();
  }
  return s.replace(/([.!?…])\s+(?=[A-ZÁÉÍÓÚÀÂÊÔÃÕÄÖÜÇ“"'])/g, '$1\n\n').trim();
}

/** Splits a formatted passage so the exact focus sentence can be marked. */
export function passageParts(text: string, focus?: string): { text: string; highlight: boolean }[] {
  const formatted = formatPassage(text);
  if (!formatted) return [];
  if (!focus) return [{ text: formatted, highlight: false }];
  const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const needle = fold(formatPassage(focus));
  if (!needle) return [{ text: formatted, highlight: false }];
  let folded = '';
  const map: number[] = [];
  for (let i = 0; i < formatted.length; ) {
    const ch = formatted[i];
    const piece = fold(ch);
    for (const c of piece) {
      folded += c;
      map.push(i);
    }
    i += ch.length;
  }
  const at = folded.indexOf(needle);
  if (at < 0) return [{ text: formatted, highlight: false }];
  const start = map[at];
  const last = map[at + needle.length - 1];
  const end = last + ([...formatted.slice(last)][0]?.length ?? 1);
  const out: { text: string; highlight: boolean }[] = [];
  if (start > 0) out.push({ text: formatted.slice(0, start), highlight: false });
  out.push({ text: formatted.slice(start, end), highlight: true });
  if (end < formatted.length) out.push({ text: formatted.slice(end), highlight: false });
  return out;
}



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
  sem_pdf: number;
}

/** Counts of occurrences (not groups), the same unit as the report summary. */
export function countByStatus(report: Pick<EvidenceReport, 'occurrences'>): StatusCounts {
  const c: StatusCounts = { all: 0, localizado: 0, ressalva: 0, nao_localizado: 0, unresolved: 0, sem_pdf: 0 };
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
  sem_pdf: 'Sem PDF',
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

/** What needs the writer's attention in a project, for the "Checkup" panel. */
export interface ProjectCheckup {
  counts: StatusCounts;
  /** Markers that match no entry of the reference list (e.g. "Yin (2001)"), unique, in reading order. */
  unresolved: { marker: string; page: number; count: number }[];
  /** Citations whose year differs from the listed one, per reference: "Araújo e Sartori (2004)" vs 2003. */
  yearMismatch: { publicationId: string; cited: string; listed: string; count: number }[];
  /** Citations whose author name is spelled differently from the list. */
  nameMismatch: { publicationId: string; cited: string; listed: string; count: number }[];
  /** Cited references without the source PDF, most cited first (never-cited ones are in `uncited`). */
  noPdf: string[];
  /** Listed references never cited in the text. */
  uncited: string[];
}

export function projectCheckup(graph: Pick<CitationGraph, 'nodes'>, report: Pick<EvidenceReport, 'occurrences'>): ProjectCheckup {
  const counts = countByStatus(report);
  const unresolved = new Map<string, { marker: string; page: number; count: number }>();
  const approx = { year: new Map<string, ProjectCheckup['yearMismatch'][number]>(), name: new Map<string, ProjectCheckup['nameMismatch'][number]>() };
  const cited = new Map<string, number>();
  for (const o of report.occurrences) {
    if (o.publicationId) cited.set(o.publicationId, (cited.get(o.publicationId) ?? 0) + 1);
    if (o.resolution === 'unresolved') {
      const key = o.marker.replace(/^(?:segundo|conforme|de acordo com|according to|según)\s+/i, '').trim();
      const u = unresolved.get(key) ?? { marker: key, page: o.page, count: 0 };
      u.count++;
      unresolved.set(key, u);
    }
    if (o.approx && o.publicationId && (o.approx.kind === 'year' || o.approx.kind === 'name')) {
      const bucket = approx[o.approx.kind];
      const key = `${o.publicationId}|${o.approx.cited}|${o.approx.listed}`;
      const e = bucket.get(key) ?? { publicationId: o.publicationId, cited: o.approx.cited, listed: o.approx.listed, count: 0 };
      e.count++;
      bucket.set(key, e);
    }
  }
  const pubs = Object.values(graph.nodes).filter((n): n is PublicationNode => n.kind === 'publication' && Boolean(n.inMainBibliography));
  const byCount = (a: string, b: string) => (cited.get(b) ?? 0) - (cited.get(a) ?? 0);
  return {
    counts,
    unresolved: [...unresolved.values()],
    yearMismatch: [...approx.year.values()].sort((a, b) => b.count - a.count),
    nameMismatch: [...approx.name.values()].sort((a, b) => b.count - a.count),
    noPdf: pubs.filter((p) => p.fileIds.length === 0 && cited.has(p.id)).map((p) => p.id).sort(byCount),
    uncited: pubs.filter((p) => !cited.has(p.id)).map((p) => p.id),
  };
}
