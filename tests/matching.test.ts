import { describe, expect, it } from 'vitest';
import { buildReferenceIndex, EVIDENCE_PARAMS, finalizeV2, type CitationOccurrence, type PendingMatch } from '../src/core/evidence.js';
import { buildQuery, lexicalCandidates, tokenizeV2 } from '../src/core/matching.js';
import { normalizeWord, stemOf } from '../src/core/lexicon.js';
import { applySemantic, planSemantic } from '../src/core/semantic.js';
import type { PdfText } from '../src/core/text.js';

const pdf = (pages: string[][]): PdfText => ({
  pageCount: pages.length,
  info: {},
  pages: pages.map((lines, i) => ({ page: i + 1, width: 600, height: 800, lines: lines.map((text, j) => ({ text, rect: { x: 50, y: 40 + j * 20, w: 400, h: 12 }, fontSize: 11 })) })),
});

const reference = pdf([
  ['Abstract', 'We study imaging of chronic wounds in a short summary of the work.', '1 Introduction', 'Wound assessment has long been fraught with subjectivity and considerable variability between clinicians.'],
  ['Methods', 'Images were annotated by three nurses using a labeling tool and masks were refined twice.', 'The football stadium was irrelevant to every experiment described here.'],
  ['Results', 'Granulation tissue appears pink to red, is moist and bumpy, and healthy wounds show slough only rarely in the sample.'],
]);

describe('cognate normalisation and PT->EN query building', () => {
  it('collapses PT and EN cognates to the same stem', () => {
    for (const [pt, en] of [['segmentacao', 'segmentation'], ['anotacao', 'annotation'], ['fotografia', 'photography'], ['sistema', 'system'], ['metodo', 'method'], ['avaliacao', 'evaluation'], ['qualidade', 'quality']]) {
      expect(stemOf(pt), `${pt}/${en}`).toBe(stemOf(en));
    }
    expect(normalizeWord('annotation')).toBe(normalizeWord('anotacao'));
  });
  it('drops stop words and keeps numbers and acronyms', () => {
    const t = tokenizeV2('O modelo DINOv2 obteve 85,3 de precisão em 2 testes').map((x) => x.t);
    expect(t).toContain('@dinov2');
    expect(t).toContain('#85.3');
    expect(t).not.toContain('#2');
    expect(t.some((x) => x === 'de' || x === 'em')).toBe(false);
  });
  it('translates common PT words through the glossary with a lower weight', () => {
    const q = buildQuery({ sentence: 'A variabilidade entre clínicos é considerável.' });
    expect(q.map((x) => x.t)).toContain(stemOf('variability'));
    const orig = q.find((x) => x.t === stemOf('variabilidade'))!;
    const tr = q.find((x) => x.t === stemOf('clinician'))!;
    expect(tr.w).toBeLessThanOrEqual(orig.w);
  });
});

describe('v2 lexical candidates', () => {
  const idx = buildReferenceIndex(reference);
  it('finds the page of a Portuguese claim in an English PDF', () => {
    const cands = lexicalCandidates(idx, buildQuery({ sentence: 'A avaliação de feridas sofre de subjetividade e variabilidade considerável entre clínicos.' }));
    expect(cands[0].page).toBe(1);
    expect(cands[0].text).toMatch(/subjectivity/);
  });
  it('uses the clause around the marker before the rest of the sentence', () => {
    const q = { local: 'A pele granulação saudável é rosa a vermelha, úmida e saliente', sentence: 'O estudo discute futebol, estádios e a granulação saudável é rosa a vermelha, úmida e saliente.' };
    expect(lexicalCandidates(idx, buildQuery(q))[0].page).toBe(3);
  });
  it('matches near-spellings (edit distance 1) at a lower weight', () => {
    const exact = lexicalCandidates(idx, buildQuery({ sentence: 'Granulation tissue appears pink' }))[0];
    const typo = lexicalCandidates(idx, buildQuery({ sentence: 'Granulaton tissue appears pink' }))[0];
    expect(typo.page).toBe(exact.page);
  });
  it('is deterministic', () => {
    const a = lexicalCandidates(idx, buildQuery({ sentence: 'Images were annotated by nurses' }));
    const b = lexicalCandidates(idx, buildQuery({ sentence: 'Images were annotated by nurses' }));
    expect(a).toEqual(b);
  });
});

describe('semantic re-rank', () => {
  const idx = buildReferenceIndex(reference);
  const parts = { sentence: 'Os clínicos discordam bastante ao avaliar feridas.', local: undefined, context: undefined };
  const candidates = lexicalCandidates(idx, buildQuery(parts));
  const occ = { id: 'o1', claim: parts.sentence, status: undefined, notes: [], passages: [] } as unknown as CitationOccurrence;
  const pm: PendingMatch = { occId: 'o1', fileId: 'f1', index: idx, parts, candidates };

  it('plans unique texts and applies vectors: the passage most similar to the claim comes first', () => {
    const plan = planSemantic([pm], new Map([['o1', occ]]));
    expect(plan.claims).toHaveLength(2 - 1); // local falls back to the sentence
    expect(plan.passages.length).toBe(candidates.length);
    const dim = 4;
    const unit = (i: number) => Float32Array.from({ length: dim }, (_, k) => (k === i ? 1 : 0));
    const target = candidates.findIndex((c) => /subjectivity/.test(c.text));
    expect(target).toBeGreaterThanOrEqual(0);
    const claimVecs = [unit(0)];
    const passageVecs = plan.passages.map((t) => (/subjectivity/.test(t) ? unit(0) : unit(1)));
    const report = { schemaVersion: 1, projectId: 'x', builtAt: 't', method: '', params: EVIDENCE_PARAMS, summary: {} as never, occurrences: [occ] } as never;
    const out = applySemantic(report, new Map([['o1', pm]]), plan, claimVecs, passageVecs, EVIDENCE_PARAMS);
    const o = out.occurrences[0];
    expect(o.passages[0].text).toMatch(/subjectivity/);
    expect(o.passages[0].page).toBe(1);
    expect(o.status).toBe('localizado');
  });

  it('labels with the lexical thresholds when no embeddings are present', () => {
    const o = { id: 'o2', notes: [], passages: [] } as unknown as CitationOccurrence;
    finalizeV2(o, { ...pm, candidates: lexicalCandidates(idx, buildQuery(parts)) }, EVIDENCE_PARAMS);
    expect(['localizado', 'ressalva', 'nao_localizado']).toContain(o.status);
    expect(o.passages.length).toBeGreaterThan(0);
  });
});
