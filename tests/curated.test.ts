import { describe, expect, it } from 'vitest';
import { applyCurated, pairCurated, parseCuratedIndexHtml, parseCuratedUpload } from '../src/core/curated.js';
import type { CitationOccurrence, EvidenceReport } from '../src/core/evidence.js';
import { summarizeOccurrences } from '../src/core/evidence.js';
import type { CitationGraph } from '../src/core/model.js';

const occ = (id: string, pub: string, sentence: string, status: CitationOccurrence['status'] = 'nao_localizado', reason: CitationOccurrence['reason'] = 'sem_passagem'): CitationOccurrence => ({
  id, spanId: id, marker: '(X, 2020)', page: 1, nthOnPage: 0, rects: [], pageSize: { width: 1, height: 1 }, resolution: 'resolved', publicationId: pub, candidates: [],
  sentence, claim: sentence, referenceFileId: 'f1', status, reason, notes: [], score: 0.1, passages: [{ fileId: 'f1', page: 9, text: 'auto', score: 0.2, region: 'corpo' }],
});
const graph = { nodes: { p1: { kind: 'publication', bibKeys: ['kang2026'] }, p2: { kind: 'publication', bibKeys: ['oquab2024'] } }, files: { f1: { pageCount: 20 } } } as unknown as CitationGraph;
const report = (occurrences: CitationOccurrence[]): EvidenceReport => ({ schemaVersion: 1, projectId: 'x', builtAt: 't', method: '', params: {} as never, summary: summarizeOccurrences(occurrences), occurrences });

const html = `<p>Primeira frase. A segmentação por paciente evita vazamento (<a data-id="c1" id="a-c1">Kang et al., 2026</a>). Outra.</p>
<p>O DINOv2 aprende características (<a data-id="c2">Odrany et al., 2024</a>).</p><p>Fonte: (<a data-id="c3">Kang et al., 2026</a>)</p>
<script type="application/json" id="cit-data">${JSON.stringify([
  { id: 'c1', key: 'kang2026', status: 'ok', notes: [], quotes: [{ page: 5, text: 'divided on a patient-to-patient basis', region: 'corpo' }] },
  { id: 'c2', key: 'oquab2024', status: 'part', notes: ['só o resumo'], quotes: [{ page: 3, text: 'transferable frozen features', region: 'resumo' }] },
  { id: 'c3', key: 'kang2026', status: 'fonte', notes: [], quotes: [] },
])}</script>`;

describe('curated evidence', () => {
  const curated = parseCuratedIndexHtml(html, 'index.html', 't');
  it('reads statuses, pages and the citing sentence from an index.html', () => {
    expect(curated.items.map((i) => i.status)).toEqual(['localizado', 'ressalva', 'nao_localizado']);
    expect(curated.items[0].passages[0]).toMatchObject({ page: 5, region: 'corpo' });
    expect(curated.items[0].sentence).toContain('segmentação por paciente');
    expect(curated.items[2].sourceNote).toBe(true);
    expect(parseCuratedUpload(JSON.stringify(curated), 'c.json').items).toHaveLength(3);
  });
  it('rejects an html without data', () => {
    expect(() => parseCuratedIndexHtml('<p>x</p>', 'a.html')).toThrow(/cit-data/);
  });
  it('pairs by key and order and replaces the automatic verdict, keeping it for comparison', () => {
    const r = report([occ('a', 'p1', 'A segmentação por paciente evita vazamento'), occ('b', 'p2', 'O DINOv2 aprende características'), occ('c', 'p1', 'Fonte: Kang')]);
    const { report: out, result } = applyCurated(graph, r, curated);
    expect(result.applied).toBe(3);
    const [a, b, c] = out.occurrences;
    expect(a).toMatchObject({ status: 'localizado' });
    expect(a.passages[0]).toMatchObject({ page: 5, curated: true, fileId: 'f1' });
    expect(a.curated).toMatchObject({ autoStatus: 'nao_localizado', autoReason: 'sem_passagem' });
    expect(b.status).toBe('ressalva');
    expect(b.notes).toContain('só o resumo');
    expect(c).toMatchObject({ status: 'nao_localizado', reason: 'fonte_sem_trecho', passages: [] });
    expect(out.summary).toMatchObject({ localizado: 1, ressalva: 1, nao_localizado: 1 });
  });
  it('falls back to sentence similarity when counts differ and leaves weak pairs automatic', () => {
    const r = report([occ('a', 'p1', 'A segmentação por paciente evita vazamento'), occ('z', 'p1', 'Algo totalmente diferente sobre outra coisa'), occ('y', 'p1', 'Mais uma frase sem relação alguma')]);
    const { pairs, differing } = pairCurated(graph, r, curated);
    expect(differing).toContain('kang2026');
    expect(pairs.get('a')?.status).toBe('localizado');
    expect(pairs.has('z')).toBe(false);
  });
  it('maps curated keys onto this project\'s keys by author+year, and pairs the rest by sentence', () => {
    // the project's own .bib uses other keys: "kang2026" (same), "oquab2024dinov2" (review) vs "oquab2024" (project)
    const g2 = { nodes: { p1: { kind: 'publication', bibKeys: ['kang2026'] }, p2: { kind: 'publication', bibKeys: ['oquab2024'] } }, files: { f1: { pageCount: 20 } } } as unknown as CitationGraph;
    const c2 = { ...curated, items: curated.items.map((i) => (i.key === 'oquab2024' ? { ...i, key: 'oquab2024dinov2' } : i)) };
    const r = report([occ('a', 'p1', 'A segmentação por paciente evita vazamento'), occ('b', 'p2', 'O DINOv2 aprende características'), occ('c', 'p1', 'Fonte: Kang')]);
    const { pairs } = pairCurated(g2, r, c2);
    expect(pairs.get('b')?.status).toBe('ressalva');
    expect(pairs.size).toBe(3);
    // an unrelated key (corporate author with another slug) is paired by sentence similarity
    const c3 = { ...curated, items: curated.items.map((i) => (i.key === 'oquab2024' ? { ...i, key: 'dinov2docs' } : i)) };
    expect(pairCurated(g2, r, c3).pairs.get('b')?.status).toBe('ressalva');
  });
  it('drops curated passages beyond the PDF page count', () => {
    const c = { ...curated, items: [{ ...curated.items[0], passages: [{ page: 99, text: 'x', region: 'corpo' as const }] }] };
    const { report: out } = applyCurated(graph, report([occ('a', 'p1', 'A segmentação por paciente evita vazamento')]), c);
    expect(out.occurrences[0].passages).toEqual([]);
  });
});
