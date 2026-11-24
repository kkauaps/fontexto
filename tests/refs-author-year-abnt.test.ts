/**
 * Author-year ABNT lists as journals print them ("SOBRENOME, Nome (2015). Título."), with a hanging indent, running
 * headers whose lone letters sit above the list on each page, and a "Recebido/Aprovado" footer after it.
 * Fictional data only.
 */
import { describe, expect, it } from 'vitest';
import { extractReferenceEntries } from '../src/core/references';
import { parseReferenceText } from '../src/core/refparse';
import type { PdfText, TextLine } from '../src/core/text';

/** Lines as [text, x, y] per page. */
function pdf(pages: [string, number, number][][]): PdfText {
  return {
    pageCount: pages.length,
    info: {},
    pages: pages.map((lines, i) => ({
      page: i + 1,
      width: 595,
      height: 842,
      lines: lines.map(([text, x, y]): TextLine => ({ text, rect: { x, y, w: text.length === 1 ? 1 : Math.min(390, text.length * 5.6), h: 13 }, fontSize: 10 })),
    })),
  };
}

describe('hanging-indent list with stray header letters', () => {
  it('splits every entry, not only at page breaks', () => {
    const entries = [
      ['QUILL, Ada (2000). Reflections on synthetic moss. Contemporary Moss,', 'v. 29, n. 2, p. 296-300.'],
      ['LIND, Bram (2008). Web 2.0 for lichens? First Lichen, v. 13, n. 3.', 'www.example.org/ojs/index.php/fl/article/view/2139/1946 (acesso em 27/04/2023).'],
      ['BRANDT, Maja (2015). Personal connections among spores. New York: Example Press.'],
      ['OKAFOR, Chidi (2017). The social power of moss. Information, Spores &', 'Society, v. 20, n. 1, p. 1-13.'],
      ['NAKAMURA, Rio (2019). Spores and algorithms. Big Moss and Society, v. 4, n. 2.'],
      ['VEGA, Lia (2013). The culture of moss. Oxford: Example University Press.'],
      ['ZORN, Ida (2018). The age of moss capitalism. New York: Example Affairs.'],
      ['ABEL, Otto (2016). Moss as culture. Plural, v. 6, n. 2, p. 275-297.'],
    ];
    const page = (list: string[][], startY: number, header?: string): [string, number, number][] => {
      const out: [string, number, number][] = [];
      let y = startY;
      if (header) out.push([header, 62, 43]);
      for (const e of list) e.forEach((t, k) => out.push([t, k ? 74 : 52, (y += 17)]));
      return out;
    };
    const p1 = [['REFERÊNCIAS', 52, 380] as [string, number, number], ...page(entries.slice(0, 4), 380)];
    const p2 = page(entries.slice(4, 6), 75, 'A');
    const p3 = [...page(entries.slice(6), 75, 'V'), ['Recebido: 01/05/2023 | Aprovado: 01/05/2023', 53, 300] as [string, number, number]];
    const got = extractReferenceEntries(pdf([p1, p2, p3]));
    expect(got.map((e) => e.text.split(' ')[0])).toEqual(['QUILL,', 'LIND,', 'BRANDT,', 'OKAFOR,', 'NAKAMURA,', 'VEGA,', 'ZORN,', 'ABEL,']);
  });
});

describe('author-year ABNT entries', () => {
  it('takes the year in parentheses after the names, not a number in a URL', () => {
    const r = parseReferenceText('LIND, Bram (2008). Web 2.0 for lichens? First Lichen, v. 13, n. 3. www.example.org/ojs/index.php/fl/article/view/2139/1946 (acesso em 27/04/2023).');
    expect(r.year).toBe(2008);
    expect(r.authors[0]).toMatchObject({ family: 'Lind', given: 'Bram' });
    expect(r.title).toBe('Web 2.0 for lichens?');
    expect(parseReferenceText('SILVA, Ana Pereira da (2015). Políticas de acesso ao musgo. Cadernos X, n. 3. http://example.org/wp-content/uploads/2019/04/x.pdf').year).toBe(2015);
  });
  it('skips "(Ed.)", a stray initial and the year before the title', () => {
    expect(parseReferenceText('BRANDT, Maja; LIND, Bram. (Ed.) (1992). Shaping moss / Building lichens. Cambridge: Example Press.').title).toBe('Shaping moss / Building lichens');
    expect(parseReferenceText('KATZ, Ida. E. (2007). “Telephone” In: RITZER, Otto (Ed.). The Encyclopedia of Moss. Malden: Example.').title).toBe('Telephone');
  });
  it('joins a letter-spaced surname and reads an organisation without date', () => {
    expect(parseReferenceText('K ATZ, Ida (2007). “Telephone” In: RITZER, Otto (Ed.). The Encyclopedia of Moss.').authors[0]?.family).toBe('Katz');
    const pew = parseReferenceText('MOSS RESEARCH CENTER (S/A). Internet Fact Sheet. https://www.example.org/fact-sheet (acesso em 27/04/2023).');
    expect(pew.authors[0]?.family).toBe('MOSS RESEARCH CENTER');
    expect(pew.year).toBeUndefined();
    expect(pew.title).toBe('Internet Fact Sheet');
  });
});
