/** Fictional Simplified Chinese documents: GB/T 7714, CJK citations, and page finding. */
import { describe, expect, it } from 'vitest';
import {
  extractMarkersFromText,
  parseParenthetical,
  resolveMarker,
} from '../src/core/citations';
import {
  citedPages,
  computeEvidence,
  directQuotes,
  numericMarkers,
  segmentSentences,
  tokenize,
} from '../src/core/evidence';
import { tokenizeV2 } from '../src/core/matching';
import { normalizeName, sameFamilyName, titleSimilarity, titleTokens } from '../src/core/normalize';
import { parseReferenceText, parseReferences } from '../src/core/refparse';
import { fileRecord, build, pdfText } from './helpers/fixtures';

const sentences = (s: string) => segmentSentences(s).map((sp) => s.slice(sp.start, sp.end));
const NOW = '2026-01-01T00:00:00.000Z';

const JOURNAL =
  '张三, 李四, 王五, 等. 合成数据结构的比较研究[J]. 通用方法学报, 2020, 12(3): 10-18. DOI: 10.99999/fx.zh.0001.';
const THESIS = '赵六. 虚构城市的水文模型[D]. 北海大学, 2019.';
const BOOK = '钱七, 孙八. 实验室手册：合成样本[M]. 南城出版社, 2018.';
const PINYIN =
  'ZHANG San, LI Si, et al. A comparative study of synthetic data structures[J]. Journal of Generic Methods, 2020, 12(3): 10-18.';
const ENGLISH = 'Smith, J. (2018). An English review of laboratory methods. Generic Journal, 4(1), 1-9. https://doi.org/10.99999/fx.en.0002';
const IDEOGRAPHIC = '张三，李四。合成数据结构的比较研究[J]. 通用方法学报, 2020, 12(3): 10-18.';
const CONCAT = '张三李四. 一项联合实验[J]. 通用方法学报, 2021.';
const RADICAL = '潘鹏⻜. 通信系统中的图像方法[J]. 通用方法学报, 2022.';
const COMPOUND = '欧阳修. 虚构史论选辑[M]. 南城出版社, 2017.';

describe('GB/T 7714 fictional entries', () => {
  it('parses journal, thesis and monograph type marks, and 等', () => {
    const j = parseReferenceText(JOURNAL, 0, '[1]');
    expect(j.style).toBe('gbt');
    expect(j.authors.map((a) => a.family)).toEqual(['张三', '李四', '王五']);
    expect(j.etAl).toBe(true);
    expect(j.year).toBe(2020);
    expect(j.title).toBe('合成数据结构的比较研究');
    expect(j.doi).toBe('10.99999/fx.zh.0001');

    const d = parseReferenceText(THESIS, 1, '[2]');
    expect(d.style).toBe('gbt');
    expect(d.authors[0]?.family).toBe('赵六');
    expect(d.year).toBe(2019);
    expect(d.title).toBe('虚构城市的水文模型');

    const m = parseReferenceText(BOOK, 2, '[3]');
    expect(m.style).toBe('gbt');
    expect(m.authors.map((a) => a.family)).toEqual(['钱七', '孙八']);
    expect(m.year).toBe(2018);
    expect(m.title).toBe('实验室手册：合成样本');
  });

  it('parses a mixed Chinese and English reference list', () => {
    const refs = parseReferences([
      { index: 0, text: JOURNAL, label: '[1]' },
      { index: 1, text: PINYIN, label: '[2]' },
      { index: 2, text: ENGLISH, label: '[3]' },
    ]);
    expect(refs[0].style).toBe('gbt');
    expect(refs[1].style).toBe('gbt');
    expect(refs[2].style).toBe('apa');
    expect(refs[2].authors[0]?.family).toBe('Smith');
    expect(refs[2].year).toBe(2018);
  });

  it('accepts an ideographic stop between authors and title', () => {
    const r = parseReferenceText(IDEOGRAPHIC, 0);
    expect(r.style).toBe('gbt');
    expect(r.authors.map((a) => a.family)).toEqual(['张三', '李四']);
    expect(r.title).toBe('合成数据结构的比较研究');
    expect(r.year).toBe(2020);
  });

  it('splits two 2-character names that lost their separator, but keeps a compound surname whole', () => {
    const r = parseReferenceText(CONCAT, 0);
    expect(r.authors.map((a) => a.family)).toEqual(['张三', '李四']);
    const c = parseReferenceText(COMPOUND, 0);
    expect(c.authors.map((a) => a.family)).toEqual(['欧阳修']);
  });
});

