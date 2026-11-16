/**
 * Monographs, theses and dissertations (TCC, monografia, dissertação, tese) in several languages and citation
 * styles: long documents whose bibliography heading also sits in the table of contents, lists that span pages,
 * appendices and annexes (with their own short reference list) before or after the real one, running headers,
 * page numbers, blank lines between entries, hanging indents and entries without DOI.
 * Every author, title, publisher and city is invented.
 */
import { describe, expect, it } from 'vitest';
import { extractReferenceEntries, isReferenceHeading, isSectionStop, referenceRanges } from '../src/core/references';
import { parseReferences, parseReferenceText } from '../src/core/refparse';
import { extractMarkersFromText, resolveMarker } from '../src/core/citations';
import { parseAuthor } from '../src/core/normalize';
import { joinLines } from '../src/core/text';
import type { PublicationNode } from '../src/core/model';
import { buildMonograph, wrap, wrapChars, type ListLayout } from './helpers/monograph';

const FAMILIES = ['ALVORADA', 'BRUMADO', 'CASTELINHO', 'DOURADINA', 'ESMERALDO', 'FONTELA', 'GARAPUAVA', 'HORTÊNSIO', 'ITAMBIRA', 'JACUTINGA', 'LAJEADO', 'MANGABEIRA', 'NOGUEIRAL', 'ORVALHINO', 'PEDRALVA', 'QUEIMADENSE', 'RIBEIRALTO', 'SAMBAQUI', 'TAPERUÁ', 'URUPEMA', 'VARJOTA', 'ZABELÊ'];
const GIVEN = ['Ana Clarice', 'Bento', 'Celina Maria', 'Dario', 'Elisa', 'Fausto R.', 'Glória', 'Heitor', 'Iara', 'Joaquim'];
const CITIES = ['São Paulo', 'Rio de Janeiro', 'Porto Fictício', 'Belo Horizonte', 'Vila Inventada'];
const PUBLISHERS = ['Editora Imaginária', 'Editora Inventada', 'Edições Fictícias', 'Editora Exemplo'];

/** A long ABNT list mixing books, chapters, articles without DOI, theses, laws, websites, corporate and title-first entries. */
function abntEntries(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const fam = `${FAMILIES[i % FAMILIES.length]}${i >= FAMILIES.length ? 'S' : ''}`;
    const giv = GIVEN[i % GIVEN.length];
    const city = CITIES[i % CITIES.length];
    const pub = PUBLISHERS[i % PUBLISHERS.length];
    const year = 1980 + ((i * 7) % 44);
    switch (i % 9) {
      case 0: // book, Word style "Editora X, cidade, ano" (the continuation line starts with "São Paulo, ..." when wrapped)
        out.push(`${fam}, ${giv}. Economia de lattices imaginárias: teoria e prática de redes sintéticas. ${i + 1}ª edição. ${pub}, ${city}, ${year}.`);
        break;
      case 1: // chapter
        out.push(`${fam}, ${giv}; ${FAMILIES[(i + 3) % FAMILIES.length]}, ${GIVEN[(i + 2) % GIVEN.length]}. Capítulo inventado sobre dados fictícios. In: ${FAMILIES[(i + 5) % FAMILIES.length]}, ${GIVEN[(i + 4) % GIVEN.length]} (org.). Coletânea de estudos inventados. ${city}: ${pub}, ${year}. p. 10-35.`);
        break;
      case 2: // article without DOI
        out.push(`${fam}, ${giv}. Desempenho de redes sintéticas em mercados fictícios. Revista Brasileira de Estudos Inventados, ${city}, v. ${i}, n. 2, p. 7-14, abr. ${year}.`);
        break;
      case 3: // thesis
        out.push(`${fam}, ${giv}. A utilização de lattices imaginárias como fator competitivo. ${year}. Tese (Doutorado em Economia Fictícia) – Universidade Federal do Exemplo, ${city}, ${year}.`);
        break;
      case 4: // law
        out.push(`BRASIL. Lei nº ${10000 + i}, de ${(i % 27) + 1} de março de ${year}. Dispõe sobre regimes fictícios de exportação. Diário Oficial da União: seção 1, Brasília, DF, ${year}. Disponível em: http://www.exemplo.gov.br/leis/l${10000 + i}.htm. Acesso em: 10 out. 2026.`);
        break;
      case 5: // website, URL broken across lines
        out.push(`${fam}, ${giv}. Os problemas da empresa fictícia exportadora. ${year}. Disponível em: http://www.exemplo.com.br/comex/html/empresa_exportadora/empresa_exportadora_${i}.html. Acesso em: 31 ago. 2014.`);
        break;
      case 6: // corporate author in capitals
        out.push(`UNIVERSIDADE FEDERAL DO EXEMPLO. Manual de normas inventadas para trabalhos acadêmicos. ${city}: UFE, ${year}.`);
        break;
      case 7: // repeated author (same author as the entry above)
        out.push(`______. Segundo volume inventado sobre lattices imaginárias. ${city}: ${pub}, ${year}.`);
        break;
      default: // title-first entry
        out.push(`ESTUDO${i} temático sobre empresas fictícias e lattices imaginárias. ${city}: ${pub}, ${year}.`);
    }
  }
  return out;
}

