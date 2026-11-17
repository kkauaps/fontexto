/**
 * Reference reading across languages and styles, and the failure modes found in the reference audit:
 * entries glued after a DOI, words broken by a line-end hyphen, GOST responsibility statements, organisations with
 * the year in parentheses, Chinese names in ABNT order, ABNT government bodies, compound surnames, DIN.
 * Fictional or public bibliographic data only.
 */
import { describe, expect, it } from 'vitest';
import { splitGluedEntries } from '../src/core/references';
import { joinBrokenWords, parseReferenceText } from '../src/core/refparse';

const CASES: [string, string, string, number, string][] = [
  ['pt abnt book', 'SILVA, João Carlos da. Metodologia da pesquisa científica. 3. ed. São Paulo: Atlas, 2019.', 'da Silva', 2019, 'Metodologia da pesquisa'],
  ['pt abnt thesis', 'OLIVEIRA, Maria Aparecida de. Segmentação de imagens médicas com aprendizado profundo. 2021. 120 f. Tese (Doutorado em Computação) – Universidade Federal de Minas Gerais, Belo Horizonte, 2021.', 'de Oliveira', 2021, 'Segmentação de imagens'],
  ['pt abnt government', 'BRASIL. Ministério da Saúde. Protocolo clínico de feridas crônicas. Brasília, 2020. Disponível em: https://www.gov.br/saude/feridas. Acesso em: 10 maio 2024.', 'BRASIL', 2020, 'Protocolo clínico'],
  ['pt abnt nested bodies', 'BRASIL. Ministério da Saúde. Secretaria de Atenção Primária. Manual de feridas. Brasília, 2021.', 'BRASIL', 2021, 'Manual de feridas'],
  ['pt abnt chapter', 'SOUZA, Ana. Avaliação de feridas. In: COSTA, Pedro (org.). Enfermagem clínica. Rio de Janeiro: Guanabara, 2018. p. 45-60.', 'Souza', 2018, 'Avaliação de feridas'],
  ['en apa', 'Ronneberger, O., Fischer, P., & Brox, T. (2015). U-Net: Convolutional networks for biomedical image segmentation. In Medical Image Computing and Computer-Assisted Intervention (pp. 234–241). Springer.', 'Ronneberger', 2015, 'U-Net'],
  ['en chicago', 'Smith, John A. 2017. "Wound Healing in Diabetic Patients." Journal of Clinical Care 45 (3): 210–25.', 'Smith', 2017, 'Wound Healing in Diabetic'],
  ['en ieee', '[7] K. He, X. Zhang, S. Ren, and J. Sun, "Deep residual learning for image recognition," in Proc. IEEE CVPR, 2016, pp. 770–778.', 'He', 2016, 'Deep residual learning'],
  ['es apa', 'García, M., y López, J. (2018). Evaluación de úlceras por presión en pacientes hospitalizados. Revista Española de Enfermería, 41(2), 100-115.', 'García', 2018, 'Evaluación de úlceras'],
  ['es compound surname, full given name', 'Martínez Rodríguez, Luis. (2020). Inteligencia artificial aplicada a la salud. Madrid: Ediciones Díaz de Santos.', 'Martínez Rodríguez', 2020, 'Inteligencia artificial'],
  ['it', 'Rossi, M., Bianchi, L. (2019). Segmentazione delle immagini mediche con reti neurali. Rivista Italiana di Informatica, 15(1), 22-35.', 'Rossi', 2019, 'Segmentazione delle immagini'],
  ['fr', 'Dupont, J. et Martin, C. (2016). L’apprentissage profond en imagerie médicale. Revue française d’informatique, 8(4), 55-70.', 'Dupont', 2016, 'L’apprentissage profond'],
  ['fr organisation (year)', "UNITED NATIONS CHILDREN'S FUND (2016), « Éducation: Harmoniser les règles du jeu », Situation des enfants dans le monde, p. 40-67.", "UNITED NATIONS CHILDREN'S FUND", 2016, 'Éducation: Harmoniser'],
  ['de din', 'Müller, Hans; Schmidt, Anna: Bildsegmentierung mit tiefen neuronalen Netzen. In: Informatik Spektrum 42 (2019), Nr. 3, S. 180–195.', 'Müller', 2019, 'Bildsegmentierung'],
  ['zh gb/t [J]', '张伟, 李娜, 王强. 基于深度学习的伤口图像分割方法[J]. 计算机学报, 2021, 44(5): 1021-1035.', '张伟', 2021, '基于深度学习的伤口图像分割方法'],
  ['zh gb/t [D]', '陈晨. 慢性伤口智能评估研究[D]. 上海: 复旦大学, 2020.', '陈晨', 2020, '慢性伤口智能评估研究'],
  ['zh in abnt order', '倪序南. 基于深度学习的智能语音识别技术探索. 电子通信与计算机科学, v. 7, n. 7, p. 209-211, 2025.', '倪序南', 2025, '基于深度学习的智能语音识别技术探索'],
  ['ja author-year', '山田太郎・鈴木花子 (2019). 深層学習による医用画像の領域分割. 情報処理学会論文誌, 60(3), 45-58.', '山田太郎', 2019, '深層学習による医用画像の領域分割'],
  ['ja SIST02', '佐藤一郎. 機械学習入門. 東京: オーム社, 2020, 250p.', '佐藤一郎', 2020, '機械学習入門'],
  ['ja quoted title', '田中健（2018）「創傷ケアにおける画像解析の応用」『看護研究』51(2), pp.10-20.', '田中健', 2018, '創傷ケアにおける画像解析の応用'],
  ['ko apa', '김철수, 이영희 (2019). 딥러닝 기반 의료 영상 분할 연구. 한국정보과학회논문지, 46(3), 245-256.', '김철수', 2019, '딥러닝 기반 의료 영상 분할 연구'],
  ['ru gost', 'Петров И. И., Сидоров П. П. Сегментация медицинских изображений нейронными сетями // Вестник компьютерных технологий. — 2020. — № 5. — С. 12–19.', 'Петров', 2020, 'Сегментация медицинских'],
  ['ru gost responsibility', 'Иванова А. С. Вымышленное исследование потоков / А. С. Иванова // Вестник синтетических наук. — 2018. — № 4. — С. 12–20.', 'Иванова', 2018, 'Вымышленное исследование потоков'],
];

