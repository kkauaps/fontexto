import type { CategoryRule } from '../core/categories.js';

/**
 * Example category rules (editable per project via the UI/API).
 * They only drive *suggested* categories and colors; they never create
 * bibliographic relations.
 */
export const DEFAULT_CATEGORY_RULES: CategoryRule[] = [
  {
    name: 'Segmentação de feridas',
    color: '#d9485f',
    keywords: ['wound', 'wounds', 'ulcer', 'ulcers', 'ferida', 'feridas', 'úlcera', 'tissue segmentation', 'granulation', 'slough', 'burn', 'diabetic foot'],
  },
  {
    name: 'Redes neurais e arquiteturas',
    color: '#3a7bd5',
    keywords: ['neural network', 'neural networks', 'convolutional', 'transformer', 'transformers', 'u-net', 'unet', 'deep learning', 'encoder decoder', 'self supervised', 'segmentation model', 'architecture', 'architectures'],
  },
  {
    name: 'Métricas e avaliação',
    color: '#2a9d8f',
    keywords: ['metric', 'metrics', 'evaluation', 'validation', 'benchmark', 'agreement', 'dice', 'reliability'],
  },
  {
    name: 'Anotação de imagens',
    color: '#e9a23b',
    keywords: ['annotation', 'annotations', 'annotated', 'labeling', 'labelling', 'anotação', 'cvat', 'database', 'dataset'],
  },
  {
    name: 'Metodologia e reprodutibilidade',
    color: '#8e6bbf',
    keywords: ['reproducibility', 'leakage', 'methodology', 'metodologia', 'pesquisa', 'trabalho científico', 'research methods'],
  },
];