const toc = (refHeading: string, extra: string[] = []) => [
  '1 INTRODUÇÃO ........................................................................ 9',
  '2 REFERENCIAL TEÓRICO ............................................................ 14',
  '3 METODOLOGIA ...................................................................... 40',
  ...extra,
  refHeading,
  '100',
];

describe('long ABNT monograph (pt-BR)', () => {
  const entries = abntEntries(45);
  const annexRefs = entries.slice(0, 6);
  const base = {
    bodyPages: 110,
    header: 'Universidade Fictícia do Exemplo · Curso de Economia Inventada',
    footer: 'Centro de Ciências Fictícias Aplicadas',
  };

  it('picks the real list at the end, not the table of contents, and stops at the appendix and annex', () => {
    const pdf = buildMonograph({
      ...base,
      toc: toc('REFERÊNCIAS', ['APÊNDICE A – QUESTIONÁRIO ........ 120', 'ANEXO A – PROJETO DE PESQUISA ........ 125']),
      sections: [
        { heading: '7 REFERÊNCIAS', entries: entries.map((e) => wrap(e)), layout: 'gap' },
        { heading: 'APÊNDICE A – QUESTIONÁRIO', lines: ['1. Qual a sua idade? Resposta de exemplo, 2020.', '2. Desde quando exporta? Desde 1998.'] },
        { heading: 'ANEXO A – PROJETO DE PESQUISA', lines: ['Projeto de pesquisa inventado apresentado em 2014.'] },
        { heading: '8 Referências', entries: annexRefs.map((e) => wrap(e)), layout: 'gap' },
      ],
    });
    expect(pdf.pages.length).toBeGreaterThan(100);
    const got = extractReferenceEntries(pdf);
    expect(got).toHaveLength(45);
    expect(got.map((e) => e.text)).toEqual(entries.map((e) => joinLines(wrap(e)).normalize('NFKC')));
    // the bibliography (not the appendix) is cut out of the citation scan
    const { ranges } = referenceRanges(pdf);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].end).toBeDefined();
  });

  it('finds the real list when an annexed project with its own short list comes before it', () => {
    const pdf = buildMonograph({
      ...base,
      toc: toc('Referências', ['Anexos ........ 59']),
      sections: [
        { heading: 'ANEXOS', lines: ['Projeto de Pesquisa', 'SUMÁRIO', '1 Justificativa', '8 Referências'] },
        { heading: '10 REFERÊNCIAS', entries: annexRefs.map((e) => wrap(e, 80)), layout: 'gap' },
        { heading: 'REFERÊNCIAS', entries: entries.map((e) => wrap(e, 80)), layout: 'gap' },
      ],
    });
    const got = extractReferenceEntries(pdf);
    expect(got).toHaveLength(45);
    expect(got[0].text).toMatch(/^ALVORADA, Ana Clarice\. Economia/);
  });

  it('reads authors, years and titles of every kind of entry', () => {
    const refs = parseReferences(entries.slice(0, 9).map((text, index) => ({ index, text })));
    expect(refs.map((r) => r.authors[0]?.family ?? '')).toEqual(['Alvorada', 'Brumado', 'Castelinho', 'Douradina', 'BRASIL', 'Fontela', 'UNIVERSIDADE FEDERAL DO EXEMPLO', 'UNIVERSIDADE FEDERAL DO EXEMPLO', '']);
    expect(refs.every((r) => r.year !== undefined)).toBe(true);
    expect(refs[8].title).toMatch(/^ESTUDO8 temático/);
    expect(refs[7].title).toBe('Segundo volume inventado sobre lattices imaginárias');
    expect(refs[3].thesis).toBe(true);
    // the broken URL is glued back
    expect(joinLines(wrap(entries[5], 60))).toContain('empresa_exportadora_5.html');
  });

  it('keeps the list together when entries are not separated by blank lines (flush layout)', () => {
    const pdf = buildMonograph({ ...base, bodyPages: 20, toc: toc('REFERÊNCIAS'), sections: [{ heading: 'REFERÊNCIAS', entries: entries.slice(0, 18).map((e) => wrap(e)), layout: 'flush' }] });
    // without geometry, entries that start with a title or "______" still split on their own shape
    expect(extractReferenceEntries(pdf).length).toBeGreaterThanOrEqual(16);
  });
});

