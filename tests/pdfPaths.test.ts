/** Regression: pdf.js factory URLs must end with "/" even for Windows paths. */
import path from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { toPdfJsFactoryUrl } from '../src/server/pdfPaths';
import { pathToFileURL } from 'node:url';
import { configurePdfJs, extractPdfText, resetPdfJsConfig } from '../src/server/pdfText';
import { flowText, makePdf } from '../src/server/devtools/syntheticPdf';

describe('toPdfJsFactoryUrl', () => {
  it('adds a forward-slash trailing separator to a Windows path without one', () => {
    const url = toPdfJsFactoryUrl('C:\\Users\\Public\\Fontexto\\resources\\pdfjs\\standard_fonts', path.win32);
    expect(url).toBe('C:/Users/Public/Fontexto/resources/pdfjs/standard_fonts/');
    expect(url.endsWith('/')).toBe(true);
  });

  it('converts a Windows path that ends with a backslash (what pdf.js rejected)', () => {
    const url = toPdfJsFactoryUrl('C:\\Users\\Public\\Fontexto\\resources\\pdfjs\\standard_fonts\\', path.win32);
    expect(url).toBe('C:/Users/Public/Fontexto/resources/pdfjs/standard_fonts/');
  });

  it('keeps POSIX paths valid and idempotent', () => {
    const once = toPdfJsFactoryUrl('/opt/ct/resources/pdfjs/wasm', path.posix);
    expect(once).toBe('/opt/ct/resources/pdfjs/wasm/');
    expect(toPdfJsFactoryUrl(once, path.posix)).toBe(once);
  });

  it('is accepted by the real pdf.js getDocument validation (backslash-style input)', async () => {
    const require = createRequire(import.meta.url);
    const pkgDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
    const fonts = path.join(pkgDir, 'standard_fonts');
    expect(existsSync(fonts)).toBe(true);
    // Simulate the Windows packaged value: native separators, trailing backslash.
    const backslashed = fonts.replace(/\//g, '\\') + '\\';
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    // The raw Windows-style value is what failed in the packaged exe:
    expect(() => pdfjs.getDocument({ data: new Uint8Array(0), standardFontDataUrl: backslashed } as never)).toThrow(/trailing slash/);
    // The normalised value passes validation (no throw; destroy the task).
    const task = pdfjs.getDocument({ data: new Uint8Array([0x25]), standardFontDataUrl: toPdfJsFactoryUrl(fonts) } as never);
    task.promise.catch(() => undefined);
    await task.destroy();
  });

  it('extractPdfText works with configured native paths with and without trailing separator', async () => {
    const require = createRequire(import.meta.url);
    const pkgDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
    const legacy = path.join(pkgDir, 'legacy', 'build');
    const fonts = path.join(pkgDir, 'standard_fonts');
    const wasm = path.join(pkgDir, 'wasm');
    const pdf = makePdf(flowText([{ text: 'Hello CitationTrace on Windows paths.' }]));
    try {
      for (const suffix of ['', path.sep]) {
        configurePdfJs({
          moduleUrl: pathToFileURL(path.join(legacy, 'pdf.mjs')).href,
          workerSrc: pathToFileURL(path.join(legacy, 'pdf.worker.mjs')).href,
          standardFontDataUrl: fonts + suffix,
          wasmUrl: wasm + suffix,
        });
        const text = await extractPdfText(pdf);
        expect(text.pages.length).toBe(1);
        expect(text.pages[0].lines.map((l) => l.text).join(' ')).toContain('Hello CitationTrace');
      }
    } finally {
      resetPdfJsConfig();
    }
  });
});
