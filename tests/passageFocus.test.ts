import { describe, expect, it } from 'vitest';
import { authorsFromMarker, bestPassageFocus, extractAcronyms, sentenceHasNumber } from '../src/core/passageFocus';

const chunk = [
  { text: 'The application is left to present the result to its user in text form.', page: 6 },
  { text: '2.1 IMAGE SET', page: 7 },
  { text: 'The set of images was composed of 393 photos collected in five tissue classes.', page: 7 },
  { text: 'Accuracy reached 0.76 without producing segmentation masks.', page: 7 },
];

describe('language-independent anchors', () => {
  it('treats 0,76 and 0.76 and 76% as the same number', () => {
    expect(sentenceHasNumber('accuracy of 0.76 on the test set', '0,76')).toBe(true);
    expect(sentenceHasNumber('the method reached 76% accuracy', '0,76')).toBe(true);
    expect(sentenceHasNumber('393 photographs were collected', '393')).toBe(true);
    expect(sentenceHasNumber('The application is left to present the result to its user in text form.', '393')).toBe(false);
  });

  it('folds acronyms and model names (CNN, U-Net, SAM2)', () => {
    expect(extractAcronyms('We train a U-Net and a CNN, plus SAM2.')).toEqual(expect.arrayContaining(['unet', 'cnn', 'sam2']));
    expect(extractAcronyms('o modelo UNet foi treinado')).toEqual(expect.arrayContaining(['unet']));
  });

  it('reads surnames out of ABNT, APA and narrative markers', () => {
    expect(authorsFromMarker('(Kang et al., 2026; Zhou et al., 2025)')).toEqual(['kang', 'zhou']);
    expect(authorsFromMarker('(ALBRECHT; MOREAU, 2018)')).toEqual(['albrecht', 'moreau']);
    expect(authorsFromMarker('Quintana et al. (2020)')).toEqual(['quintana']);
    expect(authorsFromMarker('[12]')).toEqual([]);
  });
});

describe('bestPassageFocus', () => {
  it('picks the sentence that holds the claim number, not the first sentence of the chunk, and marks it exact', () => {
    const f = bestPassageFocus(chunk, 'reuniram um acervo não publicado de 393 fotografias clínicas, com acurácia de 0,76')!;
    expect(f.exact).toBe(true);
    expect(f.page).toBe(7);
    expect(f.text).toMatch(/393 photos/);
  });

  it('picks a percentage sentence when that is the only anchor', () => {
    const f = bestPassageFocus(chunk, 'com acurácia de 0,76, sem produzir máscaras')!;
    expect(f.exact).toBe(true);
    expect(f.text).toMatch(/0\.76/);
  });

  it('picks the sentence that names the model (U-Net) across languages', () => {
    const sents = [
      { text: 'Introduction. Wound assessment is often visual.', page: 1 },
      { text: 'The U-Net architecture was trained on dermoscopic images.', page: 2 },
    ];
    const f = bestPassageFocus(sents, 'O modelo U-Net foi treinado em imagens dermatoscópicas.')!;
    expect(f.exact).toBe(true);
    expect(f.text).toMatch(/U-Net/);
    expect(f.page).toBe(2);
  });

  it('uses sentence-level semantic scores when there are no anchors', () => {
    const sents = [
      { text: 'The application is left to present the result to its user in text form.', page: 6 },
      { text: 'A single wound may exhibit several tissue types at once.', page: 7 },
    ];
    const sem = new Map([
      [sents[0].text, 0.22],
      [sents[1].text, 0.61],
    ]);
    const f = bestPassageFocus(sents, 'embora uma mesma ferida possa apresentar vários tecidos', { sentenceSem: sem })!;
    expect(f.exact).toBe(true);
    expect(f.text).toMatch(/several tissue types/);
  });

  it('does not pretend an exact sentence when there are no anchors and no semantic model', () => {
    const sents = [
      { text: 'The application is left to present the result to its user in text form.', page: 6 },
      { text: 'A single wound may exhibit several tissue types at once.', page: 7 },
    ];
    const f = bestPassageFocus(sents, 'embora uma mesma ferida possa apresentar vários tecidos')!;
    expect(f.exact).toBe(false);
    expect(f.index).toBe(0);
  });
});
