/** Citation occurrences, sentence segmentation and lexical evidence (synthetic data only). */
import { describe, expect, it } from 'vitest';
import {
  buildFlow,
  buildReferenceIndex,
  computeEvidence,
  EVIDENCE_PARAMS,
  rankPassages,
  redactEvidenceForSharing,
  REDACTED_TEXT,
  segmentSentences,
  tokenize,
} from '../src/core/evidence';
import { bibFixture, fileRecord, build, pdfText } from './helpers/fixtures';

const sentences = (s: string) => segmentSentences(s).map((sp) => s.slice(sp.start, sp.end));

describe('segmentSentences', () => {
  it('splits at sentence ends but not at abbreviations, initials, decimals or et al.', () => {
    const text = 'Quintana et al. (2020) used J. Smith data (p. 12). The Dice was 0.85 on Fig. 3. It improved results. Next one? Yes! Then e.g. this one.';
    expect(sentences(text)).toEqual([
      'Quintana et al. (2020) used J. Smith data (p. 12).',
      'The Dice was 0.85 on Fig. 3.',
      'It improved results.',
      'Next one?',
      'Yes!',
      'Then e.g. this one.',
    ]);
  });

  it('does not split before lowercase text and breaks at paragraph separators', () => {
    expect(sentences('Ver o item 2. nada muda aqui. Fim\u2029Novo parágrafo sem ponto')).toEqual(['Ver o item 2. nada muda aqui.', 'Fim', 'Novo parágrafo sem ponto']);
  });

  it('keeps closing parentheses with the sentence', () => {
    expect(sentences('Isso é comum (SILVA, 2020). Outra frase.')).toEqual(['Isso é comum (SILVA, 2020).', 'Outra frase.']);
  });
});

describe('tokenize', () => {
  it('normalises numbers, stems long words, expands the glossary and keeps acronyms', () => {
    const t = tokenize('Feridas crônicas: 85,88% de IoU com SAM2');
    expect(t).toContain('#85.88');
    expect(t).toContain('ferid');
    expect(t).toContain('wound'); // glossary: ferida -> wound
    expect(t).toContain('@iou');
    expect(t).toContain('@sam2');
  });

  it('matches Portuguese and English cognates through stems', () => {
    const pt = new Set(tokenize('A segmentação de imagens'));
    const en = new Set(tokenize('image segmentation'));
    expect([...pt].filter((x) => en.has(x)).sort()).toEqual(['image', 'segme']);
  });
});

const BIB = bibFixture();
const NOW = '2026-01-01T00:00:00.000Z';

function project(opts: { withQuintanaPdf?: boolean; mainLines?: string[][]; quintanaVisibility?: 'private' | 'shareable' } = {}) {
  const main = fileRecord('main', 'tcc.pdf');
  const quintana = fileRecord('reference', 'quintana.pdf', { visibility: opts.quintanaVisibility ?? 'private' });
  const mainText = pdfText(
    opts.mainLines ?? [
      [
        '1 INTRODUCTION',
        'Wound segmentation is slow and subjective. Quintana et al. (2020) show that gradient lattices improve tissue boundary estimation by 12.5 percent.',
        'The benchmark reports unstable rankings (ALBRECHT; MOREAU, 2018). Calibration of annotators matters (NAKAMURA; SANCHEZ, 2019; QUINTANA et al., 2020).',
        'A source that is not in the bibliography (Foobar, 2001) appears here.',
        'See Quintana et al. (2020).',
      ],
      ['REFERENCES', 'QUINTANA, A. et al. Gradient Lattices for Tissue Boundary Estimation. 2020.', 'ALBRECHT, H.; MOREAU, L. A Benchmark of Imaginary Segmentation Networks. 2018.'],
    ],
  );
  const quintanaText = pdfText([
    [
      'Gradient Lattices for Tissue Boundary Estimation',
      'Aurelio Quintana, Maja Brandt, Tunde Oyelaran',
      'https://doi.org/10.99999/synth.2020.001',
      'Abstract',
      'We study imaginary things about gradient lattices in a short summary of the work.',
      '1 Introduction',
      'Manual tissue marking is slow. Dermatology images were collected from three clinics.',
    ],
    [
      'Gradient lattices improve tissue boundary estimation by 12.5 percent compared with the baseline estimator on all dermatology images.',
      'The unrelated appendix talks about cooking recipes and garden furniture only.',
    ],
    ['References', 'Albrecht H, Moreau L. A benchmark of imaginary segmentation networks. 2018. doi:10.99999/synth.2018.042'],
  ]);
  const files = { [BIB.file.id]: BIB.file, [main.id]: main, ...(opts.withQuintanaPdf === false ? {} : { [quintana.id]: quintana }) };
  const texts = { [main.id]: mainText, ...(opts.withQuintanaPdf === false ? {} : { [quintana.id]: quintanaText }) };
  const graph = build({ files, bib: [{ fileId: BIB.file.id, entries: BIB.entries }], texts });
  return { graph, texts, main, quintana };
}