describe('Word-style quirks in ABNT entries', () => {
  it.each([
    ['GIRASSOLADO, Fábio; VILELINHA André; TORRALVA, Lavínia Barros de. Economia inventada. Rio de Janeiro, Editora Exemplo, 2011.', ['Girassolado', 'Vilelinha', 'de Torralva'], 'Economia inventada'],
    ['MARIZAL, Jayme de Souza .Economia Internacional Fictícia. Editora Exemplo, 9ª edição, São Paulo, 2004.', ['Marizal'], 'Economia Internacional Fictícia'],
    ['WEIDENFELDO & NICOLINO. Comércio inventado – fluxo de bens fictícios. Editora Exemplo, Rio de Janeiro, 1975.', ['Weidenfeldo', 'Nicolino'], 'Comércio inventado – fluxo de bens fictícios'],
    ['CARVALHAL, Maria Auxiliadora de; SILVEIRAL, César R. Leite da. Economia Fictícia. Editora Exemplo, 2007.', ['de Carvalhal', 'Silveiral'], 'Economia Fictícia'],
    ['LAPLANADO, Mariano; HIRATUKO Célio (Org.). Internacionalização inventada. Editora Exemplo, Campinas, 2003.', ['Laplanado', 'Hiratuko'], 'Internacionalização inventada'],
    ['Ministério do Desenvolvimento, Indústria e Comércio Fictício. Aprendendo a exportar. http://www.exemplo.gov.br', ['Ministério do Desenvolvimento, Indústria e Comércio Fictício'], 'Aprendendo a exportar'],
  ])('%s', (text, families, title) => {
    const r = parseReferenceText(text);
    expect(r.authors.map((a) => a.family)).toEqual(families);
    expect(r.title).toBe(title);
  });
});

