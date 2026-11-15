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
import { findArxivIds, findDois } from './normalize.js';
import type { ReferenceEntry } from './references.js';

export type ReferenceStyle = 'abnt' | 'apa' | 'ieee' | 'vancouver' | 'gbt' | 'unknown';

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
  /** arXiv id (e.g. "1809.10486"), when the entry cites a preprint. */
  arxiv?: string;
  key: string;
  /** Printed numeric label ("[3]"), when the list is numbered. */
  label?: string;
  /** A thesis or dissertation (ABNT "Tese (Doutorado)", APA "[Doctoral dissertation]", GOST "дис.", GB/T "[D]"). */
  thesis?: boolean;
}

const PARTICLE = /^(?:van|von|de|da|der|den|dos|das|del|della|di|du|le|la)$/i;
const INITIAL = /^\p{Lu}{1,2}\.$/u;
/** Lower-case particle, written out or abbreviated ("de", "d."), as it appears after the initials in ABNT. */
const LOWER_PARTICLE = /^(?:van|von|de|da|der|den|do|dos|das|del|della|di|du|le|la|d\.)$/;
/** GOST 7.1 / 7.0.5 (Russian): "Иванов И.И., Петров П. [и др.] Заглавие // Журнал. – 2018. – Т. 5, № 3. – С. 10–20." */
const GOST_RE = /^((?:\p{Lu}[\p{L}'’\-]+(?:\s\p{Lu}[\p{L}'’\-]+)?\s(?:\p{Lu}\.\s?){1,3},?\s*)+)(\[?\s*(?:и\s+др|et\s+al)\.?\s*\]?)?\s*(.+?)\s+\/\/\s+(.+)$/su;
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
  if (/^\p{Lu}{2,}[\p{Lu}'’\- ]*,\s*["“]/u.test(text)) return 'ieee';
  if (/^\p{Lu}{2,}[\p{Lu}'’\- ]*,\s/u.test(text) || /^\p{Lu}{2,}(?:\.\p{Lu}{1,3})?\.\s+\p{Lu}/u.test(text)) return 'abnt';
  if (/^[^()]{3,200}\(\s*(?:\d{4}[a-z]?|n\.d\.)\s*\)\.\s+\S/u.test(text)) return 'apa';
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
        const nxt = (/^(\S+)/u.exec(rest())?.[1] ?? '').replace(/;$/, '');
        // "BOLGER, A. M.; LOHSE, M." (the next initial carries the ";"), "SOUZA, A. C. d."; a capitalised word after
        // the initials ("La", "De") starts the title, it is not a particle.
        if (!(INITIAL.test(nxt) || LOWER_PARTICLE.test(nxt) || /^et$/i.test(nxt))) {
          done = true;
        }
        continue;
      }
      if (LOWER_PARTICLE.test(tok) && after) {
        given.push(tok);
        pos += w[0].length;
        const nxt = (/^(\S+)/u.exec(rest())?.[1] ?? '').replace(/;$/, '');
        if (/\.$/.test(tok) && !(INITIAL.test(nxt) || LOWER_PARTICLE.test(nxt) || /^et$/i.test(nxt))) done = true;
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
  const rest = text.slice(from).replace(/^[\s.,]+/, '').replace(/^\(\s*(?:1[5-9]|20)\d{2}[a-z]?\s*\)[.,:]?\s*/, '');
  // a quoted title: « Titre », “Title,” or "Title."
  // (only when the quote closes the title: '"Big data" in health' is a title that starts with a quotation)
  const q = /^[«“"]\s*([^»”"]{3,}?)[\s,.]*[»”"]/u.exec(rest);
  if (q && /^\s*(?:[,.;:]|$|\p{Lu}|\d)/u.test(rest.slice(q[0].length))) return q[1].trim();
  const m = /^(.+?[^\s.])(?:[.?!]+\s+(?=\p{Lu}|\p{Lo}|\d|\[|https?:|doi:|arXiv\b)|\.$|$)/su.exec(rest);
  if (!m) return undefined;
  let t = m[1];
  // keep a trailing "?" or "!" that belongs to the title
  if (/[?!]\s/.test(rest.slice(t.length, t.length + 2))) t += rest[t.length];
  // APA thesis/description in brackets after the title: "Title [Doctoral dissertation, University]"
  t = t.replace(/\s*\[[^\]]*(?:dissertation|thesis|tesis|tese|disserta[cç][aã]o|диссертац)[^\]]*\]\s*$/iu, '').trim();
  // GB/T 7714 document-type marks: "标题[J]", "Title[M]", "[EB/OL]"
  t = t.replace(/\s*\[(?:J|M|D|C|N|R|S|P|Z|A|G|EB\/OL|DB\/OL|J\/OL|M\/OL|CP)\]\s*$/, '').trim();
  return t.length >= 3 ? t : undefined;
}

function pickYear(text: string, from = 0): number | undefined {
  const clean = text
    .slice(from)
    .replace(/(?:Acesso|Acessado|Accessed|Atualizado|Updated|Retrieved|Dispon[ií]vel|cited|consultado|дата\s+обращения)[^\]\)]{0,40}?\d{4}/giu, ' ')
    .replace(/(?:Acesso|Acessado|Accessed|Atualizado|Updated|Retrieved|Dispon[ií]vel)[^.]*?(?:\d{4}|\.)/gi, ' ')
    .replace(/(?:\b(?:pp?|S|vol|v|no|n|nr)\.?|С\.|Т\.|№)\s*\d+(?:\s*[–—-]\s*\d+)?/gu, ' ')
    .replace(/:\s*\d+\s*[–—-]\s*\d+/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b10\.\d{4,9}\/\S+/g, ' ')
    .replace(/\b(?:arxiv:?\s*)?\d{4}\.\d{4,5}(?:v\d+)?\b/gi, ' ');
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
  String.raw`^(${FAMILY},\s${INITIALS}(?:(?:,\s|,?\s&\s|,?\sand\s)${FAMILY},\s${INITIALS})*(?:,?\s(?:et\s+al\.|\.\.\.\s${FAMILY},\s${INITIALS}))?)(?:,?\s((?:1[5-9]|20)\d{2})[a-z]?\.|:(?=\s)|(?=\s(?:\p{Lu}[\p{Ll}\d\-]|["“\d]|\p{Lu}{2,}[\s:\-]|\p{Ll}+\p{Lu})))`,
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

// GB/T 7714: "张三, 李四, 王五, 等. 标题[J]. 期刊, 2020, 78(3): 1-10." or "ZHOU Q H, LI S, et al. Title[J]. ...".
const GBT_RE = /^(.{1,200}?)[.．]\s*(.+?)\s*\[(?:J|M|D|C|N|R|S|P|Z|A|G|EB\/OL|DB\/OL|J\/OL|M\/OL|CP)\]/su;
const HAN_RE = /^[\p{Script=Han}·]+$/u;
/** Authors of a GB/T 7714 entry, or undefined when the entry is not GB/T-shaped. */
export function gbtAuthors(text: string): { authors: ParsedReference['authors']; etAl: boolean; title: string } | undefined {
  const m = GBT_RE.exec(text);
  if (!m) return undefined;
  const block = m[1].trim();
  const parts = block.split(/\s*[,，、;；]\s*/).map((p) => p.trim()).filter(Boolean);
  let etAl = false;
  const authors: ParsedReference['authors'] = [];
  for (const p of parts) {
    if (/^(?:等|et\s*al\.?)$/i.test(p)) {
      etAl = true;
      continue;
    }
    // Chinese names stay whole: in-text author-year citations ("（张越, 2025）") and catalogues use the full name.
    if (HAN_RE.test(p)) {
      authors.push({ family: p.replace(/\s+/g, '') });
      continue;
    }
    // Pinyin/Latin: the family name comes first, in capitals ("ZHOU Q H", "ZHANG San", "HOPEWELL S").
    const w = /^(\p{Lu}[\p{Lu}'’\-]+)(?:\s+(.+))?$/u.exec(p);
    if (!w) return undefined;
    authors.push({ family: titleCaseName(w[1]), given: w[2]?.trim() || undefined });
  }
  if (!authors.length) return undefined;
  return { authors, etAl, title: m[2].trim() };
}

const THESIS_RE = /\b(?:tese\s*\((?:doutorado|mestrado|livre)|disserta[cç][aã]o\s*\(mestrado|ph\.?\s?d\.?\s+(?:thesis|dissertation)|doctoral\s+(?:thesis|dissertation)|master'?s\s+(?:thesis|dissertation)|m\.?\s?sc\.?\s+thesis|tesis\s+(?:doctoral|de\s+(?:maestr[ií]a|doctorado|licenciatura))|th[eè]se\s+de\s+doctorat|dissertation\s+zur)|дис\.|диссертация\s+на\s+соискание|автореф|\[D\]|学位论文/iu;
/** True when the entry text describes a thesis or dissertation. */
export function isThesisText(text: string): boolean {
  return THESIS_RE.test(text);
}
// GOST thesis without the "//" part: "Петров И. И. Методы синтетических решёток : дис. … канд. техн. наук. – М., 2018."
const GOST_THESIS_RE = /^(\p{Lu}[\p{L}'’\-]+)\s((?:\p{Lu}\.\s?){1,3})\s*(.+?)\s+:\s+(?:дис|автореф)/u;

/** Drops leftover author fragments that the splitter sometimes returns as a "title". */
function usableTitle(t: string | undefined): string | undefined {
  if (!t) return undefined;
  const s = t.trim();
  if (s.length < 3) return undefined;
  // "et al." in the middle of a Nature entry is an author mark, not the title.
  if (/^(?:et\s+al\.?|&|and)\s*$/i.test(s)) return undefined;
  if (/^et\s+al\.?\s+/i.test(s)) {
    const rest = s.replace(/^et\s+al\.?\s+/i, '').trim();
    return usableTitle(rest);
  }
  if (/^(?:&|and)\s+$/i.test(s)) return undefined;
  if (/^(?:&\s*)?(?:\p{Lu}\.\s*)+\p{Lu}\.?$/u.test(s)) return undefined;
  if (/^\p{Lu}\.\s*et\s+al\.?$/u.test(s)) return undefined;
  return s;
}

export function parseReferenceText(text: string, index = 0, label?: string): Omit<ParsedReference, 'key'> {
  const doi = findDois(text)[0];
  const arxiv = findArxivIds(text)[0];
  const gostThesis = GOST_THESIS_RE.exec(text);
  if (gostThesis) {
    return { index, text, style: 'vancouver', authors: [{ family: gostThesis[1], given: gostThesis[2].replace(/\s+/g, '') }], etAl: false, year: pickYear(text, gostThesis[0].length), title: usableTitle(gostThesis[3].trim()), doi, arxiv, label, thesis: true };
  }
  const gbt = gbtAuthors(text);
  if (gbt) {
    const after = text.indexOf(gbt.title) + gbt.title.length;
    return { index, text, style: 'gbt', authors: gbt.authors, etAl: gbt.etAl, year: pickYear(text, after) ?? pickYear(text), title: gbt.title.length >= 2 ? gbt.title : undefined, doi, arxiv, label };
  }
  const gost = GOST_RE.exec(text);
  if (gost) {
    const authors = gost[1]
      .split(/,\s*/)
      .map((a) => a.trim())
      .filter(Boolean)
      .map((a) => {
        const m = /^(.+?)\s((?:\p{Lu}\.\s?){1,3})$/u.exec(a);
        return m ? { family: m[1], given: m[2].replace(/\s+/g, '') } : { family: a };
      });
    const title = gost[3].trim().replace(/[\s.]+$/, '');
    return { index, text, style: 'vancouver', authors, etAl: Boolean(gost[2]), year: pickYear(gost[4]) ?? pickYear(text), title: title.length >= 3 ? title : undefined, doi, arxiv, label };
  }
  // French/European author-year with capitals and no comma: "BARJOT D. (2012), « Titre », Revue..."
  const fr = /^((?:\p{Lu}[\p{Lu}'’\-]+(?:\s\p{Lu}[\p{Lu}'’\-]+)?\s(?:\p{Lu}\.\s?){1,3},?\s*)+(?:et\s+al\.)?)\s*\(\s*((?:1[5-9]|20)\d{2})[a-z]?\s*\)[,.:]?\s*/u.exec(text);
  if (fr) {
    const authors = fr[1]
      .replace(/et\s+al\./, '')
      .split(/,\s*/)
      .map((a) => a.trim())
      .filter(Boolean)
      .map((a) => {
        const m = /^(.+?)\s((?:\p{Lu}\.\s?){1,3})$/u.exec(a);
        return m ? { family: titleCaseName(m[1]), given: m[2].trim() } : { family: titleCaseName(a) };
      });
    return { index, text, style: 'apa', authors, etAl: /et\s+al\./.test(fr[1]), year: Number(fr[2]), title: usableTitle(titleAfter(text, fr[0].length)), doi, arxiv, label };
  }
  let style = detectStyle(text, label);
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
    // IEEE usually quotes the title; numbered Nature/Harvard lists do not, and splitting on the
    // first ". " cuts through initials ("Family, I., Family, I. Title.").
    const q = /["“]([^"”]+?)[,.]?["”]/u.exec(text);
    const etAlHead = new RegExp(
      String.raw`^(${FAMILY},\s${INITIALS}(?:(?:,\s|,?\s&\s|,?\sand\s)${FAMILY},\s${INITIALS})*)\s+et\s+al\.\s+`,
      'u',
    ).exec(text);
    const fb = familyInitialsBlock(text);
    // "Zhou Wang, A. Bovik, H. Sheikh" can look like "Family, I." if we stop after the first initials.
    const fbComplete = Boolean(fb && !/^\s*\p{Lu}[\p{L}'’\-]+,\s*\p{Lu}\./u.test(text.slice(fb.end)));
    if (q && (!etAlHead || q.index < etAlHead[0].length) && (!fbComplete || q.index < (fb?.end ?? Infinity))) {
      const g = parseAuthorsGeneric(text.slice(0, q.index).trim().replace(/[,.]$/, ''));
      authors = g.authors;
      etAl = g.etAl;
      title = q[1].trim();
      year = pickYear(text, q.index + q[0].length);
    } else if (etAlHead) {
      const g = parseAuthorsGeneric(etAlHead[1]);
      authors = g.authors;
      etAl = true;
      title = titleAfter(text, etAlHead[0].length);
      year = pickYear(text, etAlHead[0].length);
    } else if (fbComplete && fb) {
      const g = parseAuthorsGeneric(fb.authors);
      authors = g.authors;
      etAl = g.etAl;
      year = fb.year ?? pickYear(text, fb.end);
      title = titleAfter(text, fb.end);
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
  return { index, text, style, authors, etAl, year, title: usableTitle(title), doi, arxiv, label };
}

/** Parses every entry and assigns unique keys (`family` + `year` + optional letter). */
export function parseReferences(entries: Pick<ReferenceEntry, 'index' | 'text' | 'label'>[]): ParsedReference[] {
  const used = new Map<string, number>();
  return entries.map((e) => {
    const p = parseReferenceText(e.text, e.index, e.label);
    if (isThesisText(e.text)) p.thesis = true;
    const base = `${fold(p.authors[0]?.family ?? 'ref') || 'ref'}${p.year ?? ''}`;
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    return { ...p, key: n === 0 ? base : `${base}${String.fromCharCode(96 + n + 1)}` };
  });
}

const esc = (s: string) => s.replace(/[{}\\]/g, ' ').replace(/\s+/g, ' ').trim();

/** BibTeX text for every entry with an author or a title (year optional). */
export function toBibtex(refs: ParsedReference[]): string {
  const out: string[] = ['% Gerado automaticamente a partir da lista de referências do artigo. Confira antes de usar.'];
  for (const r of refs) {
    // an entry without a readable year (or author) is still a source of the document: keep it in the graph
    if (!r.authors.length && !r.title) continue;
    const authors = r.authors.map((a) => (a.organization ? `{${esc(a.family)}}` : a.given ? `${esc(a.family)}, ${esc(a.given)}` : esc(a.family))).join(' and ') + (r.etAl ? ' and others' : '');
    const fields = [...(r.authors.length ? [`author = {${authors}}`] : []), ...(r.year ? [`year = {${r.year}}`] : [])];
    if (r.title) fields.push(`title = {{${esc(r.title)}}}`);
    if (r.doi) fields.push(`doi = {${r.doi}}`);
    if (r.arxiv) {
      fields.push(`eprint = {${r.arxiv}}`);
      fields.push(`archivePrefix = {arXiv}`);
      fields.push(`url = {https://arxiv.org/abs/${r.arxiv}}`);
    }
    fields.push(`note = {Extraído da lista de referências do artigo}`);
    out.push(`@${r.thesis ? 'phdthesis' : 'misc'}{${r.key},\n  ${fields.join(',\n  ')}\n}`);
  }
  return out.join('\n\n') + '\n';
}
