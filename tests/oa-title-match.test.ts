import { describe, expect, it } from 'vitest';
import { normalizeBibliographicTitle, parseOaQuery, scoreBibliographicMatch, titleSimilarity } from '../src/core/openAccess';

describe('bibliographic title lookup', () => {
  it('strips ABNT access tails before matching', () => {
    const noisy = 'Climate wedges: emissions paths for a stable planet. Disponível em: <https://example.org>. Acesso em: 1 jan. 2020.';
    expect(normalizeBibliographicTitle(noisy)).toBe('Climate wedges: emissions paths for a stable planet.');
    const q = parseOaQuery(new URLSearchParams({ title: noisy, year: '2004', author: 'Doe' }));
    expect(q?.title).toBe('Climate wedges: emissions paths for a stable planet.');
  });

  it('rejects distant years and weak titles', () => {
    const q = { title: 'Lumen Index for Fictional Growth', year: 2021, author: 'Quillfeather' };
    const good = scoreBibliographicMatch(q, 'Lumen Index for Fictional Growth', ['A. Quillfeather'], 2021);
    const badYear = scoreBibliographicMatch(q, 'Lumen Index for Fictional Growth', ['A. Quillfeather'], 1998);
    const wrong = scoreBibliographicMatch(q, 'Unrelated methods survey', ['B. Other'], 2021);
    expect(good).toBeGreaterThan(0.9);
    expect(badYear).toBeLessThan(0.8);
    expect(wrong).toBeLessThan(0.75);
    expect(titleSimilarity(q.title, 'Lumen Index for Fictional Growth')).toBeGreaterThan(0.85);
  });

  it('matches a bilingual catalog title that contains the queried title', () => {
    const q = { title: 'Indice de lumen para o crescimento ficticio', year: 2021, author: 'Quillfeather' };
    const catalog = 'Lumen index for fictional growth. Indice de lumen para o crescimento ficticio';
    expect(titleSimilarity(q.title, catalog)).toBeGreaterThan(0.85);
    expect(scoreBibliographicMatch(q, catalog, ['Ada Quillfeather'], 2021)).toBeGreaterThan(0.9);
  });

  it('matches a translated catalog title when author and year agree', () => {
    const q = { title: 'Indice de lumen para o crescimento ficticio modelado', year: 2021, author: 'Quillfeather' };
    const catalog = 'Lumen index for modeled fictional growth';
    expect(scoreBibliographicMatch(q, catalog, ['Ada Quillfeather'], 2021)).toBeGreaterThanOrEqual(0.82);
  });

  it('does not accept a weak title overlap even with the same author and year', () => {
    const q = { title: 'Lumen Index for Fictional Growth', year: 2021, author: 'Quillfeather' };
    const other = 'Survey of fictional methods for lumen analysis';
    expect(scoreBibliographicMatch(q, other, ['Ada Quillfeather'], 2021)).toBeLessThan(0.8);
  });
});
