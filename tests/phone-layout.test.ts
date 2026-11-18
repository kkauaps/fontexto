import { describe, expect, it } from 'vitest';
import { isPhoneWidth, phoneFitScale, phoneViewport } from '../src/web/fit';
import { statusGridLayout } from '../src/web/layout';
import type { ViewGraph, ViewNode } from '../src/core/view';

describe('phone fit scale', () => {
  it('fills the width of a phone and leaves wider screens alone', () => {
    expect(phoneFitScale(612, 390, 390)).toBeCloseTo((390 - 16) / 612, 2);
    expect(phoneFitScale(612, undefined, 360)).toBeCloseTo((360 - 16) / 612, 2);
    expect(phoneFitScale(612, 1200, 1440)).toBeUndefined();
    expect(phoneFitScale(0, 390, 390)).toBeUndefined();
  });
  it('uses the shared 760px breakpoint', () => {
    expect(isPhoneWidth(760)).toBe(true);
    expect(isPhoneWidth(761)).toBe(false);
  });
});

describe('mobile chrome CSS contracts', () => {
  it('documents the phone-first viewer classes', async () => {
    const css = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../src/web/styles.css', import.meta.url), 'utf8'));
    expect(css).toContain('.docview-phone');
    expect(css).toContain('.viewer-embedded');
    expect(css).toContain('.bottom-sheet');
    expect(css).toContain('--glass-panel');
  });
});

describe('narrow star layout', () => {
  const node = (id: string, kind: ViewNode['kind'], refStatus?: ViewNode['refStatus']) =>
    ({ id, kind, label: id, inDegree: 1, refStatus }) as unknown as ViewNode;
  const view = {
    nodes: [node('doc', 'document'), ...['a', 'b', 'c', 'd'].map((id) => node(id, 'publication', 'ok'))],
    edges: [],
  } as unknown as ViewGraph;

  it('puts the document above its sources on phones', () => {
    const pos = statusGridLayout(view, { narrow: true });
    const doc = pos.get('doc')!;
    for (const id of ['a', 'b', 'c', 'd']) expect(pos.get(id)!.y).toBeGreaterThan(doc.y + doc.height);
    const xs = new Set(['a', 'b', 'c', 'd'].map((id) => Math.round(pos.get(id)!.x + pos.get(id)!.width / 2)));
    expect(xs.size).toBe(1);
  });

  it('wide layout: the document above its status groups, the most cited first within a group', () => {
    const pos = statusGridLayout(view, { weights: new Map([['c', 9]]) });
    const doc = pos.get('doc')!;
    for (const id of ['a', 'b', 'c', 'd']) expect(pos.get(id)!.y).toBeGreaterThan(doc.y + doc.height);
    expect(pos.get('c')!.y).toBeLessThan(pos.get('a')!.y);
  });

  it('one header per status group, above its references', async () => {
    const { statusGroupHeaders } = await import('../src/web/layout');
    const pos = statusGridLayout(view);
    const [h] = statusGroupHeaders(view, pos);
    expect(h).toMatchObject({ status: 'ok', count: 4 });
    expect(h.y).toBeLessThan(Math.min(...['a', 'b', 'c', 'd'].map((id) => pos.get(id)!.y)));
  });
});

describe('phone diagram framing', () => {
  it('a small diagram fits between the controls and the legend', () => {
    const v = phoneViewport({ x: 0, y: 0, width: 300, height: 400 }, 393, 700);
    expect(v.y).toBeGreaterThanOrEqual(116);
    expect(v.y + 400 * v.zoom).toBeLessThanOrEqual(700 - 84);
    expect(v.x).toBeGreaterThanOrEqual(12);
  });
  it('a tall diagram (dozens of references) keeps readable labels, top-aligned under the controls', () => {
    const v = phoneViewport({ x: 0, y: 0, width: 600, height: 2600 }, 393, 700);
    expect(v.zoom).toBeCloseTo(0.6, 2);
    expect(v.y).toBe(116);
  });
  it('never wider than the screen', () => {
    const v = phoneViewport({ x: 0, y: 0, width: 1800, height: 3000 }, 393, 700);
    expect(1800 * v.zoom).toBeLessThanOrEqual(393 - 24 + 0.01);
  });
});
