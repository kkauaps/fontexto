/** Fictional Japanese citation and reference parsing (no real authors). */
import { describe, expect, it } from 'vitest';
import { parseReferenceText, parseReferences } from '../src/core/refparse';
import { parseParenthetical } from '../src/core/citations';
import { citedPages } from '../src/core/evidence';

const JOURNAL =
  '山田太郎, 佐藤花子. 合成データ構造の比較研究[J]. 汎用方法学会誌, 2020, 12(3): 10-18. DOI: 10.99999/fx.ja.0001.';

describe('Japanese fictional references', () => {
  it('parses a journal entry with kanji authors and title', () => {
    const r = parseReferenceText(JOURNAL, 0, '[1]');
    expect(r.year).toBe(2020);
    expect(r.title).toContain('合成データ構造');
    expect(r.doi).toBe('10.99999/fx.ja.0001');
    expect(r.authors.length).toBeGreaterThanOrEqual(2);
    expect(r.authors.map((a) => a.family).join('')).toMatch(/山田|佐藤/);
  });

  it('parses parenthetical markers with CJK surnames', () => {
    const refs = parseParenthetical('山田，2020');
    expect(refs).toHaveLength(1);
    expect(refs[0].year).toBe(2020);
    expect(refs[0].authors[0]).toMatch(/山田/);
  });

  it('reads 第12页-style cited pages in Japanese markers', () => {
    expect(citedPages('（山田，2020，第12页）')).toEqual([12]);
  });

  it('parses a short mixed list', () => {
    const list = parseReferences([
      { index: 0, text: JOURNAL, label: '[1]' },
      { index: 1, text: '鈴木一郎. 架空の水文モデル[D]. 北海大学, 2019.', label: '[2]' },
    ]);
    expect(list).toHaveLength(2);
    expect(list[1].year).toBe(2019);
    expect(list[1].title).toContain('水文');
  });
});