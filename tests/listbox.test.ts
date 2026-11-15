import { describe, expect, it } from 'vitest';
import { listboxTypeaheadIndex, placeAnchoredDropdown } from '../src/web/listbox';

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

describe('placeAnchoredDropdown', () => {
  const viewport = { width: 390, height: 844 };
  const trigger = { top: 48, right: 378, bottom: 92, left: 140, width: 238, height: 44 };
  const panel = { width: 238, height: 260 };

  it('right-aligns the panel to the trigger and opens below when there is room', () => {
    const placed = placeAnchoredDropdown(trigger, viewport, panel);
    expect(placed.width).toBe(238);
    expect(placed.left).toBe(140);
    expect(placed.top).toBe(98);
    expect(placed.left + placed.width).toBe(trigger.right);
    expect(placed.top).toBe(trigger.bottom + 6);
    expect(placed.maxHeight).toBeGreaterThanOrEqual(panel.height);
  });

  it('clamps a wide panel inside the viewport instead of overflowing the right edge', () => {
    const placed = placeAnchoredDropdown(
      { top: 40, right: 386, bottom: 84, left: 300, width: 86, height: 44 },
      viewport,
      { width: 320, height: 200 },
    );
    expect(placed.left).toBeGreaterThanOrEqual(8);
    expect(placed.left + placed.width).toBeLessThanOrEqual(382);
    expect(placed.width).toBeLessThanOrEqual(374);
  });

  it('flips above the trigger when there is more room above than below', () => {
    const low = { top: 720, right: 378, bottom: 764, left: 140, width: 238, height: 44 };
    const placed = placeAnchoredDropdown(low, viewport, { width: 238, height: 260 });
    expect(placed.top).toBeLessThan(low.top);
    expect(placed.top + Math.min(260, placed.maxHeight)).toBeLessThanOrEqual(low.top - 6 + 0.01);
    expect(placed.maxHeight).toBeLessThanOrEqual(low.top - 6 - 8);
  });
});
