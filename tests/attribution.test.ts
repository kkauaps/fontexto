import { describe, expect, it } from 'vitest';
import { claimSpanFor, isLeadingNarrative, numbersAttributedTo, uniqueMarks } from '../src/core/attribution';
import { extractMarkersFromText } from '../src/core/citations';
import { computeEvidence } from '../src/core/evidence';
import { bibFixture, build, fileRecord, pdfText } from './helpers/fixtures';

const SENTENCE =
  'Num estudo anterior, Ribal et al. (2025) reuniram um acervo não publicado de 393 fotografias clínicas, organizado em cinco classes de tecido, com acurácia de 0,76, sem produzir máscaras de segmentação, embora uma mesma ferida possa apresentar vários tecidos (Kang et al., 2026; Zhou et al., 2025).';

describe('claim-to-citation attribution (style-agnostic)', () => {
  const marks = extractMarkersFromText(SENTENCE);
  const sent = { start: 0, end: SENTENCE.length };
  const byAuthor = (name: string) => marks.find((m) => m.authors[0] === name)!;

  it('extracts the narrative Ribal and the parenthetical Kang+Zhou', () => {
    expect(marks.map((m) => [m.authors[0], m.year, Boolean(m.narrative)])).toEqual([
      ['Ribal', 2025, true],
      ['Kang', 2026, false],
      ['Zhou', 2025, false],
    ]);
    expect(byAuthor('Kang').start).toBe(byAuthor('Zhou').start);
    expect(isLeadingNarrative(SENTENCE, sent, byAuthor('Ribal'))).toBe(true);
    expect(isLeadingNarrative(SENTENCE, sent, byAuthor('Kang'))).toBe(false);
  });

  it('gives 393 and 0,76 to Ribal, not to Kang or Zhou', () => {
    expect(numbersAttributedTo(SENTENCE, sent, marks, byAuthor('Ribal'))).toEqual(['393', '0.76']);
    expect(numbersAttributedTo(SENTENCE, sent, marks, byAuthor('Kang'))).toEqual([]);
    expect(numbersAttributedTo(SENTENCE, sent, marks, byAuthor('Zhou'))).toEqual([]);
    expect(claimSpanFor(SENTENCE, sent, marks, byAuthor('Ribal')).text).toMatch(/393/);
    expect(claimSpanFor(SENTENCE, sent, marks, byAuthor('Ribal')).text).toMatch(/0,76/);
    expect(claimSpanFor(SENTENCE, sent, marks, byAuthor('Kang')).text).toMatch(/embora uma mesma ferida/);
    expect(claimSpanFor(SENTENCE, sent, marks, byAuthor('Kang')).text).not.toMatch(/393|0,76/);
  });

  it('attributes a parenthetical APA/ABNT clause and a numeric [n] the same way', () => {
    const apa = 'Gradient lattices improve tissue boundary estimation by 12.5 percent (Quintana et al., 2020), although later work questions the protocol (Lee, 2021).';
    const apaMarks = extractMarkersFromText(apa);
    const q = apaMarks.find((m) => m.authors[0] === 'Quintana')!;
    const lee = apaMarks.find((m) => m.authors[0] === 'Lee')!;
    const span = { start: 0, end: apa.length };
    expect(numbersAttributedTo(apa, span, apaMarks, q)).toEqual(['12.5']);
    expect(numbersAttributedTo(apa, span, apaMarks, lee)).toEqual([]);

    const num = 'The set of images was composed of 393 photos [12], although a wound may show several tissues [15].';
    // numeric markers are not produced by extractMarkersFromText; they are spans like parentheticals
    const nMarks = [
      { start: num.indexOf('[12]'), end: num.indexOf('[12]') + 4 },
      { start: num.indexOf('[15]'), end: num.indexOf('[15]') + 4 },
    ];
    expect(numbersAttributedTo(num, { start: 0, end: num.length }, nMarks, nMarks[0])).toEqual(['393']);
    expect(numbersAttributedTo(num, { start: 0, end: num.length }, nMarks, nMarks[1])).toEqual([]);
    expect(uniqueMarks(nMarks)).toHaveLength(2);
  });

  it('does not raise a number ressalva when attribution is ambiguous', () => {
    const t = 'Both studies mention 128 cases (Alpha, 2020; Beta, 2021).';
    const ms = extractMarkersFromText(t);
    // one parenthetical span shared by Alpha and Beta: the number belongs to that shared span (both get it).
    // A truly ambiguous case: a number sitting between two distinct spans with no owner rule.
    const mid = 'See also 128 further remarks after the first citation and before the second.';
    const a = { start: 0, end: 0, narrative: true as const };
    const b = { start: mid.length, end: mid.length };
    // no citation actually covers "128" in a unique span of either empty marker
    expect(numbersAttributedTo(mid, { start: 0, end: mid.length }, [a, b], a)).toEqual([]);
  });
});