describe('computeEvidence', () => {
  const { graph, texts, quintana } = project();
  const report = computeEvidence({ projectId: 'test', now: NOW, graph, texts });
  const byMarker = (m: string) => report.occurrences.filter((o) => o.marker === m);

  it('finds each citation occurrence with its citing sentence and page', () => {
    const q = report.occurrences.filter((o) => o.publicationId === 'pub:bib:quintana2020');
    expect(q).toHaveLength(3);
    expect(q[0]).toMatchObject({ page: 1, marker: 'Quintana et al. (2020)', resolution: 'resolved' });
    expect(q[0].sentence).toBe('Quintana et al. (2020) show that gradient lattices improve tissue boundary estimation by 12.5 percent.');
    expect(q[0].rects.length).toBeGreaterThan(0);
  });

  it('keeps one occurrence per publication inside a multi-reference marker, sharing the span', () => {
    const multi = report.occurrences.filter((o) => o.sentence.startsWith('Calibration of annotators'));
    expect(multi.map((o) => o.publicationId).sort()).toEqual(['pub:bib:nakamura2019', 'pub:bib:quintana2020']);
    expect(new Set(multi.map((o) => o.spanId)).size).toBe(1);
  });

  it('removes markers from the searched claim and adds the next sentence only for narrative openers', () => {
    const q0 = report.occurrences.find((o) => o.publicationId === 'pub:bib:quintana2020')!;
    expect(q0.claim).not.toMatch(/Quintana|2020/);
    const albrecht = byMarker('(ALBRECHT; MOREAU, 2018)')[0];
    expect(albrecht.claim).toBe('The benchmark reports unstable rankings.');
    // narrative opener "Quintana et al. (2020) show ..." also pulls the following sentence
    expect(q0.claim).toMatch(/gradient lattices improve tissue boundary estimation/);
    expect(q0.claim).toMatch(/The benchmark reports unstable rankings/);
  });

  it('labels a passage with the same terms and numbers as localizado, with its physical page', () => {
    const q0 = report.occurrences.find((o) => o.publicationId === 'pub:bib:quintana2020')!;
    expect(q0.status).toBe('localizado');
    expect(q0.referenceFileId).toBe(quintana.id);
    expect(q0.passages[0]).toMatchObject({ fileId: quintana.id, page: 2, region: 'corpo' });
    expect(q0.passages[0].text).toMatch(/12\.5 percent/);
    expect(q0.score).toBeGreaterThanOrEqual(EVIDENCE_PARAMS.strong);
  });

  it('reports a missing PDF as nao_localizado with the reason, never as a match', () => {
    const noPdf = report.occurrences.find((o) => o.publicationId === 'pub:bib:albrecht2018')!;
    expect(noPdf).toMatchObject({ status: 'nao_localizado', reason: 'sem_pdf', passages: [] });
    expect(noPdf.notes[0]).toMatch(/PDFs das referências/);
  });

  it('reports sentences without searchable content as frase_curta', () => {
    const last = report.occurrences.filter((o) => o.publicationId === 'pub:bib:quintana2020').at(-1)!;
    expect(last.sentence).toBe('See Quintana et al. (2020).');
    expect(last).toMatchObject({ status: 'nao_localizado', reason: 'frase_curta' });
  });

  it('keeps unresolved markers visible without a status and excludes the bibliography section', () => {
    const foo = byMarker('(Foobar, 2001)');
    expect(foo).toHaveLength(1);
    expect(foo[0].resolution).toBe('unresolved');
    expect(foo[0].publicationId).toBeUndefined();
    expect(foo[0].status).toBeUndefined();
    // markers in the REFERENCES list are not citations
    expect(report.occurrences.every((o) => o.page === 1)).toBe(true);
  });

  it('summarises the counts', () => {
    const s = report.summary;
    expect(s.occurrences).toBe(report.occurrences.length);
    expect(s.localizado + s.ressalva + s.nao_localizado).toBe(s.resolved);
    expect(s.unresolved).toBe(1);
    expect(s.semPdf).toBeGreaterThan(0);
  });

  it('is deterministic and cache-safe', () => {
    const cache = new Map();
    const a = computeEvidence({ projectId: 'test', now: NOW, graph, texts, cache });
    const b = computeEvidence({ projectId: 'test', now: NOW, graph, texts, cache });
    expect(b).toEqual(a);
    expect(a).toEqual(report);
  });
});

