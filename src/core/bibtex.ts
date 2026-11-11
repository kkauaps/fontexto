/**
 * Small, dependency-free BibTeX / BibLaTeX parser.
 *
 * It handles braced and quoted values, nested braces, `#` concatenation,
 * @string macros, month macros and @comment/@preamble blocks. Field values are
 * returned raw (LaTeX not decoded) so callers can decide how to decode them.
 */

export interface BibEntry {
  key: string;
  type: string;
  fields: Record<string, string>;
  /** 1-based line where the entry starts, for error reporting. */
  line: number;
}

export interface BibParseResult {
  entries: BibEntry[];
  errors: { line: number; message: string }[];
}

const MONTHS: Record<string, string> = {
  jan: '1', feb: '2', mar: '3', apr: '4', may: '5', jun: '6',
  jul: '7', aug: '8', sep: '9', oct: '10', nov: '11', dec: '12',
};

export function parseBibtex(source: string): BibParseResult {
  const entries: BibEntry[] = [];
  const errors: { line: number; message: string }[] = [];
  const macros: Record<string, string> = { ...MONTHS };
  let i = 0;
  const n = source.length;

  const lineAt = (pos: number) => source.slice(0, pos).split('\n').length;

  while (i < n) {
    const at = source.indexOf('@', i);
    if (at < 0) break;
    // Skip '@' inside line comments ("% ...@...").
    const lineStart = source.lastIndexOf('\n', at) + 1;
    if (/^\s*%/.test(source.slice(lineStart, at + 1))) {
      i = at + 1;
      continue;
    }
    let j = at + 1;
    const typeMatch = /^[A-Za-z]+/.exec(source.slice(j));
    if (!typeMatch) {
      i = j;
      continue;
    }
    const type = typeMatch[0].toLowerCase();
    j += typeMatch[0].length;
    while (j < n && /\s/.test(source[j])) j++;
    const open = source[j];
    if (open !== '{' && open !== '(') {
      i = j;
      continue;
    }
    const close = open === '{' ? '}' : ')';
    const bodyStart = j + 1;
    // Find matching close, respecting braces.
    let depth = 1;
    let k = bodyStart;
    let inQuote = false;
    while (k < n && depth > 0) {
      const c = source[k];
      if (c === '\\') {
        k += 2;
        continue;
      }
      if (c === '"' && open === '{' && depth === 1) inQuote = !inQuote;
      if (!inQuote) {
        if (c === '{' || (open === '(' && c === '(')) depth++;
        else if (c === '}' || (open === '(' && c === ')')) depth--;
      }
      if (depth === 0 && c === close) break;
      k++;
    }
    if (depth !== 0) {
      errors.push({ line: lineAt(at), message: `Unterminated @${type} entry` });
      break;
    }
    const body = source.slice(bodyStart, k);
    i = k + 1;

    if (type === 'comment' || type === 'preamble') continue;
    if (type === 'string') {
      const fields = parseFields(body, macros, errors, lineAt(at));
      Object.assign(macros, Object.fromEntries(Object.entries(fields).map(([kk, v]) => [kk.toLowerCase(), v])));
      continue;
    }
    const comma = body.indexOf(',');
    if (comma < 0) {
      errors.push({ line: lineAt(at), message: `Entry @${type} has no key` });
      continue;
    }
    const key = body.slice(0, comma).trim();
    if (!key) {
      errors.push({ line: lineAt(at), message: `Entry @${type} has an empty key` });
      continue;
    }
    const fields = parseFields(body.slice(comma + 1), macros, errors, lineAt(at));
    entries.push({ key, type, fields, line: lineAt(at) });
  }
  return { entries, errors };
}

function parseFields(
  body: string,
  macros: Record<string, string>,
  errors: { line: number; message: string }[],
  line: number,
): Record<string, string> {
  const fields: Record<string, string> = {};
  let i = 0;
  const n = body.length;
  while (i < n) {
    while (i < n && /[\s,]/.test(body[i])) i++;
    if (i >= n) break;
    const nameMatch = /^[A-Za-z0-9_\-:.+]+/.exec(body.slice(i));
    if (!nameMatch) {
      errors.push({ line, message: `Unexpected text in entry: "${body.slice(i, i + 20)}"` });
      break;
    }
    const name = nameMatch[0].toLowerCase();
    i += nameMatch[0].length;
    while (i < n && /\s/.test(body[i])) i++;
    if (body[i] !== '=') {
      errors.push({ line, message: `Field "${name}" without "="` });
      break;
    }
    i++;
    let value = '';
    // value := part ('#' part)*
    for (;;) {
      while (i < n && /\s/.test(body[i])) i++;
      const c = body[i];
      if (c === '{') {
        let depth = 1;
        let k = i + 1;
        while (k < n && depth > 0) {
          if (body[k] === '\\') {
            k += 2;
            continue;
          }
          if (body[k] === '{') depth++;
          else if (body[k] === '}') depth--;
          k++;
        }
        value += body.slice(i + 1, k - 1);
        i = k;
      } else if (c === '"') {
        let k = i + 1;
        let depth = 0;
        while (k < n && !(body[k] === '"' && depth === 0)) {
          if (body[k] === '\\') {
            k += 2;
            continue;
          }
          if (body[k] === '{') depth++;
          else if (body[k] === '}') depth--;
          k++;
        }
        value += body.slice(i + 1, k);
        i = k + 1;
      } else {
        const m = /^[A-Za-z0-9_\-:.+]+/.exec(body.slice(i));
        if (!m) break;
        const word = m[0];
        value += /^\d+$/.test(word) ? word : (macros[word.toLowerCase()] ?? word);
        i += word.length;
      }
      while (i < n && /\s/.test(body[i])) i++;
      if (body[i] === '#') {
        i++;
        continue;
      }
      break;
    }
    fields[name] = value.replace(/\s+/g, ' ').trim();
  }
  return fields;
}
