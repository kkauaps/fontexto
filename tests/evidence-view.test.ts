import { describe, expect, it } from 'vitest';
import type { CitationOccurrence } from '../src/core/evidence';
import { countByStatus, filterGroups, formatPassage, passageParts, groupOccurrences, neighbourGroup, occurrencesByPublication } from '../src/core/evidenceView';

const occ = (id: string, spanId: string, extra: Partial<CitationOccurrence> = {}): CitationOccurrence => ({
  id,
  spanId,
  marker: `(M ${spanId})`,
  page: 1,
  nthOnPage: 0,
  rects: [],
  pageSize: { width: 1, height: 1 },
  resolution: 'resolved',
  publicationId: 'pub:a',
  candidates: [],
  sentence: `Frase ${spanId}.`,
  claim: `Frase ${spanId}.`,
  status: 'localizado',
  notes: [],
  passages: [],
  ...extra,
});

const report = {
  occurrences: [
    occ('o1-0', 's1'),
    occ('o2-0', 's2', { status: 'ressalva', publicationId: 'pub:b' }),
    occ('o2-1', 's2', { status: 'nao_localizado', publicationId: 'pub:c' }),
    occ('o3-0', 's3', { resolution: 'unresolved', publicationId: undefined, status: undefined, sentence: 'Fonte não identificada (Foobar, 2001).' }),
  ],
};

describe('evidence view helpers', () => {
  const groups = groupOccurrences(report);

  it('groups occurrences by marker span and uses the worst status', () => {
    expect(groups.map((g) => [g.spanId, g.occurrences.length, g.status])).toEqual([
      ['s1', 1, 'localizado'],
      ['s2', 2, 'nao_localizado'],
      ['s3', 1, 'unresolved'],
    ]);
  });

  it('counts occurrences by status, like the report summary', () => {
    expect(countByStatus(report)).toEqual({ all: 4, localizado: 1, ressalva: 1, nao_localizado: 1, unresolved: 1, sem_pdf: 0 });
    expect(occurrencesByPublication(report).get('pub:b')).toBe(1);
  });

  it('filters by status, publication and accent-insensitive text', () => {
    expect(filterGroups(groups, { status: 'ressalva' }).map((g) => g.spanId)).toEqual(['s2']);
    expect(filterGroups(groups, { status: 'all', publicationId: 'pub:c' }).map((g) => g.spanId)).toEqual(['s2']);
    expect(filterGroups(groups, { status: 'all', search: 'NAO identificada' }).map((g) => g.spanId)).toEqual(['s3']);
    expect(filterGroups(groups, { status: 'unresolved' }).map((g) => g.spanId)).toEqual(['s3']);
    expect(filterGroups(groups, { status: 'all' })).toHaveLength(3);
  });

  it('walks to the next/previous citation with wrap-around', () => {
    expect(neighbourGroup(groups, undefined, 1)?.spanId).toBe('s1');
    expect(neighbourGroup(groups, undefined, -1)?.spanId).toBe('s3');
    expect(neighbourGroup(groups, 's3', 1)?.spanId).toBe('s1');
    expect(neighbourGroup(groups, 's1', -1)?.spanId).toBe('s3');
    expect(neighbourGroup([], 's1', 1)).toBeUndefined();
  });

  it('counts a missing PDF separately from “não localizado”', () => {
    const r = { occurrences: [occ('o4-0', 's4', { status: 'nao_localizado', reason: 'sem_pdf' }), occ('o5-0', 's5', { status: 'nao_localizado', reason: 'sem_passagem' })] };
    expect(countByStatus(r)).toMatchObject({ sem_pdf: 1, nao_localizado: 1, all: 2 });
    expect(groupOccurrences(r).map((g) => g.status)).toEqual(['sem_pdf', 'nao_localizado']);
  });
});

describe('formatPassage', () => {
  it('breaks a single extracted block into sentences', () => {
    const block = 'However, wound assessment is visual. Wound evolution is assessed not only based on its dimensions. The Red/Yellow/Black model allows discrimination of tissue types.';
    expect(formatPassage(block)).toBe(
      'However, wound assessment is visual.\n\nWound evolution is assessed not only based on its dimensions.\n\nThe Red/Yellow/Black model allows discrimination of tissue types.',
    );
  });
  it('rejoins hyphenated line wraps and keeps paragraph breaks', () => {
    expect(formatPassage('segmen-\ntation of wound\n\nNext paragraph.')).toBe('segmentation of wound\n\nNext paragraph.');
  });
});

describe('passageParts', () => {
  it('marks the focus sentence inside a formatted passage', () => {
    const text = 'The application is left to present the result to its user in text form. The set of images was composed of 393 photos.';
    const parts = passageParts(text, 'The set of images was composed of 393 photos.');
    expect(parts.some((p) => p.highlight && /393 photos/.test(p.text))).toBe(true);
    expect(parts.some((p) => !p.highlight && /application is left/.test(p.text))).toBe(true);
  });
});
