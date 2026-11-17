/** Opt-in calibration feedback: strict input, totals only, threshold summary. */
import { describe, expect, it } from 'vitest';
import { feedbackKey, parseFeedback, recordFeedback, summarizeFeedback } from '../src/core/feedback';
import { scoreBucket } from '../src/web/feedback';

function fakeKv() {
  const m = new Map<string, string>();
  return { m, get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v) };
}

describe('feedback input', () => {
  it('accepts exactly the four expected values', () => {
    expect(parseFeedback({ auto: 'localizado', verdict: 'ressalva', bucket: 0.35, semantic: false })).toEqual({ auto: 'localizado', verdict: 'ressalva', bucket: 0.35, semantic: false });
    expect(parseFeedback({ auto: 'nao_localizado', verdict: 'localizado', bucket: -1, semantic: true })?.bucket).toBe(-1);
  });
  it('rejects anything else: extra fields (no text can ride along), unknown labels, odd scores', () => {
    for (const bad of [
      { auto: 'localizado', verdict: 'ressalva', bucket: 0.35, semantic: false, title: 'secret' },
      { auto: 'ok', verdict: 'ressalva', bucket: 0.35, semantic: false },
      { auto: 'localizado', verdict: 'ressalva', bucket: 0.33, semantic: false },
      { auto: 'localizado', verdict: 'ressalva', bucket: 2, semantic: false },
      { auto: 'localizado', verdict: 'ressalva', bucket: 0.35, semantic: 'yes' },
      [],
      null,
      'x',
    ])
      expect(parseFeedback(bad), JSON.stringify(bad)).toBeUndefined();
  });
  it('scores are rounded down to 0.05 in the browser', () => {
    expect(scoreBucket(0.379)).toBe(0.35);
    expect(scoreBucket(1.4)).toBe(1);
    expect(scoreBucket(undefined)).toBe(-1);
  });
});

describe('feedback totals', () => {
  it('only counters are stored', async () => {
    const kv = fakeKv();
    const s = parseFeedback({ auto: 'localizado', verdict: 'localizado', bucket: 0.5, semantic: false })!;
    await recordFeedback(kv, s);
    await recordFeedback(kv, s);
    expect([...kv.m]).toEqual([[feedbackKey(s), '2']]);
    expect(feedbackKey(s)).toBe('fb1:lex:localizado:localizado:0.50');
  });
  it('summarises agreement and the precision above each score', () => {
    const r = summarizeFeedback({
      'fb1:lex:localizado:localizado:0.60': 8,
      'fb1:lex:localizado:nao_localizado:0.40': 2,
      'fb1:lex:ressalva:localizado:0.40': 1,
    });
    expect(r.agreement['lex:localizado']).toEqual({ n: 10, agree: 8 });
    expect(r.thresholds.lex.find((x) => x.bucket === 0.6)?.precision).toBe(1);
    expect(r.thresholds.lex.find((x) => x.bucket === 0.4)?.precision).toBeCloseTo(9 / 11);
  });
});
