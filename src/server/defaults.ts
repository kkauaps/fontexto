import type { CategoryRule } from '../core/categories.js';

/**
 * Example category rules (editable per project via the UI/API).
 * They only drive *suggested* categories and colors; they never create
 * bibliographic relations.
 */
export const DEFAULT_CATEGORY_RULES: CategoryRule[] = [];

/**
 * Optional sample rules for the categories editor. New projects start empty so
 * unrelated papers are not colored by keywords that make no sense for them.
 */
export const EXAMPLE_CATEGORY_RULES: CategoryRule[] = [
  {
    name: 'Climate records',
    color: '#2a9d8f',
    keywords: ['climate', 'temperature', 'warming', 'weather station', 'satellite', 'precipitation', 'anomaly'],
  },
  {
    name: 'Methods and models',
    color: '#3a7bd5',
    keywords: ['model', 'models', 'regression', 'machine learning', 'statistical', 'forecast', 'algorithm'],
  },
  {
    name: 'Metrics and evaluation',
    color: '#c2569b',
    keywords: ['metric', 'metrics', 'evaluation', 'validation', 'benchmark', 'uncertainty', 'error', 'reliability'],
  },
  {
    name: 'Data and quality control',
    color: '#e9a23b',
    keywords: ['dataset', 'database', 'quality control', 'metadata', 'homogenization', 'outlier', 'missing data'],
  },
  {
    name: 'Methods and reproducibility',
    color: '#8e6bbf',
    keywords: ['reproducibility', 'methodology', 'open data', 'research methods', 'protocol'],
  },
];