describe('Spanish thesis (APA 7, hanging indent, "Referencias bibliográficas")', () => {
  const entries = Array.from({ length: 30 }, (_, i) => {
    const fam = ['Quebrada', 'Montaraz', 'Pedregal', 'Salitre', 'Arboleda', 'Cañaveral'][i % 6] + (i >= 6 ? `ez${i}` : '');
    if (i % 5 === 0) return `${fam}, M. J. (${1995 + i}). La investigación inventada en salud ficticia [Tesis doctoral, Universidad Imaginaria]. Repositorio Ficticio. https://repositorio.example.org/handle/${i}`;
    if (i % 5 === 1) return `${fam}, A., & Robledal, C. (${1995 + i}). Educación superior inventada en tres países ficticios. Editorial Ejemplo.`;
    if (i % 5 === 2) return `Instituto Nacional de Estadística Ficticia. (${1995 + i}). Anuario estadístico inventado. Recuperado de https://ine.example.org/anuario/${i}`;
    return `${fam}, R. (${1995 + i}). Metodología de la investigación ficticia: un enfoque inventado. Revista de Estudios Imaginarios, ${i}(2), 73–101.`;
  });
  it('splits on the hanging indent and stops at "Anexos"', () => {
    const pdf = buildMonograph({
      bodyPages: 60,
      header: 'Universidad Imaginaria · Facultad de Ejemplo',
      toc: ['1. Introducción ........ 5', 'Referencias bibliográficas ........ 61', 'Anexos ........ 66'],
      sections: [
        { heading: 'Referencias bibliográficas', entries: entries.map((e) => wrap(e, 84)), layout: 'hanging' },
        { heading: 'Anexos', lines: ['Anexo A. Cuestionario aplicado en 2023.'] },
      ],
    });
    const got = extractReferenceEntries(pdf);
    expect(got).toHaveLength(30);
    expect(got[2].text).toMatch(/^Instituto Nacional de Estadística Ficticia\. \(1997\)/);
  });
});

describe('English APA dissertation (double spaced, hanging indent)', () => {
  const entries = Array.from({ length: 40 }, (_, i) => {
    const fam = ['Ashgrove', 'Brindlewood', 'Coldharbour', 'Dunmere', 'Elderwick'][i % 5] + (i >= 5 ? `son${i}` : '');
    if (i % 4 === 0) return `${fam}, T. (${1990 + (i % 30)}). Imaginary lattices.`;
    if (i % 4 === 1) return `${fam}, L. K. (${1990 + (i % 30)}). Synthetic data in invented markets [Doctoral dissertation, University of Nowhere]. Fictional Dissertations Archive.`;
    if (i % 4 === 2) return `${fam}, P., & Fernhill, Q. (${1990 + (i % 30)}). Chapter on invented methods. In R. Oakhurst (Ed.), Handbook of fictional research (pp. 1–20). Example Press.`;
    return `${fam}, J. (${1990 + (i % 30)}). Gradient methods for invented boundaries. Journal of Synthetic Studies, ${i}(3), 1–12. https://doi.org/10.99999/jss.${i}`;
  });
  it('reads 40 entries and stops at the appendix', () => {
    const pdf = buildMonograph({
      bodyPages: 80,
      header: 'RUNNING HEAD: IMAGINARY LATTICES',
      toc: ['Chapter 1: Introduction ........ 1', 'References ........ 81', 'Appendix A ........ 88'],
      sections: [
        { heading: 'References', entries: entries.map((e) => wrap(e, 80)), layout: 'hanging' },
        { heading: 'Appendix A', lines: ['Interview protocol used in 2024.'] },
      ],
    });
    expect(extractReferenceEntries(pdf)).toHaveLength(40);
  });
});

