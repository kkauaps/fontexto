import { afterEach, describe, expect, it } from 'vitest';
import { EVIDENCE_METHOD } from '../src/core/evidence';
import { SEMANTIC_METHOD } from '../src/core/semantic';
import {
  DEFAULT_LOCALE,
  LOCALES,
  dateLocale,
  detectLocale,
  htmlLang,
  messages,
  parseLocale,
  persistLocale,
  translateRuntime,
  type Locale,
} from '../src/web/i18n';

const STORAGE = 'fontexto:lang';

function installMemoryStorage() {
  const store: Record<string, string> = {};
  const memory = {
    getItem: (key: string) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const key of Object.keys(store)) delete store[key];
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: memory, configurable: true });
}

installMemoryStorage();

afterEach(() => {
  try {
    localStorage.removeItem(STORAGE);
  } catch {
    /* ignore */
  }
});

describe('locale detection', () => {
  it('defaults to English and ignores the browser language', () => {
    expect(DEFAULT_LOCALE).toBe('en');
    expect(detectLocale('')).toBe('en');
    expect(detectLocale('?project=abc')).toBe('en');
  });

  it('honours ?lang= over a saved choice, and accepts aliases', () => {
    persistLocale('es');
    expect(detectLocale('?lang=ru')).toBe('ru');
    expect(detectLocale('?lang=pt')).toBe('pt-BR');
    expect(detectLocale('?lang=pt-br')).toBe('pt-BR');
    expect(detectLocale('?lang=en-US')).toBe('en');
    expect(detectLocale('?lang=es-MX')).toBe('es');
    expect(detectLocale('?foo=1&lang=ru')).toBe('ru');
  });

  it('honours a saved localStorage choice when the URL is silent', () => {
    persistLocale('pt-BR');
    expect(detectLocale('')).toBe('pt-BR');
    expect(detectLocale('?project=abc')).toBe('pt-BR');
  });

  it('ignores unknown language codes', () => {
    expect(parseLocale('fr')).toBeUndefined();
    expect(parseLocale('zh-TW')).toBeUndefined();
    expect(parseLocale('zh-HK')).toBeUndefined();
    expect(detectLocale('?lang=fr')).toBe('en');
  });

  it('maps Chinese and Japanese aliases', () => {
    expect(parseLocale('zh')).toBe('zh-CN');
    expect(parseLocale('zh-cn')).toBe('zh-CN');
    expect(parseLocale('zh-hans')).toBe('zh-CN');
    expect(parseLocale('ja')).toBe('ja');
    expect(parseLocale('ja-jp')).toBe('ja');
  });
});

describe('catalogs', () => {
  it('has six locales and matching html lang tags', () => {
    expect(LOCALES).toEqual(['en', 'es', 'ru', 'pt-BR', 'zh-CN', 'ja']);
    expect(htmlLang['zh-CN']).toBe('zh-CN');
    expect(htmlLang.ja).toBe('ja');
    expect(dateLocale['pt-BR']).toBe('pt-BR');
  });

  it('keeps the same message keys and function arities in every locale', () => {
    const keys = Object.keys(messages.en).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(messages[locale]).sort(), locale).toEqual(keys);
      for (const key of keys) {
        const enVal = (messages.en as Record<string, unknown>)[key];
        const val = (messages[locale] as Record<string, unknown>)[key];
        expect(typeof val, `${locale}.${key}`).toBe(typeof enVal);
        if (typeof enVal === 'function') {
          expect((val as (...a: unknown[]) => unknown).length, `${locale}.${key}`).toBe((enVal as (...a: unknown[]) => unknown).length);
        } else {
          expect(String(val).length, `${locale}.${key}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('uses distinct copy for the landing headline and keeps Fontexto in the boot line', () => {
    const headlines = LOCALES.map((l) => messages[l].tagline);
    expect(new Set(headlines).size).toBe(6);
    for (const locale of LOCALES) {
      expect(messages[locale].boot).toMatch(/Fontexto/);
      expect(messages[locale].ctaJustDoc.length).toBeGreaterThan(3);
    }
  });
});

describe('runtime translation', () => {
  const locales: Locale[] = ['en', 'es', 'ru', 'pt-BR', 'zh-CN', 'ja'];

  it('translates built-in method blurbs and exact notices in every language', () => {
    for (const locale of locales) {
      const t = messages[locale];
      expect(translateRuntime(t, EVIDENCE_METHOD)).toBe(t.evidenceMethod);
      expect(translateRuntime(t, SEMANTIC_METHOD)).toBe(t.semanticMethod);
      expect(translateRuntime(t, 'Destaque exato indisponível: abrindo apenas a página.')).toBe(t.localeExactHighlightUnavailable);
    }
  });

  it('fills in template notices (numbers, pages, file names)', () => {
    const t = messages.en;
    expect(translateRuntime(t, 'O número 393 da frase não aparece em nenhum lugar do PDF da fonte.')).toBe(
      'The number 393 from the sentence does not appear anywhere in the source PDF.',
    );
    expect(translateRuntime(t, 'Os números 0,76, 393 da frase não aparecem em nenhum lugar do PDF da fonte.')).toContain('0,76, 393');
    expect(translateRuntime(t, 'Citação direta encontrada literalmente na p. 12.')).toBe('Direct quotation found verbatim on p. 12.');
    expect(translateRuntime(t, 'O PDF "scan.pdf" não tem texto extraível (no_text).')).toBe('The PDF “scan.pdf” has no extractable text (no_text).');
    expect(translateRuntime(t, 'Text unavailable for "notes.pdf" (no_text).')).toBe('Text unavailable for “notes.pdf” (no_text).');
    expect(translateRuntime(t, 'Nenhum trecho parecido no PDF (melhor similaridade 12%, mínimo 30%).')).toBe(
      'No similar passage in the PDF (best similarity 12%, minimum 30%).',
    );
  });

  it('leaves unknown text unchanged', () => {
    expect(translateRuntime(messages.en, 'a completely unknown notice 123')).toBe('a completely unknown notice 123');
  });
});
