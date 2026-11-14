import { describe, expect, it } from 'vitest';
import { findPhrase, squash } from '../src/core/textsearch';

describe('squash', () => {
  it('drops punctuation, accents, ligatures and soft hyphens', () => {
    expect(squash('Segmentação (U-Net), ﬁne\u00adtuning!')).toBe('segmentacaounetfinetuning');
  });
});

describe('findPhrase', () => {
  const segs = ['The wound ', 'segmenta-', 'tion model ', '(Velloran et al., ', '2025) works. ', 'Again (Velloran et al., 2025).'];

  it('locates a phrase split across text nodes and hyphenated line breaks', () => {
    const m = findPhrase(segs, 'wound segmentation model')!;
    expect(m.exact).toBe(true);
    expect(m.start).toEqual({ seg: 0, offset: 4 });
    expect(m.end).toEqual({ seg: 2, offset: 'tion model'.length });
  });

  it('selects the n-th occurrence of a repeated marker', () => {
    const first = findPhrase(segs, '(Velloran et al., 2025)', { nth: 0 })!;
    const second = findPhrase(segs, '(Velloran et al., 2025)', { nth: 1 })!;
    expect(first.start.seg).toBe(3);
    expect(first.end).toEqual({ seg: 4, offset: '2025)'.length - 1 });
    expect(second.start.seg).toBe(5);
    expect(second.start.offset).toBe('Again ('.length);
  });

  it('falls back to a leading part of the phrase and flags it as not exact', () => {
    const m = findPhrase(['Alpha beta gamma delta epsilon zeta eta theta.'], 'alpha beta gamma delta epsilon zeta INVENTED TAIL words here')!;
    expect(m.exact).toBe(false);
    expect(m.words).toBeGreaterThanOrEqual(4);
    expect(m.start).toEqual({ seg: 0, offset: 0 });
  });

  it('returns undefined when nothing matches', () => {
    expect(findPhrase(segs, 'completely absent sentence about nothing')).toBeUndefined();
    expect(findPhrase(segs, '   ')).toBeUndefined();
  });
  it('does not start a match mid-word ("the wound" inside "breathe wound")', () => {
    expect(findPhrase(['Please breathe wound dressings carefully.'], 'the wound')).toBeUndefined();
    const ok = findPhrase(['Please treat the wound carefully.'], 'the wound')!;
    expect(ok.start).toEqual({ seg: 0, offset: 'Please treat '.length });
    expect(ok.end.offset).toBe('Please treat the wound'.length);
  });

  it('maps ligatures and soft hyphens to the source character, not a mid-glyph offset', () => {
    const segs = ['The \uFB01ne\u00ADtuning step works.'];
    const m = findPhrase(segs, 'fine-tuning step')!;
    expect(m.exact).toBe(true);
    expect(m.start).toEqual({ seg: 0, offset: 4 });
    expect(segs[0].slice(m.start.offset, m.end.offset).normalize('NFKD').replace(/[\u0300-\u036f\u00ad]/g, '')).toMatch(/tuning step/i);
  });

  it('normalises extra whitespace and punctuation between words', () => {
    const m = findPhrase(['The   wound,   neatly  closed.'], 'the wound neatly closed')!;
    expect(m.exact).toBe(true);
    expect(m.start.offset).toBe(0);
    expect(m.end.offset).toBe('The   wound,   neatly  closed'.length);
  });
});