describe('Russian dissertation (GOST, numbered)', () => {
  const entries = Array.from({ length: 25 }, (_, i) => `${i + 1}. ${['Вымыслов', 'Небылицын', 'Придумкин', 'Сказочкин', 'Выдумщиков'][i % 5]} ${'АБВГД'[i % 5]}. ${'ЕЖЗИК'[i % 5]}. Методы вымышленных решёток в синтетических данных : монография. – Москва : Издательство Пример, ${1990 + i}. – ${100 + i} с.`);
  it('reads the numbered list and stops at "Приложение А"', () => {
    const pdf = buildMonograph({
      bodyPages: 90,
      header: 'Вымышленный университет',
      toc: ['Введение ........ 3', 'Список использованной литературы ........ 91', 'Приложение А ........ 95'],
      sections: [
        { heading: 'СПИСОК ИСПОЛЬЗОВАННОЙ ЛИТЕРАТУРЫ', entries: entries.map((e) => wrap(e, 80)), layout: 'flush' },
        { heading: 'Приложение А', lines: ['1. Анкета, 2020.', '2. Таблица, 2021.'] },
      ],
    });
    const got = extractReferenceEntries(pdf);
    expect(got).toHaveLength(25);
    expect(got[24].label).toBe('25.');
    expect(parseReferences(got)[0].authors[0].family).toBe('Вымыслов');
  });
});

describe('Chinese and Japanese theses (CJK)', () => {
  it('reads a GB/T 7714 list and stops at 附录', () => {
    const entries = Array.from({ length: 20 }, (_, i) => `[${i + 1}] ${['张虚构', '李示例', '王假设', '赵模拟'][i % 4]}, ${['陈杜撰', '刘编造'][i % 2]}. 虚构晶格方法在合成数据中的应用研究第${i + 1}部分[J]. 示例学报, ${2000 + i}, ${i + 1}(3): 1-10.`);
    const pdf = buildMonograph({
      bodyPages: 70,
      header: '虚构大学硕士学位论文',
      toc: ['第一章 绪论 ........ 1', '参考文献 ........ 71', '附录A ........ 75'],
      sections: [
        { heading: '参考文献', entries: entries.map((e) => wrapChars(e, 40)), layout: 'flush' },
        { heading: '附录A 调查问卷', lines: ['1. 您的年龄？2020年。'] },
      ],
    });
    const got = extractReferenceEntries(pdf);
    expect(got).toHaveLength(20);
    expect(parseReferences(got)[0].authors[0].family).toBe('张虚构');
  });

  it('reads a Japanese author-year list separated by blank lines and stops at 付録', () => {
    const entries = Array.from({ length: 15 }, (_, i) => `${['山田架空', '佐藤仮名', '鈴木例示'][i % 3]}${i}（${2000 + i}）『架空の格子モデルと合成データの研究 第${i + 1}巻』例示出版。`);
    const pdf = buildMonograph({
      bodyPages: 50,
      header: '架空大学 修士論文',
      toc: ['第1章 序論 ........ 1', '参考文献 ........ 51', '付録 ........ 54'],
      sections: [
        { heading: '参考文献', entries: entries.map((e) => wrapChars(e, 30)), layout: 'gap' },
        { heading: '付録', lines: ['調査票（2020年）'] },
      ],
    });
    expect(extractReferenceEntries(pdf)).toHaveLength(15);
  });
});

describe('thesis made of articles (one list per chapter)', () => {
  it('keeps every chapter list', () => {
    const ch = (k: number) => Array.from({ length: 8 }, (_, i) => `${['Quillfeather', 'Rowanberry', 'Thistledown', 'Underhay'][(i + k) % 4]}${['ton', 'ley', 'wick', 'mere', 'ford', 'stead', 'holm', 'by'][i]}${k === 1 ? '' : 'e'}, A. (${2001 + i}). Chapter ${k} invented work ${i}. Journal of Fictional Results, ${i}, 1–9.`);
    const pdf = buildMonograph({
      bodyPages: 30,
      toc: ['Chapter 1 ........ 1', 'References ........ 10', 'Chapter 2 ........ 11', 'References ........ 20'],
      sections: [
        { heading: 'References', entries: ch(1).map((e) => wrap(e, 80)), layout: 'hanging' },
        { heading: 'Chapter 2: A second invented study', lines: Array.from({ length: 30 }, (_, i) => `Prose of the second invented study, line ${i + 1}.`) },
        { heading: 'References', entries: ch(2).map((e) => wrap(e, 80)), layout: 'hanging' },
      ],
    });
    const got = extractReferenceEntries(pdf);
    expect(got).toHaveLength(16);
    expect(got.some((e) => /Prose of the second/.test(e.text))).toBe(false);
  });
});

