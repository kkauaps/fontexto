/**
 * Reference lists in other languages and styles, and the extraction bugs found in the QA pass of 2026-11-14.
 * All works, authors and DOIs are invented (prefix 10.99999), except the shape of a SICI DOI.
 */
import { describe, expect, it } from 'vitest';
import { extractReferenceEntries, repeatedLines } from '../src/core/references';
import { parseReferenceText, parseReferences, toBibtex } from '../src/core/refparse';
import { findDois } from '../src/core/normalize';
import { joinLines, type PdfText } from '../src/core/text';
import { oaCacheKey, titleSimilarity } from '../src/core/openAccess';
import { makePacer, withRetry } from '../src/core/oaClient';
import { pdfText } from './helpers/fixtures';

const listFor = (heading: string, entries: string[]) => pdfText([['Corpo do texto genérico.', heading, ...entries]]);

describe('reference-list headings in other languages', () => {
  const entries = ['[1] Ivanova A. B. Invented title one // Journal of Nothing. – 2019. – Т. 3. – С. 1–9.', '[2] Petrov C. Invented title two // Journal of Nothing. – 2020. – № 2. – С. 10–20.'];
  for (const h of ['Bibliografía', 'Referencias bibliográficas', 'Références', 'Bibliographie', 'Literaturverzeichnis', 'Literatur', 'Список литературы', 'Список использованных источников', 'Литература', '参考文献', '参考⽂献', 'Riferimenti bibliografici']) {
    it(`finds "${h}"`, () => {
      expect(extractReferenceEntries(listFor(h, entries))).toHaveLength(2);
    });
  }
  it('stops at a Russian appendix and a German annex', () => {
    const t = listFor('Литература', [...entries, 'Приложение А', '[3] Something that is not a reference at all, 2021.']);
    expect(extractReferenceEntries(t)).toHaveLength(2);
    const d = listFor('Literaturverzeichnis', [...entries, 'Anhang', '[3] Not a reference, 2021.']);
    expect(extractReferenceEntries(d)).toHaveLength(2);
  });
});

describe('running headers vs repeated reference lines', () => {
  // 3 pages; the same continuation line ("Journal of Nothing, v. #, ...") sits in the middle of each page
  // the reference body changes length from page to page, so the repeated continuation lines move up and down
  const page = (n: number): string[] => [
    'Revista Genérica · v. 1',
    ...Array.from({ length: 20 + n * 4 }, (_, i) => `SOBRENOME${n}${i}, A. Título inventado número ${i}. Journal of Nothing, v. 3, n. 2, p. 10-`),
    '20, 2020.',
    ...Array.from({ length: 24 - n * 4 }, () => 'Journal of Nothing, v. 3, n. 2, p. 10-20, 2020.'),
    '20, 2020.',
    String(n),
  ];
  const t: PdfText = pdfText([page(1), page(2), page(3)]);
  it('drops a header in the top margin but keeps body lines that repeat', () => {
    const rep = repeatedLines(t);
    expect(rep.has('revista genérica · v. #')).toBe(true);
    expect([...rep].some((k) => k.startsWith('journal of nothing'))).toBe(false);
    expect(rep.has('#, #.')).toBe(false);
  });
});

describe('DOIs', () => {
  it('keeps the <...> segments of SICI DOIs', () => {
    expect(findDois('J Biomed Mater Res. 1997;35(1):129-35. doi:10.1002/(SICI)1097-4636(199704)35:1<129::AID-JBM13>3.0.CO;2-E')).toEqual([
      '10.1002/(sici)1097-4636(199704)35:1<129::aid-jbm13>3.0.co;2-e',
    ]);
  });
  it('does not glue the next word to a DOI that ends a line with "."', () => {
    expect(joinLines(['Title. Journal, 2003, doi:10.99999/tip.2003.819861.', 'Revista Genérica'])).toBe('Title. Journal, 2003, doi:10.99999/tip.2003.819861. Revista Genérica');
    expect(joinLines(['doi:10.99999/abc.', 'def.1'])).toBe('doi:10.99999/abc.def.1');
    expect(joinLines(['https://doi.org/10.99999/s1414-', '40772018000100002'])).toBe('https://doi.org/10.99999/s1414-40772018000100002');
  });
});

