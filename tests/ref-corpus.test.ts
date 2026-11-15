/**
 * Diverse reference-parsing regression corpus: ABNT, APA, IEEE, Vancouver, Harvard, Nature,
 * GOST, DIN, GB/T; PT/ES/EN/RU/FR/DE/ZH; DOIs (including spaced/SICI), arXiv, PMC, conference
 * and no-DOI entries. Public gold_all metadata or fictional typography only — no PTCC material.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseReferenceText } from '../src/core/refparse';
import { sameFamilyName, titleSimilarity } from '../src/core/normalize';

type Case = {
  id: string;
  doc: string;
  lang: string;
  style: string;
  source: 'corpus' | 'synthetic';
  text: string;
  label?: string;
  expect: { family: string; year: number; title: string; doi?: string; arxiv?: string };
};

const { cases } = JSON.parse(readFileSync(new URL('./fixtures/ref-corpus.json', import.meta.url), 'utf8')) as { cases: Case[] };

function check(c: Case) {
  const r = parseReferenceText(c.text, 0, c.label);
  const family = r.authors[0]?.family ?? '';
  const titleOk = titleSimilarity(r.title ?? '', c.expect.title) >= 0.85 || (r.title ?? '').toLowerCase().includes(c.expect.title.toLowerCase().slice(0, 24));
  const yearInText = c.text.includes(String(c.expect.year));
  return {
    id: c.id,
    source: c.source,
    style: c.style,
    lang: c.lang,
    family: sameFamilyName(family, c.expect.family) || family.toLowerCase().endsWith(c.expect.family.toLowerCase()),
    year: !yearInText || r.year === c.expect.year,
    title: titleOk,
    doi: !c.expect.doi || !c.text.toLowerCase().replace(/\s+/g, '').includes(c.expect.doi.toLowerCase()) || r.doi === c.expect.doi.toLowerCase(),
    arxiv: !c.expect.arxiv || r.arxiv === c.expect.arxiv,
    got: { family, year: r.year, title: r.title, doi: r.doi, arxiv: r.arxiv },
  };
}

describe('ref-corpus regression', () => {
  it('covers many styles and languages', () => {
    const styles = new Set(cases.map((c) => c.style));
    const langs = new Set(cases.map((c) => c.lang));
    for (const s of ['abnt', 'apa', 'ieee', 'vancouver', 'harvard', 'nature', 'gost']) expect(styles.has(s), s).toBe(true);
    for (const l of ['pt', 'en', 'es', 'ru']) expect(langs.has(l), l).toBe(true);
    expect(cases.some((c) => c.expect.arxiv)).toBe(true);
    expect(cases.some((c) => c.expect.doi && c.text.includes(' '))).toBe(true);
    expect(cases.some((c) => !c.expect.doi && !c.expect.arxiv)).toBe(true);
    expect(cases.length).toBeGreaterThanOrEqual(80);
  });

  it('parses every synthetic failure-mode case (Nature, spaced DOI, arXiv, IEEE quotes)', () => {
    const failed = cases.filter((c) => c.source === 'synthetic').map(check).filter((r) => !r.family || !r.year || !r.title || !r.doi || !r.arxiv);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
  });

  it('does not regress title, first author, year or DOI on the public gold slice', () => {
    const rows = cases.filter((c) => c.source === 'corpus').map(check);
    const n = rows.length;
    const rate = (k: 'family' | 'year' | 'title' | 'doi' | 'arxiv') => rows.filter((r) => r[k]).length / n;
    // Floors sit just below the live 23-PDF gold scores on main. A few gold years disagree with the printed text.
    expect(rate('family'), 'first author').toBeGreaterThanOrEqual(0.85);
    expect(rate('year'), 'year').toBeGreaterThanOrEqual(0.90);
    expect(rate('title'), 'title').toBeGreaterThanOrEqual(0.90);
    expect(rate('doi'), 'doi').toBeGreaterThanOrEqual(0.90);

  });
});