describe('CJK name and title normalisation', () => {
  it('folds Kangxi / radical forms so 潘鹏⻜ matches 潘鹏飞', () => {
    expect(normalizeName('潘鹏⻜')).toBe(normalizeName('潘鹏飞'));
    expect(sameFamilyName('潘鹏⻜', '潘鹏飞')).toBe(true);
    const r = parseReferenceText(RADICAL, 0);
    expect(sameFamilyName(r.authors[0]?.family, '潘鹏飞')).toBe(true);
  });

  it('treats a short Chinese family name as a prefix of the full name', () => {
    expect(sameFamilyName('张', '张三')).toBe(true);
    expect(sameFamilyName('欧阳', '欧阳修')).toBe(true);
    expect(sameFamilyName('三', '张三')).toBe(false);
  });

  it('compares unspaced Chinese titles with character bigrams', () => {
    expect(titleTokens('合成数据结构的比较研究').length).toBeGreaterThan(1);
    expect(titleSimilarity('合成数据结构的比较研究', '合成数据结构的比较研究')).toBe(1);
    expect(titleSimilarity('合成数据结构的比较研究', '合成数据结构和比较研究')).toBeGreaterThan(0.7);
    expect(titleSimilarity('基于虚构数据的图像识别研究', '城市经济发展的虚构分析')).toBeLessThan(0.3);
  });
});

describe('CJK in-text citations', () => {
  const body = '已有研究表明这一方法是有效的（张三，2020）。另见（张三等，2020）和张三（2020）。亦有编号引用[1]。';

  it('reads fullwidth parenthetical, 等, and narrative 张三（2020）', () => {
    const marks = extractMarkersFromText(body);
    const keys = marks.map((m) => ({ authors: m.authors, year: m.year, etAl: m.etAl, narrative: !!m.narrative }));
    expect(keys).toEqual([
      { authors: ['张三'], year: 2020, etAl: false, narrative: false },
      { authors: ['张三'], year: 2020, etAl: true, narrative: false },
      { authors: ['张三'], year: 2020, etAl: false, narrative: true },
    ]);
    expect(parseParenthetical('张三，2020')).toEqual([{ authors: ['张三'], etAl: false, year: 2020, yearLabel: '2020' }]);
  });

  it('also reads ASCII-paren mixed (张三, 2020) next to a Latin marker', () => {
    const marks = extractMarkersFromText('(Zhang, 2020) and (张三, 2020).');
    expect(marks.map((m) => m.authors[0]).sort()).toEqual(['Zhang', '张三']);
  });

  it('resolves （张三，2020） to the GB/T bibliography entry', () => {
    const pubs = parseReferences([{ index: 0, text: JOURNAL, label: '[1]' }]).map((r, i) => ({
      id: `pub:${i}`,
      authors: r.authors,
      year: r.year,
    }));
    const mark = extractMarkersFromText('讨论见（张三，2020）。')[0];
    expect(resolveMarker(mark, pubs as never)).toEqual({ status: 'resolved', publicationId: 'pub:0' });
  });

  it('reads numeric [1] and [1，2] when the bibliography is numbered', () => {
    const main = pdfText([
      ['现有文献描述了互补的方法[1]。后续工作见[1，2]。'],
      [
        '参考文献',
        '[1] 张三, 李四, 王五, 等. 合成数据结构的比较研究[J]. 通用方法学报, 2020, 12(3): 10-18.',
        '[2] 赵六. 虚构城市的水文模型[D]. 北海大学, 2019.',
      ],
    ]);
    const pubs = parseReferences([
      { index: 0, text: JOURNAL, label: '[1]' },
      { index: 1, text: THESIS, label: '[2]' },
    ]).map((r, i) => ({ id: `pub:${i}`, authors: r.authors, year: r.year, title: r.title }));
    const found = numericMarkers(main.pages[0].lines[0].text + ' ', main, pubs as never);
    expect(found.map((m) => m.raw).sort()).toEqual(['[1]', '[1，2]', '[1，2]']);
  });
});

