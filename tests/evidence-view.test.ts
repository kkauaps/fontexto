import { describe, expect, it } from 'vitest';
import type { CitationOccurrence } from '../src/core/evidence';
import { countByStatus, filterGroups, groupOccurrences, neighbourGroup, occurrencesByPublication } from '../src/core/evidenceView';

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
    expect(countByStatus(report)).toEqual({ all: 4, localizado: 1, ressalva: 1, nao_localizado: 1, unresolved: 1 });
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
});
