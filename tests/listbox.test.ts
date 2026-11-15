import { describe, expect, it } from 'vitest';
import { listboxTypeaheadIndex } from '../src/web/listbox';

describe('listboxTypeaheadIndex', () => {
  const labels = ['English', 'Español', 'Português', 'Русский'];

  it('finds the next option whose label starts with the typed prefix', () => {
    expect(listboxTypeaheadIndex(labels, 0, 'p')).toBe(2);
    expect(listboxTypeaheadIndex(labels, 2, 'e')).toBe(0);
  });

  it('wraps around the list', () => {
    expect(listboxTypeaheadIndex(labels, 3, 'e')).toBe(0);
  });

  it('ignores accents when matching', () => {
    expect(listboxTypeaheadIndex(labels, 0, 'espan')).toBe(1);
  });
});