describe('Chinese sentence, quote and page cues', () => {
  const passage =
    '本研究概述了在多个领域中应用的数据分析方法。现有文献描述了互补的定量与定性方法。多位作者讨论了测量工具的效度与结果的可重复性。';

  it('splits on ideographic stops without needing a following space', () => {
    expect(sentences(passage)).toEqual([
      '本研究概述了在多个领域中应用的数据分析方法。',
      '现有文献描述了互补的定量与定性方法。',
      '多位作者讨论了测量工具的效度与结果的可重复性。',
    ]);
  });

  it('tokenizes Han text as character bigrams for v1 and v2 matchers', () => {
    expect(tokenize(passage).length).toBeGreaterThan(10);
    expect(tokenize(passage)).toContain('现有');
    expect(tokenizeV2(passage).some((t) => t.t === '现有')).toBe(true);
  });

  it('extracts Chinese corner quotes and typographic quotes without spaces between words', () => {
    const q = '现有文献描述了互补的定量与定性方法';
    expect(directQuotes(`研究者指出「${q}」。`)).toEqual([q]);
    expect(directQuotes(`研究者指出“${q}”。`)).toEqual([q]);
  });

  it('reads 第12页 as a cited page', () => {
    expect(citedPages('（张三，2020，第12页）')).toEqual([12]);
    expect(citedPages('（张三，2020，第12-14页）')).toEqual([12, 13, 14]);
  });
});

describe('exact-page finding in a fictional Chinese PDF', () => {
  it('locates a quoted Chinese sentence on page 2', () => {
    const main = fileRecord('main', 'paper-zh.pdf');
    const src = fileRecord('reference', 'zhang2020.pdf', { visibility: 'shareable' });
    const quote = '现有文献描述了互补的定量与定性方法';
    const mainText = pdfText([
      [
        '引言',
        `研究者指出「${quote}」（张三，2020）。`,
      ],
      [
        '参考文献',
        '[1] 张三, 李四, 王五, 等. 合成数据结构的比较研究[J]. 通用方法学报, 2020, 12(3): 10-18. DOI: 10.99999/fx.zh.0001.',
        '[2] 赵六. 虚构城市的水文模型[D]. 北海大学, 2019.',
      ],
    ]);
    const srcText = pdfText([
      ['合成数据结构的比较研究', '张三, 李四, 王五', '摘要 本文仅概述研究背景与无关的前言内容。'],
      [
        '本研究在多个领域中验证了合成数据结构。现有文献描述了互补的定量与定性方法。多位作者讨论了测量工具的效度。',
      ],
    ]);
    const texts = { [main.id]: mainText, [src.id]: srcText };
    const graph = build({ files: { [main.id]: main, [src.id]: src }, texts });
    const report = computeEvidence({ projectId: 'zh-fic', now: NOW, graph, texts });
    const hits = report.occurrences.filter((o) => o.marker.includes('张三'));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((o) => o.resolution === 'resolved')).toBe(true);
    const quoted = hits.find((o) => o.sentence.includes(quote)) ?? hits[0];
    expect(quoted.status).toBe('localizado');
    expect(quoted.passages[0]?.page).toBe(2);
    expect(quoted.passages[0]?.text).toContain(quote);
  });
});