describe('statuses by passage quality', () => {
  it('downgrades to ressalva when the passage lacks a number of the claim', () => {
    const { graph, texts } = project({
      mainLines: [['Gradient lattices improve tissue boundary estimation by 99.9 percent on dermatology images (QUINTANA et al., 2020).'], ['REFERENCES']],
    });
    const o = computeEvidence({ projectId: 't', now: NOW, graph, texts, params: { matcher: 'v1' } }).occurrences[0];
    expect(o.status).toBe('ressalva');
    expect(o.reason).toBe('numero_ausente');
    expect(o.notes.join(' ')).toMatch(/99\.9/);
    // v2 keeps the label of its calibrated score but still tells the reader which number is missing
    const v2 = computeEvidence({ projectId: 't', now: NOW, graph, texts }).occurrences[0];
    expect(v2.notes.join(' ')).toMatch(/99\.9/);
  });

  it('labels as nao_localizado when nothing in the PDF resembles the sentence', () => {
    const { graph, texts } = project({ mainLines: [['Football stadiums require concrete foundations and drainage systems (QUINTANA et al., 2020).'], ['REFERENCES']] });
    const o = computeEvidence({ projectId: 't', now: NOW, graph, texts, params: { matcher: 'v1' } }).occurrences[0];
    expect(o.status).toBe('nao_localizado');
    expect(o.reason).toBe('sem_passagem');
  });

  it('labels a partially overlapping passage as ressalva', () => {
    const { graph, texts } = project({
      mainLines: [['Tissue boundary with cooking recipes, mountain climbing guides, football stadiums, concrete foundations, drainage systems, wedding catering budgets and airline timetables (QUINTANA et al., 2020).'], ['REFERENCES']],
    });
    const o = computeEvidence({ projectId: 't', now: NOW, graph, texts, params: { matcher: 'v1' } }).occurrences[0];
    expect(o.status).not.toBe('localizado');
    // v2 scores a claim that mostly talks about something else well below a full match
    const v2 = computeEvidence({ projectId: 't', now: NOW, graph, texts }).occurrences[0];
    expect(v2.score ?? 0).toBeLessThan(0.45);
  });
});

describe('reference index and ranking', () => {
  it('excludes the bibliography and flags the abstract region', () => {
    const t = pdfText([
      ['Title of paper', 'Abstract', 'This summary talks about wound healing outcomes in detail.', '1 Introduction', 'The body talks about wound healing outcomes in more detail here.'],
      ['References', 'Smith J. Wound healing outcomes in detail. 2010. A very long reference entry text.'],
    ]);
    const idx = buildReferenceIndex(t);
    expect(idx.sentences.some((s) => /Smith J\./.test(s.text))).toBe(false);
    expect(idx.sentences.find((s) => /summary/.test(s.text))?.region).toBe('resumo');
    expect(idx.sentences.find((s) => /body talks/.test(s.text))?.region).toBe('corpo');
    const top = rankPassages(idx, new Set(tokenize('wound healing outcomes in more detail')))[0];
    expect(idx.sentences[top.index].region).toBe('corpo');
  });

  it('merges hyphenated line breaks and splits paragraphs at headings', () => {
    const t = pdfText([['The segmenta-', 'tion of wounds is hard.', '2 METHODS', 'We train a model.']]);
    const flow = buildFlow(t);
    expect(flow.text).toContain('segmentation of wounds');
    expect(sentences(flow.text.replace(/\u2029/g, '\u2029'))).toEqual(['The segmentation of wounds is hard.', '2 METHODS', 'We train a model.']);
  });
});

