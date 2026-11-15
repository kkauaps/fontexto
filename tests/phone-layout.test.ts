import { describe, expect, it } from 'vitest';
import { isPhoneWidth, phoneFitScale } from '../src/web/fit';
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

  it('keeps the wide layout by default', () => {
    const pos = statusGridLayout(view);
    expect(pos.get('a')!.x).toBeGreaterThan(pos.get('doc')!.x + pos.get('doc')!.width);
  });
});