describe('two-column bibliography', () => {
  it('follows the columns', () => {
    const entries = abntEntries(24).filter((e) => !e.startsWith('______'));
    const pdf = buildMonograph({ bodyPages: 10, twoColumns: true, toc: toc('REFERÊNCIAS'), sections: [{ heading: 'REFERÊNCIAS', entries: entries.map((e) => wrap(e, 44)), layout: 'gap' as ListLayout }] });
    expect(extractReferenceEntries(pdf)).toHaveLength(entries.length);
  });
});

describe('headings', () => {
  it.each(['REFERÊNCIAS', '7 REFERÊNCIAS', '7. REFERÊNCIAS BIBLIOGRÁFICAS', 'VII – Bibliografía', 'R E F E R Ê N C I A S', 'Bibliografia consultada', 'Obras citadas', 'Works Cited', 'Reference List', 'Список литературы', 'Библиографический список', '参考文献', '引用・参考文献', '참고문헌'])('"%s" is a bibliography heading', (h) => {
    expect(isReferenceHeading(h)).toBe(true);
  });
  it.each(['Referências ............................ 86', 'As referências mostram que', 'REFERENCIAL TEÓRICO'])('"%s" is not', (h) => {
    expect(isReferenceHeading(h)).toBe(false);
  });
  it.each(['APÊNDICE A – QUESTIONÁRIO', 'ANEXOS', 'Anexo B', 'Appendix A: Interview protocol', 'Приложение А', '附录A 调查问卷', '付録', 'ANEXO A – Relatório anual de 2013'])('"%s" closes the bibliography', (h) => {
    expect(isSectionStop(h)).toBe(true);
  });
  it.each(['anexo da Portaria n. 12, 2010.', 'Annex to the invented regulation 12, 2010.', 'Appendices of the Fictional Society, v. 3, 2001.'])('"%s" does not', (h) => {
    expect(isSectionStop(h)).toBe(false);
  });
});

describe('in-text citations that miss the list by a slip', () => {
  const pub = (id: string, authors: string[], year: number | undefined, title = `Title ${id}`): PublicationNode => ({
    id,
    kind: 'publication',
    label: id,
    title,
    authors: authors.map((a) => (a.startsWith('{') ? { ...parseAuthor(a), family: a.slice(1, -1) } : parseAuthor(a))),
    year,
    bibKeys: [],
    fileIds: [],
    metadataSources: [],
    inMainBibliography: true,
  });
  const pubs = [
    pub('arv', ['Arvoredo, Ana', 'Sertanejo, Bento'], 2003),
    pub('dia', ['Diamantino, Lino'], 1989),
    pub('pic', ['Picchioni, Carla'], 2010),
    pub('mdi', ['{Ministério do Desenvolvimento, Indústria e Comércio Fictício}'], undefined),
    pub('est', [], 2007, 'ESTUDO temático sobre empresas fictícias'),
    pub('sil1', ['Silvado, Ana'], 2001),
    pub('sil2', ['Silvado, Ana'], 2004),
  ];
  const resolve = (text: string) => extractMarkersFromText(text).map((m) => resolveMarker(m, pubs));

  it('links a year typo when every named author matches one entry, and says so', () => {
    expect(resolve('Segundo Arvoredo e Sertanejo (2004, p. 13), o regime...')[0]).toMatchObject({ status: 'resolved', publicationId: 'arv', approx: { kind: 'year' } });
    expect(resolve('(ARVOREDO; SERTANEJO, 2004)')[0]).toMatchObject({ status: 'resolved', publicationId: 'arv' });
    expect(resolve('Diamantino (1999) afirma')[0]).toMatchObject({ status: 'resolved', publicationId: 'dia', approx: { kind: 'year', listed: 'Diamantino (1989)' } });
  });
  it('links a one-letter spelling slip with the same year', () => {
    expect(resolve('Picchini (2010) mostra')[0]).toMatchObject({ status: 'resolved', publicationId: 'pic', approx: { kind: 'name' } });
  });
  it('links an acronym and a title-first entry', () => {
    expect(resolve('Dados do MDIC (2008) indicam')[0]).toMatchObject({ status: 'resolved', publicationId: 'mdi', approx: { kind: 'acronym' } });
    expect(resolve('(ESTUDO..., 2007)')[0]).toMatchObject({ status: 'resolved', publicationId: 'est', approx: { kind: 'title' } });
  });
  it('never guesses between two near entries, nor across a far year', () => {
    expect(resolve('Silvado (2002) conclui')[0].status).toBe('unresolved');
    expect(resolve('Diamantino (1975) conclui')[0].status).toBe('unresolved');
    expect(resolve('Arvoredo (2003) sozinho')[0].status).not.toBe('ambiguous');
  });
  it('exact matches carry no approximation', () => {
    expect(resolve('(DIAMANTINO, 1989)')[0]).toEqual({ status: 'resolved', publicationId: 'dia' });
  });
});