describe('author, title and year parsing', () => {
  it('ABNT with two initials per author and abbreviated particles', () => {
    const r = parseReferenceText('BOLGER, A. M.; LOHSE, M.; USADEL, B. Trimador inventado para leituras. Revista Inventada, v. 30, n. 15, p. 2114-2120, 2014.');
    expect(r.authors.map((a) => a.family)).toEqual(['Bolger', 'Lohse', 'Usadel']);
    expect(r.title).toBe('Trimador inventado para leituras');
    expect(r.year).toBe(2014);
    const p = parseReferenceText('PAULA, M. d. F. d. Cartografia inventada da educação. Revista Inventada, v. 13, n. 1, p. 63-88, 2008.');
    expect(p.title).toBe('Cartografia inventada da educação');
  });
  it('ABNT: a capitalised first title word is not a particle', () => {
    const r = parseReferenceText('MARTINEZ, M. La educación inventada en Iberoamérica. Análisis histórico. Revista, v. 1, 2014.');
    expect(r.title).toMatch(/^La educación inventada/);
  });
  it('ABNT book: the title stops before [S. l.]', () => {
    expect(parseReferenceText('BOYD, S.; VANDENBERGHE, L. Otimização inventada. [S. l.]: [s. n.], 2004.').title).toBe('Otimização inventada');
  });
  it('IEEE corporate author in capitals is not ABNT', () => {
    const r = parseReferenceText('WHO, “Invented Global Report 2023.” [Online]. Available: https://example.org/r (accessed Oct. 10, 2026).', 3, '[4]');
    expect(r.authors[0].family).toBe('WHO');
    expect(r.title).toBe('Invented Global Report 2023');
    expect(r.year).not.toBe(2026);
  });
  it('the year is not a page number', () => {
    const r = parseReferenceText('Z. Wang and A. Bovik, “Invented quality index,” IEEE Trans. Imag., vol. 13, no. 4, pp. 1600–1612, 2004.', 0, '[1]');
    expect(r.year).toBe(2004);
  });
  it('Harvard with the year after the authors and no comma', () => {
    const r = parseReferenceText('Bolger, A. M., Lohse, M. and Usadel, B. 2014. Invented trimmer for reads. Journal of Nothing, 30(15), pp. 2114–2120.');
    expect(r.year).toBe(2014);
    expect(r.title).toBe('Invented trimmer for reads');
  });
  it('APA title ending in "." keeps the venue out', () => {
    expect(parseReferenceText('Podsakoff, P. M., & Lee, J. Y. (2003). Invented biases: A review of remedies.. Journal of Nothing, 88(5), 879–903.').title).toBe('Invented biases: A review of remedies');
  });
  it('a title that starts with a quotation is kept whole', () => {
    expect(parseReferenceText('Silva, A. (2020). "Big data" in invented health systems. Journal of Nothing, 1(2), 3–4.').title).toBe('"Big data" in invented health systems');
  });
  it('GOST (Russian)', () => {
    const r = parseReferenceText('Иванова А.Б., Петров В. [и др.] Вымышленное исследование потоков // Журнал Ничего. – 2018. – Т. 5, № 3. – С. 10–20. – DOI: 10.99999/abc.1.', 0, '1.');
    expect(r.authors.map((a) => a.family)).toEqual(['Иванова', 'Петров']);
    expect(r.etAl).toBe(true);
    expect(r.title).toBe('Вымышленное исследование потоков');
    expect(r.year).toBe(2018);
    expect(r.doi).toBe('10.99999/abc.1');
  });
  it('French author-year in capitals', () => {
    const r = parseReferenceText('BARJOT D., DUPONT E. L. (2012), « Histoire inventée et historiographie », Revue Inventée, vol. 31, n° 2, p. 5-27.');
    expect(r.authors.map((a) => a.family)).toEqual(['Barjot', 'Dupont']);
    expect(r.year).toBe(2012);
    expect(r.title).toBe('Histoire inventée et historiographie');
  });
  it('GB/T 7714 type marks are not part of the title', () => {
    expect(parseReferenceText('王小明, 李华. 基于虚构数据的图像识别研究[J]. 虚构学报, 2020, 5(3): 10-20.', 0, '[1]').title).toBe('基于虚构数据的图像识别研究');
  });
});

describe('graph input', () => {
  it('keeps entries without a readable year', () => {
    const refs = parseReferences([{ index: 0, text: 'Souza, A. B. Invented report without date. Some Institute.' }, { index: 1, text: 'Lima, C. (2020). Invented title. Journal, 1, 2–3.' }]);
    const bib = toBibtex(refs);
    expect(bib).toMatch(/@misc\{souza,/);
    expect(bib).toMatch(/@misc\{lima2020,/);
  });
});

describe('open-access lookup with non-Latin titles', () => {
  it('compares Russian and Chinese titles', () => {
    expect(titleSimilarity('Вымышленное исследование потоков пассажиров', 'Вымышленное исследование потоков пассажиров')).toBe(1);
    expect(titleSimilarity('基于虚构数据的图像识别研究', '基于虚构数据的图像识别研究')).toBe(1);
    expect(titleSimilarity('基于虚构数据的图像识别研究', '城市经济发展的虚构分析')).toBeLessThan(0.3);
  });
  it('two different Russian titles never share a cache entry', () => {
    const a = oaCacheKey({ title: 'Вымышленное исследование потоков', year: 2018, author: 'Иванова' });
    const b = oaCacheKey({ title: 'Другая вымышленная статья', year: 2018, author: 'Петров' });
    expect(a).not.toBe(b);
  });
});

describe('free-PDF lookup retries', () => {
  it('retries a 429 and gives up on other errors', async () => {
    let n = 0;
    const ok = await withRetry(async () => { if (n++ < 2) throw new Error('429 Too Many Requests'); return 'pdf'; }, [1, 1], async () => undefined);
    expect(ok).toBe('pdf');
    let m = 0;
    await expect(withRetry(async () => { m++; throw new Error('404 Not Found'); }, [1, 1], async () => undefined)).rejects.toThrow('404');
    expect(m).toBe(1);
  });
});

describe('OA pacing under the /api/oa rate limit (20 req / 10 s per IP)', () => {
  it('spaces request starts from concurrent workers so no 10 s window exceeds 20', async () => {
    let clock = 0;
    const starts: number[] = [];
    const pace = makePacer(550, () => clock, async (ms) => { clock += ms; });
    // three workers asking at the same instant, 60 requests in total, each answered instantly
    for (let k = 0; k < 60; k++) { await pace(); starts.push(clock); }
    for (const t of starts) expect(starts.filter((s) => s >= t && s < t + 10_000).length).toBeLessThanOrEqual(20);
    expect(starts[1] - starts[0]).toBe(550);
  });
  it('does not delay a request when the gap already passed', async () => {
    let clock = 0;
    const pace = makePacer(550, () => clock, async (ms) => { clock += ms; });
    await pace(); clock += 2000; const before = clock; await pace();
    expect(clock).toBe(before);
  });
});
