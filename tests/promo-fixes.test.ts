/** Fictional data only: invented authors, titles and 10.99999 DOIs. */
import { describe, expect, it } from 'vitest';
import { extractReferenceEntries, findReferenceTail, referenceSectionBounds } from '../src/core/references';
import { gbtAuthors, isThesisText, parseReferenceText, parseReferences, toBibtex } from '../src/core/refparse';
import { oaCacheKey, openAlexTitleFilter, parseOaQuery } from '../src/core/openAccess';
import { en } from '../src/web/i18n/en';
import { es } from '../src/web/i18n/es';
import { ptBR } from '../src/web/i18n/pt-BR';
import { ru } from '../src/web/i18n/ru';
import { pdfText } from './helpers/fixtures';

const body = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p} body line ${i + 1} about imaginary lattices and synthetic data.`);

describe('reference list without a heading (tail fallback)', () => {
  it('finds a numbered list at the end of the text', () => {
    const pdf = pdfText([
      ['A Fictional Study of Lattices', ...body(30, 'Intro'), 'Results agree with earlier work [1], [2] and [3].'],
      [...body(20, 'Discussion'),
        '[1] A. Quintana, "Gradient lattices for tissue boundary estimation," J. Synth. Stud., vol. 3, 2020.',
        '[2] H. Albrecht and L. Moreau, "A benchmark of imaginary segmentation networks," in Proc. ICSSI, 2018.',
        '[3] R. Nakamura, "Self-calibrating annotation protocols," Synth. Vis. Lett., 2019.',
        '[4] C. Okafor, "Convolutional lattice networks," Synth. Neural Comput., 2015.'],
    ]);
    const start = findReferenceTail(pdf);
    expect(start).toMatchObject({ page: 2, implicit: true });
    const entries = extractReferenceEntries(pdf);
    expect(entries.map((e) => e.label)).toEqual(['[1]', '[2]', '[3]', '[4]']);
    expect(entries[0].text).toMatch(/^A\. Quintana/);
    expect(referenceSectionBounds(pdf, { fallback: true })?.start.line).toBe(20);
    expect(referenceSectionBounds(pdf)).toBeUndefined();
  });
  it('finds an author-year list at the end of the text', () => {
    const pdf = pdfText([
      [...body(40, 'Body'), 'As shown by Quintana et al. (2020) and Okafor (2015).'],
      [...body(10, 'Conclusion'),
        'Albrecht, H., & Moreau, L. (2018). A benchmark of imaginary segmentation networks. Synthetic Vision Letters, 4, 1-9.',
        'Nakamura, R. (2019). Self-calibrating annotation protocols. Proceedings of the Imaginary Conference, 1-8.',
        'Okafor, C. (2015). Convolutional lattice networks. Synthetic Neural Computing, 2, 10-20.',
        'Quintana, A., Brandt, M., & Oyelaran, T. (2020). Gradient lattices for tissue boundary estimation. Journal of Synthetic Studies, 3, 1-12.'],
    ]);
    const entries = extractReferenceEntries(pdf);
    expect(entries.map((e) => parseReferenceText(e.text).authors[0]?.family)).toEqual(['Albrecht', 'Nakamura', 'Okafor', 'Quintana']);
  });
  it('does not invent a list in plain prose', () => {
    expect(findReferenceTail(pdfText([body(40, 'Only'), body(30, 'Prose')]))).toBeUndefined();
  });
  it('a real heading still wins', () => {
    const pdf = pdfText([[...body(10, 'B'), 'References', 'Okafor, C. (2015). Convolutional lattice networks. Synthetic Neural Computing, 2, 10-20.']]);
    expect(referenceSectionBounds(pdf, { fallback: true })?.start.implicit).toBeUndefined();
  });
});

describe('GB/T 7714 first authors', () => {
  it('keeps Chinese names whole (as cited in the text) and reads every author', () => {
    const r = parseReferenceText('张三, 李四, 王五, 等. 气候数据的质量控制方法[J]. 气象学报, 2020, 78(3): 1-10.', 0, '[1]');
    expect(r.style).toBe('gbt');
    expect(r.authors.map((a) => a.family)).toEqual(['张三', '李四', '王五']);
    expect(r.etAl).toBe(true);
    expect(r.year).toBe(2020);
    expect(r.title).toBe('气候数据的质量控制方法');
  });
  it('reads pinyin/Latin names with the family name first', () => {
    const r = parseReferenceText('ZHOU Q H, LI S, et al. Invented lattices for synthetic rainfall[J]. Journal of Fiction, 2015, 2(4): 1-13. DOI: 10.99999/jf.2015.1.', 0, '[2]');
    expect(r.authors[0]).toEqual({ family: 'Zhou', given: 'Q H' });
    expect(r.authors[1].family).toBe('Li');
    expect(r.doi).toBe('10.99999/jf.2015.1');
    expect(parseReferenceText('ZHANG San. A study of invented lattices[J]. Journal of Fiction, 2021, 3(2): 5-9.').authors[0]).toEqual({ family: 'Zhang', given: 'San' });
  });
  it('leaves non-GB/T entries alone', () => {
    expect(gbtAuthors('Okafor, C. (2015). Convolutional lattice networks. Synthetic Neural Computing, 2, 10-20.')).toBeUndefined();
  });
});

describe('theses', () => {
  it('detects theses in several styles without flagging titles that only mention the word', () => {
    expect(isThesisText('QUINTANA, A. Redes de treliça. 2019. Tese (Doutorado em Computação) – Universidade Fictícia, 2019.')).toBe(true);
    expect(isThesisText('Lindqvist, H. (2020). Synthetic boundaries [Doctoral dissertation, University of Fiction].')).toBe(true);
    expect(isThesisText('Петров И. И. Методы синтетических решёток : дис. … канд. техн. наук. – М., 2018.')).toBe(true);
    expect(isThesisText('王五. 虚构数据集的构建[D]. 北京: 虚构大学, 2018.')).toBe(true);
    expect(isThesisText('Okafor, C. (2020). A guide to writing a dissertation. Journal of Fiction, 1, 1-2.')).toBe(false);
  });
  it('cleans the thesis description out of the title', () => {
    expect(parseReferenceText('Lindqvist, H. (2020). Synthetic boundaries in imaginary tissue [Doctoral dissertation, University of Fiction]. Fiction Repository.').title).toBe('Synthetic boundaries in imaginary tissue');
    const g = parseReferenceText('Петров И. И. Методы синтетических решёток : дис. … канд. техн. наук. – М., 2018. – 150 с.');
    expect(g).toMatchObject({ authors: [{ family: 'Петров', given: 'И.И.' }], title: 'Методы синтетических решёток', year: 2018, thesis: true });
  });
  it('writes theses as @phdthesis and searches dissertations with a wider year window', () => {
    const refs = parseReferences([{ index: 0, text: 'QUINTANA, A. Redes de treliça para estimativa de bordas. 2019. Tese (Doutorado) – Universidade Fictícia, 2019.' }]);
    expect(toBibtex(refs)).toMatch(/@phdthesis\{quintana2019,/);
    const q = parseOaQuery(new URLSearchParams({ title: 'Redes de treliça para estimativa de bordas', year: '2019', kind: 'thesis' }))!;
    expect(q.kind).toBe('thesis');
    expect(openAlexTitleFilter(q)).toBe('&filter=type:dissertation,publication_year:2017-2021');
    expect(openAlexTitleFilter({ title: 'x', year: 2019 })).toBe('&filter=publication_year:2018-2020');
    expect(oaCacheKey(q)).not.toBe(oaCacheKey({ ...q, kind: undefined }));
    expect(parseOaQuery(new URLSearchParams({ title: 'Redes de treliça para estimativa', kind: 'evil' }))?.kind).toBeUndefined();
  });
});

describe('UI copy for promotion', () => {
  const all = { en, es, ru, ptBR };
  it('uses the singular for one citation', () => {
    expect(en.tabCitations(1)).toBe('1 citation');
    expect(en.tabCitations(2)).toBe('2 citations');
    expect(es.tabCitations(1)).toBe('1 cita');
    expect(ptBR.tabCitations(1)).toBe('1 citação');
    expect(ru.tabCitations(1)).toBe('1 ссылка');
    expect(en.netStats(1, 1, 1)).toBe('1 reference · 1 link · 1 topic');
    expect(ptBR.citationsInTextSummary(1, 1, 0, 0)).toBe('1 citação no texto: 1 localizada, 0 com ressalva, 0 não localizadas');
  });
  it('translates the hero sample paper in every language', () => {
    const titles = new Set(Object.values(all).map((m) => m.heroSample.title));
    expect(titles.size).toBe(4);
    for (const m of Object.values(all)) for (const v of Object.values(m.heroSample)) expect(v.length).toBeGreaterThan(2);
  });
});
