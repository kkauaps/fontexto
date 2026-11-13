/**
 * Regression set for "só o documento": a paper in each citation style (ABNT, APA, Vancouver, IEEE) with the usual
 * PDF-extraction damage (entries over several lines, hanging indents, words hyphenated at line ends, DOIs/URLs in
 * <...>, accents, et al.). Every entry of the list must be read with author + year, and every in-text citation
 * must resolve to its entry. Synthetic data only.
 */
import { describe, expect, it } from 'vitest';
import { CoreStore, MemoryDriver } from '../src/core/coreStore';
import type { PdfText } from '../src/core/text';
import { pdfText } from './helpers/fixtures';

async function run(lines: string[][]) {
  const text: PdfText = pdfText(lines);
  const store = new CoreStore({ driver: new MemoryDriver(), extractText: async () => text });
  const p = (await store.createProject('t', 't')).id;
  await store.addFile(p, { data: new TextEncoder().encode('%PDF-1.4 synthetic'), originalName: 'paper.pdf', role: 'main' });
  const ex = await store.extractReferencesFromMain(p);
  const ev = await store.getEvidence(p);
  return { ex, ev };
}

const STYLES: Record<string, { lines: string[][]; refs: number; cites: number; years: number[] }> = {
  abnt: {
    refs: 5,
    cites: 6,
    years: [2015, 2021, 2020, 2019, 2022],
    lines: [
      [
        '1 INTRODUÇÃO',
        'A segmentação de feridas é lenta (RONNEBERGER; FISCHER; BROX, 2015). Modelos recentes ajudam (XIE et al.,',
        '2021). Segundo Ávila e Conceição (2020), a anotação é cara. A Organização Mundial da Saúde',
        'recomenda protocolos (OMS, 2019, p. 12). Outros autores concordam (SILVA, 2022; XIE et al., 2021).',
      ],
      [
        'REFERÊNCIAS',
        'ÁVILA, J.; CONCEIÇÃO, M. Anotação de imagens clínicas: custos e pro-',
        '  cessos. Revista Brasileira de Informática, v. 3, n. 2, p. 10-20, 2020.',
        'OMS. Relatório mundial sobre feridas crônicas. Genebra: OMS, 2019. Dis-',
        '  ponível em: <https://www.who.int/relatorio-feridas>. Acesso em: 10 jan. 2024.',
        'RONNEBERGER, O.; FISCHER, P.; BROX, T. U-Net: convolutional networks for',
        '  biomedical image segmentation. In: MICCAI. Cham: Springer, 2015. p. 234-241.',
        '  DOI: <https://doi.org/10.1007/978-3-319-24574-4_28>.',
        'SILVA, João Pedro da. Feridas e tecidos. São Paulo: Atlas, 2022.',
        'XIE, E. et al. SegFormer: simple and efficient design for semantic segmentation with',
        '  transformers. In: NeurIPS, 2021.',
      ],
    ],
  },
  apa: {
    refs: 4,
    cites: 5,
    years: [2015, 2021, 2017, 2020],
    lines: [
      [
        'Introduction',
        'Segmentation networks are standard (Ronneberger et al., 2015). Transformers followed (Xie et al., 2021; Litjens et al., 2017).',
        'According to García and Müller (2020), annotation is costly. See also Litjens et al. (2017).',
      ],
      [
        'References',
        'García, A., & Müller, B. (2020). Annotation costs in medical imag-',
        '  ing. Journal of Imaging, 6(2), 1–12. https://doi.org/10.3390/jimaging6020012',
        'Litjens, G., Kooi, T., Bejnordi, B. E., Setio, A. A. A., Ciompi, F., Ghafoorian, M., van der',
        '  Laak, J., van Ginneken, B., & Sánchez, C. I. (2017). A survey on deep learning in medical image',
        '  analysis. Medical Image Analysis, 42, 60–88. https://doi.org/10.1016/j.media.2017.07.005',
        'Ronneberger, O., Fischer, P., & Brox, T. (2015). U-Net: Convolutional networks for biomedical',
        '  image segmentation. In MICCAI (pp. 234–241). Springer.',
        'Xie, E., Wang, W., Yu, Z., Anandkumar, A., Alvarez, J. M., & Luo, P. (2021). SegFormer: Simple',
        '  and efficient design for semantic segmentation with transformers. NeurIPS, 34, 12077–12090.',
      ],
    ],
  },
  vancouver: {
    refs: 3,
    cites: 4,
    years: [2015, 2017, 2021],
    lines: [
      [
        'Introduction',
        'Segmentation networks are standard [1]. Surveys cover the field [2,3]. Transformers are recent [3].',
      ],
      [
        'References',
        '1. Ronneberger O, Fischer P, Brox T. U-Net: convolutional networks for biomedical image segmen-',
        '   tation. Lect Notes Comput Sci. 2015;9351:234-41.',
        '2. Litjens G, Kooi T, Bejnordi BE, et al. A survey on deep learning in medical image analysis.',
        '   Med Image Anal. 2017;42:60-88. doi:10.1016/j.media.2017.07.005',
        '3. Xie E, Wang W, Yu Z, Anandkumar A, Alvarez JM, Luo P. SegFormer: simple and efficient design',
        '   for semantic segmentation with transformers. Adv Neural Inf Process Syst. 2021;34:12077-90.',
      ],
    ],
  },
  ieee: {
    refs: 4,
    cites: 6,
    years: [2015, 2017, 2021, 2022],
    lines: [
      [
        'I. INTRODUCTION',
        'U-Net [1] is the usual baseline. Several surveys [2]–[4] review the area, and transformers [3], [4] are now common.',
      ],
      [
        'REFERENCES',
        '[1] O. Ronneberger, P. Fischer, and T. Brox, “U-Net: Convolutional networks for biomedical image',
        '    segmentation,” in Proc. MICCAI, 2015, pp. 234–241.',
        '[2] G. Litjens et al., “A survey on deep learning in medical image analysis,” Med. Image Anal.,',
        '    vol. 42, pp. 60–88, 2017.',
        '[3] E. Xie et al., “SegFormer: Simple and efficient design for semantic segmentation with trans-',
        '    formers,” in Proc. NeurIPS, 2021.',
        '[4] B. Cheng, I. Misra, A. G. Schwing, A. Kirillov, and R. Girdhar, “Masked-attention mask transformer',
        '    for universal image segmentation,” in Proc. CVPR, 2022, pp. 1290–1299.',
      ],
    ],
  },
};

describe('document-only extraction, per citation style', () => {
  for (const [style, s] of Object.entries(STYLES)) {
    it(`${style}: every entry read and every in-text citation resolved`, async () => {
      const { ex, ev } = await run(s.lines);
      expect(ex.references.length, 'entries').toBe(s.refs);
      expect(ex.usable, 'entries with author + year').toBe(s.refs);
      expect(ex.references.map((r) => r.year).sort()).toEqual([...s.years].sort());
      for (const r of ex.references) expect(r.title, r.text).toBeTruthy();
      expect(ev.summary.occurrences, 'citations found').toBe(s.cites);
      expect(ev.summary.resolved, 'citations resolved').toBe(s.cites);
    });
  }
  it('abnt: hyphenated words are joined and DOIs in <...> are read', async () => {
    const { ex } = await run(STYLES.abnt.lines);
    const avila = ex.references.find((r) => r.authors[0]?.family === 'Ávila');
    expect(avila?.title).toMatch(/custos e processos/);
    expect(ex.references.find((r) => r.authors[0]?.family === 'Ronneberger')?.doi).toBe('10.1007/978-3-319-24574-4_28');
  });
});