describe('Japanese author-year entries', () => {
  it('reads authors, year and the title in 『』, and the in-text "山田（2000）" finds them', () => {
    const r = parseReferenceText('山田架空一（2000）『架空の格子モデルの研究』例示出版。');
    expect(r.authors.map((a) => a.family)).toEqual(['山田架空一']);
    expect(r.year).toBe(2000);
    expect(r.title).toBe('架空の格子モデルの研究');
    const two = parseReferenceText('佐藤仮名・鈴木例示 (2019). 架空の論文名. 例示雑誌, 3(2), 1-10.');
    expect(two.authors.map((a) => a.family)).toEqual(['佐藤仮名', '鈴木例示']);
    const pub: PublicationNode = { id: 'y', kind: 'publication', label: 'y', title: r.title, authors: [{ ...parseAuthor('x'), family: '山田架空一' }], year: 2000, bibKeys: [], fileIds: [], metadataSources: [], inMainBibliography: true };
    const m = extractMarkersFromText('先行研究として山田（2000）がある。');
    expect(resolveMarker(m[0], [pub])).toEqual({ status: 'resolved', publicationId: 'y' });
  });
});

describe('running header of a short document', () => {
  it('drops a centred header that the extractor lists out of reading order', () => {
    const line = (text: string, x: number, y: number) => ({ text, rect: { x, y, w: Math.min(470, text.length * 5), h: 11 }, fontSize: 10 });
    const pdf = {
      pageCount: 2,
      info: {},
      pages: [
        { page: 1, width: 595, height: 842, lines: [line('Texto inventado.', 63, 100), line('Referências', 63, 700), line('ALVORADA, A. Título inventado. Revista Fictícia, v. 1, p. 1-9, 2001.', 63, 730), line('BRUMADO, B. Outro título inventado que continua na linha de baixo e na página', 63, 760), line('Revista Genérica · v. 1', 250, 16), line('1', 296, 820)] },
        { page: 2, width: 595, height: 842, lines: [line('seguinte. Revista Fictícia, v. 2, p. 3-4, 2002.', 81, 64), line('CASTELINHO, C. Terceiro título inventado. Revista Fictícia, 2003.', 63, 85), line('Revista Genérica · v. 1', 250, 16), line('2', 296, 820)] },
      ],
    };
    const got = extractReferenceEntries(pdf);
    expect(got.map((e) => e.text.slice(0, 9))).toEqual(['ALVORADA,', 'BRUMADO, ', 'CASTELINH']);
    expect(got.some((e) => e.text.includes('Revista Genérica'))).toBe(false);
  });
});
