import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

function rule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `missing ${selector} rule`).toBeGreaterThanOrEqual(0);
  const end = css.indexOf('}', start);
  return css.slice(start, end + 1);
}

describe('source PDF passage highlight', () => {
  it('stays a translucent accent so the cited text remains readable', async () => {
    const css = await readFile(new URL('../src/web/styles.css', import.meta.url), 'utf8');
    const hl = rule(css, '.hl');
    expect(hl).toMatch(/mix-blend-mode:\s*multiply/);
    expect(hl).not.toMatch(/mix-blend-mode:\s*normal/);
    expect(hl).toMatch(/color-mix\(in srgb,\s*var\(--accent\)\s+\d{2}%,\s*transparent\)/);
    const mix = hl.match(/var\(--accent\)\s+(\d+)%,\s*transparent/);
    expect(mix, 'highlight fill should mix the accent with transparent').toBeTruthy();
    const amount = Number(mix![1]);
    expect(amount).toBeGreaterThanOrEqual(25);
    expect(amount).toBeLessThanOrEqual(40);
    expect(hl).not.toMatch(/#ffe566/);
    expect(rule(css, '.page-wrap')).toMatch(/isolation:\s*isolate/);
  });
});