describe('references in many languages and styles', () => {
  for (const [name, text, family, year, title] of CASES) {
    it(name, () => {
      const r = parseReferenceText(text);
      expect(r.authors[0]?.family).toBe(family);
      expect(r.year).toBe(year);
      expect(r.title?.startsWith(title), r.title).toBe(true);
    });
  }
  it('GOST title stops before the statement of responsibility', () => {
    expect(parseReferenceText(CASES.at(-1)![1]).title).toBe('Вымышленное исследование потоков');
  });
});

describe('words broken by a line-end hyphen', () => {
  it('joins a capitalised fragment with its lower-case rest, and leaves suspended hyphens alone', () => {
    expect(joinBrokenWords('Shel- drick, G. M. (2008)')).toBe('Sheldrick, G. M. (2008)');
    expect(joinBrokenWords('Subr- amanian, A.')).toBe('Subramanian, A.');
    expect(joinBrokenWords('cuidados pré- e pós-operatórios')).toBe('cuidados pré- e pós-operatórios');
    expect(parseReferenceText('Shel- drick, G. M. (2008). A short history of SHELX. Acta Cryst A, 64(1), 112–122.').authors[0]?.family).toBe('Sheldrick');
  });
});

describe('entries glued together after a DOI', () => {
  it('splits them so the second reference is read, matched and looked up', () => {
    const glued =
      'RINGLE, C. M.; DA SILVA, D.; BIDO, D. D. S. Modelagem de Equações Estruturais. Revista Brasileira de Marketing, v. 13, n. 2, p. 56-73, 2014. DOI: 10.5585/remark.v13i2.2717. SILVEIRA, Z. Setor educacional do MERCOSUL. Avaliação, v. 21, n. 3, p. 901-927, 2016. DOI: 10.1590/s1414-40772016000300012.';
    const parts = splitGluedEntries(glued);
    expect(parts).toHaveLength(2);
    expect(parseReferenceText(parts[1]).doi).toBe('10.1590/s1414-40772016000300012');
    const apa =
      'Ryan, R. M., & Deci, E. L. (2000). Self-determination theory. American Psychologist, 55(1), 68–78. https://doi.org/10.1037/0003-066x.55.1.68 Schneider, C. A., Rasband, W. S., & Eliceiri, K. W. (2012). NIH Image to ImageJ: 25 years of image analysis. Nature Methods, 9(7), 671–675. https://doi.org/10.1038/nmeth.2089';
    expect(splitGluedEntries(apa).map((p) => parseReferenceText(p).authors[0]?.family)).toEqual(['Ryan', 'Schneider']);
  });
  it('does not split on what usually follows a DOI inside one entry', () => {
    for (const t of [
      'SILVA, J. Título. Revista, 2020. DOI: 10.1234/abc.5. Disponível em: https://x.org. Acesso em: 3 mar. 2021.',
      'SMITH, J. Title. J Ex. 2019. doi:10.1000/xyz123. PMID: 31234567.',
      'Doe J. A study. Nature. 2020;1:2. https://doi.org/10.1038/x1 Epub 2020 Jan 5.',
    ])
      expect(splitGluedEntries(t)).toHaveLength(1);
  });
});