describe('redactEvidenceForSharing', () => {
  it('removes sentence/passage text of private files and keeps pages and statuses', () => {
    const { graph, texts } = project();
    const report = computeEvidence({ projectId: 't', now: NOW, graph, texts });
    const red = redactEvidenceForSharing(report, graph.files);
    const o = red.occurrences.find((x) => x.publicationId === 'pub:bib:quintana2020')!;
    expect(o.sentence).toBe(REDACTED_TEXT);
    expect(o.claim).toBe(REDACTED_TEXT);
    expect(o.passages[0].text).toBe(REDACTED_TEXT);
    expect(o.passages[0].page).toBe(2);
    expect(o.status).toBe('localizado');
    expect(JSON.stringify(red)).not.toMatch(/gradient lattices improve/i);
  });

  it('keeps passages of shareable reference files when the main document is private', () => {
    const { graph, texts, quintana } = project({ quintanaVisibility: 'shareable' });
    const report = computeEvidence({ projectId: 't', now: NOW, graph, texts });
    const red = redactEvidenceForSharing(report, graph.files);
    const o = red.occurrences.find((x) => x.publicationId === 'pub:bib:quintana2020')!;
    expect(o.sentence).toBe(REDACTED_TEXT);
    expect(o.passages[0].fileId).toBe(quintana.id);
    expect(o.passages[0].text).toMatch(/12\.5 percent/);
  });
});

describe('ressalva only for concrete, explainable problems (v2)', () => {
  const occOf = (line: string) => {
    const { graph, texts } = project({ mainLines: [[line], ['REFERENCES']] });
    return computeEvidence({ projectId: 't', now: NOW, graph, texts }).occurrences[0];
  };

  it('a matching passage is localizado and says where and how similar it is', () => {
    const o = occOf('Gradient lattices improve tissue boundary estimation on dermatology images (QUINTANA et al., 2020).');
    expect(o.status).toBe('localizado');
    expect(o.why).toMatch(/similaridade na p\. 2/);
  });

  it('a number of the claim that exists nowhere in the source is a ressalva with the number in the reason', () => {
    const o = occOf('Gradient lattices improve tissue boundary estimation by 99.9 percent on dermatology images (QUINTANA et al., 2020).');
    expect(o.status).toBe('ressalva');
    expect(o.reason).toBe('numero_ausente');
    expect(o.why).toMatch(/99\.9/);
  });

  it('accepts 0,125 in the text for 12.5% in the source, and ignores years', () => {
    const o = occOf('Em 2019, gradient lattices improve tissue boundary estimation em 0,125 nas dermatology images (QUINTANA et al., 2020).');
    expect(o.status).toBe('localizado');
  });

  it('checks the cited page: a page outside the PDF numbering is a ressalva', () => {
    const { graph, texts } = project({ mainLines: [['Gradient lattices improve tissue boundary estimation on dermatology images (QUINTANA et al., 2020, p. 40).'], ['REFERENCES']] });
    const ref = Object.keys(texts).find((id) => graph.files[id]?.originalName === 'quintana.pdf')!;
    texts[ref].pages.forEach((p, i) => p.lines.push({ text: String(i + 1), rect: { x: 290, y: 800, w: 10, h: 10 }, fontSize: 9 }));
    const o = computeEvidence({ projectId: 't', now: NOW, graph, texts }).occurrences[0];
    expect(o.status).toBe('ressalva');
    expect(o.reason).toBe('pagina_citada');
    expect(o.why).toMatch(/p\. 40/);
  });

  it('checks the cited page: the passage on the cited page comes first', () => {
    const { graph, texts } = project({ mainLines: [['Gradient lattices improve tissue boundary estimation on dermatology images (QUINTANA et al., 2020, p. 2).'], ['REFERENCES']] });
    const ref = Object.keys(texts).find((id) => graph.files[id]?.originalName === 'quintana.pdf')!;
    texts[ref].pages.forEach((p, i) => p.lines.push({ text: String(i + 1), rect: { x: 290, y: 800, w: 10, h: 10 }, fontSize: 9 }));
    const o = computeEvidence({ projectId: 't', now: NOW, graph, texts }).occurrences[0];
    expect(o.status).toBe('localizado');
    expect(o.passages[0].page).toBe(2);
  });

  it('a direct quotation must be literally in the source', () => {
    const ok = occOf('Segundo os autores, “gradient lattices improve tissue boundary estimation by 12.5 percent” (QUINTANA et al., 2020).');
    expect(ok.status).toBe('localizado');
    expect(ok.why).toMatch(/literalmente/);
    const bad = occOf('Segundo os autores, “gradient lattices always beat every human expert in boundary estimation” (QUINTANA et al., 2020).');
    expect(bad.status).toBe('ressalva');
    expect(bad.reason).toBe('citacao_direta');
  });
});