describe('computeEvidence: Ribal / Kang / Zhou sentence', () => {
  const bib = bibFixture(String.raw`
@article{ribal2025, author = {Ribal, Ana and Outro, Joao}, title = {Acervo clinico}, year = {2025}}
@article{kang2026, author = {Kang, Min and Oh, Beom}, title = {Wound tissues}, year = {2026}}
@article{zhou2025, author = {Zhou, Li and Qian, Wei}, title = {Multiple tissues in wounds}, year = {2025}}
`);
  const kangText = pdfText([
    [
      'Multiple tissues in one wound',
      'Abstract',
      'A wound may present several tissue types at the same time.',
      '1 Introduction',
      'The application is left to present the result to its user in text form.',
      '2.1 IMAGE SET',
      'The set of images was composed of 12 photos collected in two clinics.',
      'Although a single wound can present several tissues, most datasets label only one class.',
    ],
  ]);
  const zhouText = pdfText([
    [
      'Tissue coexistence',
      '1 Introduction',
      'The same wound can exhibit granulation, slough and necrosis together.',
    ],
  ]);

  function report(opts: { withRibalPdf?: boolean; kangHas393?: boolean } = {}) {
    const main = fileRecord('main', 'tcc.pdf');
    const kang = fileRecord('reference', 'kang.pdf');
    const zhou = fileRecord('reference', 'zhou.pdf');
    const ribal = fileRecord('reference', 'ribal.pdf');
    const mainText = pdfText([[SENTENCE], ['REFERENCES', 'RIBAL, A. et al. Acervo clinico. 2025.', 'KANG, M. et al. Wound tissues. 2026.', 'ZHOU, L. et al. Multiple tissues in wounds. 2025.']]);
    const files: Record<string, typeof main> = { [bib.file.id]: bib.file, [main.id]: main, [kang.id]: kang, [zhou.id]: zhou };
    const texts: Record<string, ReturnType<typeof pdfText>> = { [main.id]: mainText, [kang.id]: opts.kangHas393 ? kangText : kangText, [zhou.id]: zhouText };
    if (opts.withRibalPdf) {
      files[ribal.id] = ribal;
      texts[ribal.id] = pdfText([['We gathered an unpublished set of 393 clinical photographs in five tissue classes, with accuracy of 0.76, without producing segmentation masks.']]);
    }
    const graph = build({ files, bib: [{ fileId: bib.file.id, entries: bib.entries }], texts });
    return computeEvidence({ projectId: 't', now: '2026-01-01T00:00:00.000Z', graph, texts });
  }

  const of = (r: ReturnType<typeof report>, who: string) => r.occurrences.filter((o) => (o.publicationId ?? '').includes(who));

  it('does not flag 393 or 0,76 on Kang or Zhou when those numbers belong to Ribal', () => {
    const r = report();
    const kang = of(r, 'kang2026');
    const zhou = of(r, 'zhou2025');
    const ribal = of(r, 'ribal2025');
    expect(kang.length).toBeGreaterThan(0);
    expect(zhou.length).toBeGreaterThan(0);
    for (const o of [...kang, ...zhou]) {
      expect(o.attributedNumbers ?? []).not.toContain('393');
      expect(o.attributedNumbers ?? []).not.toContain('0.76');
      expect(o.reason).not.toBe('numero_ausente');
      expect(o.why ?? '').not.toMatch(/393|0[.,]76/);
    }
    expect(ribal[0].attributedNumbers).toEqual(['393', '0.76']);
    expect(ribal[0].reason).toBe('sem_pdf');
    expect(ribal[0].status).toBe('nao_localizado');
  });

  it('keeps Ribal unpublished (no PDF) as sem_pdf, not as a number ressalva', () => {
    const r = report();
    const ribal = of(r, 'ribal2025')[0];
    expect(ribal.status).toBe('nao_localizado');
    expect(ribal.reason).toBe('sem_pdf');
    expect(ribal.why ?? ribal.notes.join(' ')).toMatch(/PDF/i);
  });
});
