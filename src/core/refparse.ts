/**
 * Structured parsing of the reference list printed in an article, for projects without a `.bib`.
 *
 * `extractReferenceEntries` (references.ts) splits the bibliography into raw entries; this module reads
 * authors, year, title and DOI out of each one (ABNT, APA, IEEE and Vancouver layouts) and can render them as
 * BibTeX so the normal pipeline (in-text marker resolution, PDF linking by DOI/title) works unchanged.
 *
 * Heuristic and conservative: a field that cannot be read is left out, never guessed. Keys are derived from
 * the first family name and the year (`ronneberger2015`, `silva2020b`).
 */
import { findDois } from './normalize.js';
import type { ReferenceEntry } from './references.js';

export type ReferenceStyle = 'abnt' | 'apa' | 'ieee' | 'vancouver' | 'unknown';

export interface ParsedReference {
  index: number;
  text: string;
  style: ReferenceStyle;
  /** "Family, Given" strings (organisations carry `organization: true`). */
  authors: { family: string; given?: string; organization?: boolean }[];
  etAl: boolean;
  year?: number;
  title?: string;
  doi?: string;
  key: string;
  /** Printed numeric label ("[3]"), when the list is numbered. */
  label?: string;
}

const PARTICLE = /^(?:van|von|de|da|der|den|dos|das|del|della|di|du|le|la)$/i;
const INITIAL = /^\p{Lu}{1,2}\.$/u;
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** "RONNEBERGER" -> "Ronneberger", "KESSEL-BRANDT" -> "Kessel-Brandt", "de FREITAS" keeps particles lower-case. */
export function titleCaseName(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((w) => (PARTICLE.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');
}

function detectStyle(text: string, label?: string): ReferenceStyle {
  if (/^\p{Lu}{2,}[\p{Lu}'’\- ]*,\s/u.test(text) || /^\p{Lu}{2,}(?:\.\p{Lu}{1,3})?\.\s+\p{Lu}/u.test(text)) return 'abnt';
  if (/^[^()]{3,200}\(\s*(?:\d{4}[a-z]?|n\.d\.)\s*\)\./u.test(text)) return 'apa';
  if (label || /^(?:\p{Lu}\.\s?){1,3}\p{Lu}[\p{L}'’\-]+/u.test(text) || /["“]/.test(text.slice(0, 250))) return /^\p{Lu}[\p{L}'’\-]+\s\p{Lu}{1,3}[,.]/u.test(text) ? 'vancouver' : 'ieee';
  if (/^\p{Lu}[\p{L}'’\-]+(?:\s\p{Lu}[\p{L}'’\-]+)?\s\p{Lu}{1,3}[,.]/u.test(text)) return 'vancouver';
  if (/^\p{Lu}[\p{L}'’\-]+,\s*(?:\p{Lu}\.|\p{Lu}\p{Ll}+)/u.test(text)) return 'apa';
  return 'unknown';
}

/** Index just after the author block of an ABNT entry, and the parsed authors. */
function abntAuthors(text: string): { authors: ParsedReference['authors']; etAl: boolean; end: number } {
  const authors: ParsedReference['authors'] = [];
  let pos = 0;
  let etAl = false;
  const rest = () => text.slice(pos);
  for (;;) {
    const org = /^(\p{Lu}{2,}(?:\.\p{Lu}{1,3})?)\.\s+(?=\p{Lu})/u.exec(rest());
    if (org && authors.length === 0 && !/^\p{Lu}{2,}[\p{Lu}'’\- ]*,/u.test(rest())) {
      authors.push({ family: org[1], organization: true });
      pos += org[0].length;
      break;
    }
    const m = /^(\p{Lu}[\p{Lu}'’\- ]*?(?:\s[\p{Lu}'’\-]+)*),\s*/u.exec(rest());
    if (!m) break;
    pos += m[0].length;
    const family = titleCaseName(m[1].trim());
    // Given names: words until an initial run ends, a terminal period, ';' or "et al."
    const given: string[] = [];
    let after = false;
    let done = false;
    while (!done) {
      const w = /^(\S+)(\s+|$)/u.exec(rest());
      if (!w) break;
      const tok = w[1];
      if (/^;$/.test(tok) || tok.endsWith(';')) {
        given.push(tok.replace(/;$/, ''));
        pos += w[0].length;
        break;
      }
      if (/^et$/i.test(tok) && /^al\./i.test(rest().slice(w[0].length))) {
        etAl = true;
        pos += w[0].length + 'al.'.length;
        pos += /^\s*/.exec(rest())![0].length;
        done = true;
        break;
      }
      if (INITIAL.test(tok)) {
        given.push(tok);
        pos += w[0].length;
        after = true;
        const nxt = /^(\S+)/u.exec(rest())?.[1] ?? '';
        if (!(INITIAL.test(nxt) || PARTICLE.test(nxt) || /^et$/i.test(nxt))) {
          done = true;
        }
        continue;
      }
      if (PARTICLE.test(tok) && after) {
        given.push(tok);
        pos += w[0].length;
        continue;
      }
      if (tok.endsWith('.') && !/^\p{Lu}\.$/u.test(tok)) {
        given.push(tok.slice(0, -1));
        pos += w[0].length;
        done = true;
        break;
      }
      given.push(tok);
      pos += w[0].length;
    }
    // Trailing lower-case particles belong to the family name ("DALEN, Mirte J. van").
    const particles: string[] = [];
    while (given.length && PARTICLE.test(given[given.length - 1])) particles.unshift(given.pop()!);
    authors.push({ family: [...particles, family].join(' '), given: given.join(' ').trim() || undefined });
    if (done || etAl) break;
    if (/^;/.test(text.slice(pos - 1, pos)) || text[pos - 1] === ' ' && /;/.test(text.slice(pos - 3, pos))) continue;
    // ';' was consumed with the last given-name token above; otherwise the author block ended.
    if (!/;\s*$/.test(text.slice(Math.max(0, pos - 3), pos))) break;
  }
  return { authors, etAl, end: pos };
}

function titleAfter(text: string, from: number): string | undefined {
  const rest = text.slice(from).replace(/^[\s.]+/, '');
  const m = /^(.+?[^\s.])(?:[.?!]\s+(?=\p{Lu}|\d)|\.$|$)/su.exec(rest);
  if (!m) return undefined;
  let t = m[1];
  // keep a trailing "?" or "!" that belongs to the title
  if (/[?!]\s/.test(rest.slice(t.length, t.length + 2))) t += rest[t.length];
  t = t.trim();
  return t.length >= 3 ? t : undefined;
}

function pickYear(text: string, from = 0): number | undefined {
  const clean = text
    .slice(from)
    .replace(/(?:Acesso|Acessado|Accessed|Atualizado|Updated|Retrieved|Dispon[ií]vel)[^.]*?(?:\d{4}|\.)/gi, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b10\.\d{4,9}\/\S+/g, ' ');
  const max = new Date().getFullYear() + 1;
  for (const m of clean.matchAll(/\b(1[5-9]\d{2}|20\d{2})[a-z]?\b/g)) {
    const y = Number(m[1]);
    if (y <= max) return y;
  }
  return undefined;
}

function parseAuthorsGeneric(block: string): { authors: ParsedReference['authors']; etAl: boolean } {
  const etAl = /\bet\s+al\.?/i.test(block);
  const s = block
    .replace(/\bet\s+al\.?/gi, '')
    .replace(/\s*&\s*/g, ', ')
    .replace(/\band\b/gi, ',')
    .replace(/(?:,\s*){2,}/g, ', ')
    .replace(/[,\s]+$/, '');
  const parts = s.split(/\s*,\s*/).filter(Boolean);
  // Vancouver: every part is "Family AB".
  const van = parts.map((p) => /^(\p{Lu}[\p{L}'’\-]+(?:\s\p{Lu}[\p{L}'’\-]+)?)\s(\p{Lu}{1,3})$/u.exec(p));
  if (parts.length && van.every(Boolean)) return { authors: van.map((m) => ({ family: m![1], given: m![2] })), etAl };
  // APA: "Family, A. B., Family2, C." -> (family, initials) pairs.
  const apa: ParsedReference['authors'] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    if (!/^(?:\p{Lu}\.?[\s-]*)+$/u.test(parts[i + 1])) {
      apa.length = 0;
      break;
    }
    apa.push({ family: parts[i], given: parts[i + 1] });
  }
  if (apa.length && parts.length % 2 === 0) return { authors: apa, etAl };
  // IEEE: "A. B. Family, C. Family2"
  const authors: ParsedReference['authors'] = [];
  for (const part of parts) {
    const words = part.split(/\s+/);
    if (words.length === 1) authors.push({ family: words[0] });
    else {
      let i = words.length - 1;
      while (i > 0 && PARTICLE.test(words[i - 1])) i--;
      authors.push({ family: words.slice(i).join(' '), given: words.slice(0, i).join(' ') });
    }
  }
  return { authors, etAl: etAl || authors.length > 12 };
}

const FAMILY = String.raw`(?:(?:van|von|de|da|der|den|dos|das|del|della|di|du|le|la)\s+)*\p{Lu}[\p{L}\p{M}'’¨´\-]+(?:\s(?:\p{Lu}[\p{L}\p{M}'’¨´\-]+))?`;
const INITIALS = String.raw`\p{Lu}\.(?:\s?-?\p{Lu}\.)*`;
const FAMILY_INITIALS_BLOCK = new RegExp(
  String.raw`^(${FAMILY},\s${INITIALS}(?:(?:,\s|,?\s&\s|,?\sand\s)${FAMILY},\s${INITIALS})*(?:,?\s(?:et\s+al\.|\.\.\.\s${FAMILY},\s${INITIALS}))?)(?:,\s((?:1[5-9]|20)\d{2})[a-z]?\.|:(?=\s)|(?=\s(?:\p{Lu}[\p{Ll}\d\-]|["“\d]|\p{Lu}{2,}[\s:\-])))`,
  'u',
);

const NAME_WORD = String.raw`(?:\p{Lu}[\p{L}\p{M}'’\-]+|\p{Lu}\.?|(?:van|von|de|da|der|den|dos|del|di|du|le|la))`;
const GIVEN_FAMILY = String.raw`\p{Lu}[\p{L}\p{M}'’\-]+(?:\s${NAME_WORD}){1,3}`;

/** "Family, A. B., Family2, C. & Family3, D." author block (APA/Harvard/Nature) and, in Harvard, the year after it. */
function familyInitialsBlock(text: string): { authors: string; year?: number; end: number } | undefined {
  const m = FAMILY_INITIALS_BLOCK.exec(text);
  if (!m) return undefined;
  return { authors: m[1].replace(/\.$/, ''), year: m[2] ? Number(m[2]) : undefined, end: m[0].length };
}

export function parseReferenceText(text: string, index = 0, label?: string): Omit<ParsedReference, 'key'> {
  let style = detectStyle(text, label);
  const doi = findDois(text)[0];
  let authors: ParsedReference['authors'] = [];
  let etAl = false;
  let title: string | undefined;
  let year: number | undefined;
  if (style === 'abnt') {
    const a = abntAuthors(text);
    authors = a.authors;
    etAl = a.etAl;
    title = titleAfter(text, a.end);
    year = pickYear(text, a.end + (title?.length ?? 0));
  } else if (style === 'apa') {
    const m = /^(.*?)\(\s*(\d{4})[a-z]?\s*\)[.,:]?\s*/su.exec(text);
    const fb = familyInitialsBlock(text);
    // the block wins unless the "(year)" comes right after it (plain APA)
    const block = fb && (!m || m[1].trim().length > fb.end + 2) ? fb : undefined;
    if (block) {
      // Harvard ("Akram, S. U., Kannala, J., 2016. Title.") and Nature ("Sen, C. K. Title. J. 8, 39 (2019).")
      const g = parseAuthorsGeneric(block.authors);
      authors = g.authors;
      etAl = g.etAl;
      year = block.year ?? pickYear(text, block.end);
      title = titleAfter(text, block.end);
    } else if (m) {
      const g = parseAuthorsGeneric(m[1].trim().replace(/\.$/, ''));
      authors = g.authors;
      etAl = g.etAl;
      year = Number(m[2]);
      title = titleAfter(text, m[0].length - 1);
    }
  } else if (style === 'ieee' || style === 'vancouver') {
    const q = /["“]([^"”]+?)[,.]?["”]/u.exec(text);
    if (q) {
      const g = parseAuthorsGeneric(text.slice(0, q.index).trim().replace(/[,.]$/, ''));
      authors = g.authors;
      etAl = g.etAl;
      title = q[1].trim();
      year = pickYear(text, q.index + q[0].length);
    } else {
      const dot = text.indexOf('. ');
      if (dot > 0) {
        const g = parseAuthorsGeneric(text.slice(0, dot));
        authors = g.authors;
        etAl = g.etAl;
        title = titleAfter(text, dot + 1);
        year = pickYear(text, dot + (title?.length ?? 0));
      }
    }
  }
  if (!authors.length && style !== 'abnt') {
    // LNCS "Long, J., Shelhamer, E.: Title (2014)" and the like
    const fb = familyInitialsBlock(text);
    if (fb) {
      const g = parseAuthorsGeneric(fb.authors);
      authors = g.authors;
      etAl = g.etAl;
      title = titleAfter(text.replace(/\s*\((?:1[5-9]|20)\d{2}[a-z]?\)/, '.'), fb.end);
      year = fb.year ?? pickYear(text, fb.end);
    }
  }
  if (!authors.length && style === 'unknown') {
    // NeurIPS/ICLR natbib: "Mahmoud Assran, Mathilde Caron, and Nicolas Ballas. Title. In ICLR, 2021."
    const m = new RegExp(String.raw`^(${GIVEN_FAMILY}(?:,?\s(?:and\s)?${GIVEN_FAMILY})*(?:,?\set\sal\.?)?)\.\s+(?=\p{Lu}|\d)`, 'u').exec(text);
    if (m) {
      const g = parseAuthorsGeneric(m[1]);
      authors = g.authors;
      etAl = g.etAl;
      title = titleAfter(text, m[0].length);
      year = pickYear(text, m[0].length + (title?.length ?? 0));
      style = 'ieee';
    }
  }
  if (year === undefined) year = pickYear(text);
  return { index, text, style, authors, etAl, year, title, doi, label };
}

/** Parses every entry and assigns unique keys (`family` + `year` + optional letter). */
export function parseReferences(entries: Pick<ReferenceEntry, 'index' | 'text' | 'label'>[]): ParsedReference[] {
  const used = new Map<string, number>();
  return entries.map((e) => {
    const p = parseReferenceText(e.text, e.index, e.label);
    const base = `${fold(p.authors[0]?.family ?? 'ref') || 'ref'}${p.year ?? ''}`;
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    return { ...p, key: n === 0 ? base : `${base}${String.fromCharCode(96 + n + 1)}` };
  });
}

const esc = (s: string) => s.replace(/[{}\\]/g, ' ').replace(/\s+/g, ' ').trim();

/** BibTeX text for the entries that carry enough to be matched (an author and a year). */
export function toBibtex(refs: ParsedReference[]): string {
  const out: string[] = ['% Gerado automaticamente a partir da lista de referências do artigo. Confira antes de usar.'];
  for (const r of refs) {
    if (!r.authors.length || !r.year) continue;
    const authors = r.authors.map((a) => (a.organization ? `{${esc(a.family)}}` : a.given ? `${esc(a.family)}, ${esc(a.given)}` : esc(a.family))).join(' and ') + (r.etAl ? ' and others' : '');
    const fields = [`author = {${authors}}`, `year = {${r.year}}`];
    if (r.title) fields.push(`title = {{${esc(r.title)}}}`);
    if (r.doi) fields.push(`doi = {${r.doi}}`);
    fields.push(`note = {Extraído da lista de referências do artigo}`);
    out.push(`@misc{${r.key},\n  ${fields.join(',\n  ')}\n}`);
  }
  return out.join('\n\n') + '\n';
}
