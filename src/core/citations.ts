/**
 * In-text citation markers ("(Silva et al., 2025)", "(SILVA; SOUZA, 2020)",
 * "Kettavainen et al. (2026)") and their resolution to bibliography records.
 *
 * A marker is resolved only when exactly one publication matches. Several
 * matches (e.g. two "Silva 2025" works) produce an `ambiguous` result that must
 * be reviewed; nothing is picked arbitrarily.
 */
import type { PublicationNode, Rect } from './model.js';
import { normalizeName, sameFamilyName } from './normalize.js';
import type { PdfText } from './text.js';

export interface MarkerReference {
  /** Surnames as written in the marker, in order. */
  authors: string[];
  etAl: boolean;
  year: number;
  /** e.g. "2025a" */
  yearLabel: string;
  /** Narrative form ("Silva et al. (2020)"), which may capture preceding capitalized words. */
  narrative?: boolean;
}

export interface CitationMarker extends MarkerReference {
  raw: string;
  page: number;
  rects: Rect[];
  pageSize: { width: number; height: number };
}

const NAME = String.raw`\p{Lu}[\p{L}'’.\-]*(?:\s+(?:(?:van|von|de|da|der|den|dos|del|di|le)\s+)?\p{Lu}[\p{L}'’.\-]*)?`;
const AUTHORS = String.raw`${NAME}(?:\s*[,;]\s*${NAME})*(?:\s*,?\s+(?:and|e|&)\s+${NAME})?(?:\s+et\s+al\.?)?`;
const NARRATIVE_RE = new RegExp(String.raw`(?<![\p{L}])(${AUTHORS})\s*\(((?:1[5-9]|20)\d{2}[a-z]?)(?:,\s*p+\.\s*[\d\-–]+)?\)`, 'gu');
const PAREN_RE = /\(([^()]{3,400})\)/g;
const YEAR_IN_SEGMENT = /\b((?:1[5-9]|20)\d{2})([a-z])?\b/g;
const LEADING_NOISE = /^(?:e\.g\.,?|i\.e\.,?|see(?:\s+also)?|cf\.|ver|veja|conforme|segundo)\s+/i;

function parseAuthorPart(part: string): { authors: string[]; etAl: boolean } | undefined {
  let s = part.replace(LEADING_NOISE, '').trim().replace(/[,;\s]+$/, '');
  const etAl = /\bet\s+al\.?/i.test(s);
  s = s.replace(/\bet\s+al\.?/gi, '').trim().replace(/[,;\s]+$/, '');
  if (!s) return undefined;
  const authors = s
    .split(/\s*(?:;|,|&|\band\b|\be\b)\s*/)
    .map((a) => a.trim())
    .filter(Boolean);
  if (authors.length === 0 || authors.length > 6) return undefined;
  if (!authors.every((a) => /^\p{Lu}/u.test(a) && a.split(/\s+/).length <= 4)) return undefined;
  return { authors, etAl };
}

/** Parses the content of a parenthetical citation into one or more references. */
export function parseParenthetical(content: string): MarkerReference[] {
  const out: MarkerReference[] = [];
  const rawSegments = content.split(';').map((s) => s.trim());
  // ABNT joins co-authors with ';' ("SILVA; SOUZA, 2020"): merge segments without a year forward.
  const segments: string[] = [];
  let carry = '';
  for (const seg of rawSegments) {
    const merged = carry ? `${carry}; ${seg}` : seg;
    if (/\b(?:1[5-9]|20)\d{2}[a-z]?\b/.test(seg)) {
      segments.push(merged);
      carry = '';
    } else carry = merged;
  }
  for (const seg0 of segments) {
    const seg = seg0.replace(/,\s*(?:p|pp|s)\.\s*[\d\-–, ]+$/i, '');
    const years = [...seg.matchAll(YEAR_IN_SEGMENT)];
    if (years.length === 0) continue;
    const authorPart = seg.slice(0, years[0].index);
    const parsed = parseAuthorPart(authorPart);
    if (!parsed) continue;
    for (const y of years) {
      out.push({ ...parsed, year: Number(y[1]), yearLabel: y[1] + (y[2] ?? '') });
    }
  }
  return out;
}

