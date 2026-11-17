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

describe('does not take a different work for the cited one (live cases)', () => {
  const run = async (q: { title: string; year: number; author: string }, candidates: unknown[]) => {
    const { resetOaState, lookupOpenAccess } = await import('../src/core/openAccess');
    resetOaState();
    const f = (async (input: RequestInfo | URL) => {
      const u = String(input);
      const body = u.startsWith('https://api.openalex.org/works?') ? { results: candidates } : u.startsWith('https://api.crossref.org/works?') ? { message: { items: [] } } : {};
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    return lookupOpenAccess(q, f);
  };
  const work = (title: string, year: number, authors: string[]) => ({ id: 'https://openalex.org/W9', doi: null, title, display_name: title, publication_year: year, authorships: authors.map((a) => ({ author: { display_name: a } })), locations: [] });

  it('a commentary whose title contains the cited title, by someone else', async () => {
    const r = await run({ title: 'Attention is all you need', year: 2017, author: 'Vaswani' }, [
      work('5分で分かる!? 有名論文ナナメ読み：Ashish Vaswani et al. : Attention Is All You Need', 2018, ['中沢 敏明']),
    ]);
    expect(r.status).toBe('not_found');
  });

  it('same language, common surname, same year and a few generic words', async () => {
    const r = await run({ title: 'Segmentação de feridas crônicas em imagens digitais', year: 2019, author: 'Silva' }, [
      work('Pré-Processamento de Imagens Digitais para Segmentação de Pimentas', 2019, ['Paulo Renato Baliza Silva', 'Arlindo Rodrigues Galvão Filho']),
    ]);
    expect(r.status).toBe('not_found');
  });

  it('still accepts the same work catalogued under its English translation', async () => {
    const r = await run({ title: 'Segmentação semântica de imagens médicas com redes neurais convolucionais', year: 2020, author: 'Oliveira' }, [
      work('Semantic segmentation of medical images with convolutional neural networks', 2020, ['Ana Oliveira', 'João Costa']),
    ]);
    expect(r.status).not.toBe('not_found');
    expect(r.title).toMatch(/Semantic segmentation of medical images/);
  });
});