export function extractMarkersFromText(text: string): (MarkerReference & { raw: string; start: number; end: number })[] {
  const out: (MarkerReference & { raw: string; start: number; end: number })[] = [];
  for (const m of text.matchAll(PAREN_RE)) {
    for (const ref of parseParenthetical(m[1])) {
      out.push({ ...ref, raw: m[0], start: m.index!, end: m.index! + m[0].length });
    }
  }
  for (const m of text.matchAll(NARRATIVE_RE)) {
    const parsed = parseAuthorPart(m[1]);
    if (!parsed) continue;
    const yearLabel = m[2];
    out.push({ ...parsed, narrative: true, year: Number(yearLabel.slice(0, 4)), yearLabel, raw: m[0], start: m.index!, end: m.index! + m[0].length });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Extracts markers page by page, keeping the rectangles of the lines that contain them. */
export function extractCitationMarkers(pdf: PdfText): CitationMarker[] {
  const out: CitationMarker[] = [];
  for (const p of pdf.pages) {
    const offsets: number[] = [];
    let text = '';
    for (const l of p.lines) {
      offsets.push(text.length);
      text += l.text + ' ';
    }
    for (const m of extractMarkersFromText(text)) {
      const rects: Rect[] = [];
      p.lines.forEach((l, i) => {
        const s = offsets[i];
        const e = s + l.text.length;
        if (s < m.end && e > m.start) rects.push(l.rect);
      });
      const { start: _s, end: _e, ...rest } = m;
      out.push({ ...rest, page: p.page, rects, pageSize: { width: p.width, height: p.height } });
    }
  }
  return out;
}

export type MarkerResolution =
  | { status: 'resolved'; publicationId: string }
  | { status: 'ambiguous'; candidates: string[] }
  | { status: 'unresolved'; candidates: [] };

export function resolveMarker(marker: MarkerReference, pubs: PublicationNode[]): MarkerResolution {
  // Narrative markers may capture preceding capitalized words ("Following Silva et al. (2020)",
  // "ImageNet, e Velloran et al. (2025)"): try the full form first, then drop leading words/names.
  // Parenthetical markers are never shifted: "(Silva; Souza, 2020)" must not resolve to Souza 2020.
  const variants: MarkerReference[] = [marker];
  if (marker.narrative) {
    const words = (marker.authors[0] ?? '').split(/\s+/).filter(Boolean);
    for (let i = 1; i < words.length; i++) variants.push({ ...marker, authors: [words.slice(i).join(' '), ...marker.authors.slice(1)] });
    for (let k = 1; k < marker.authors.length; k++) variants.push({ ...marker, authors: marker.authors.slice(k) });
  }
  for (const v of variants) {
    const res = resolveVariant(v, pubs);
    if (res.status !== 'unresolved') return res;
  }
  return { status: 'unresolved', candidates: [] };
}

function resolveVariant(marker: MarkerReference, pubs: PublicationNode[]): MarkerResolution {
  const first = marker.authors[0];
  let candidates = pubs.filter((p) => p.year === marker.year && p.authors[0] && sameFamilyName(p.authors[0].family, first));
  if (candidates.length === 0) return { status: 'unresolved', candidates: [] };

  // Year suffix ("2025a") only disambiguates when the bibliography uses suffixes too.
  if (marker.yearLabel.length > 4) {
    const bySuffix = candidates.filter((p) => p.yearLabel === marker.yearLabel);
    if (bySuffix.length > 0) candidates = bySuffix;
  }
  if (!marker.etAl && marker.authors.length > 1) {
    const second = marker.authors[1];
    const bySecond = candidates.filter((p) => p.authors[1] && sameFamilyName(p.authors[1].family, second));
    if (bySecond.length > 0) candidates = bySecond;
  }
  if (!marker.etAl && marker.authors.length === 1) {
    const solo = candidates.filter((p) => p.authors.length === 1);
    if (solo.length === 1 && candidates.length > 1) candidates = solo;
  }
  if (marker.etAl) {
    const many = candidates.filter((p) => p.authors.length >= 3);
    if (many.length > 0) candidates = many;
  }
  if (candidates.length === 1) return { status: 'resolved', publicationId: candidates[0].id };
  return { status: 'ambiguous', candidates: candidates.map((c) => c.id) };
}

export const markerKey = (m: MarkerReference) => `${normalizeName(m.authors[0])}|${m.yearLabel}|${m.etAl ? 'etal' : m.authors.length}`;
