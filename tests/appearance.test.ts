import { afterEach, describe, expect, it } from 'vitest';
import {
  APPEARANCE_STORAGE_KEY,
  detectAppearance,
  fallbackTheme,
  parseAccent,
  parseTheme,
  persistAppearance,
} from '../src/web/appearance';

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

function stubMatchMedia(flags: { colorScheme?: 'light' | 'dark'; reduceTransparency?: boolean }) {
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches:
        (flags.colorScheme === 'light' && query.includes('prefers-color-scheme: light')) ||
        (flags.colorScheme === 'dark' && query.includes('prefers-color-scheme: dark')) ||
        (Boolean(flags.reduceTransparency) && query.includes('prefers-reduced-transparency: reduce')),
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      },
      onchange: null,
    }),
  });
}

installMemoryStorage();

afterEach(() => {
  try {
    localStorage.removeItem(APPEARANCE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
});

describe('appearance', () => {
  it('parses the three themes and aliases', () => {
    expect(parseTheme('glass')).toBe('glass');
    expect(parseTheme('dark-solid')).toBe('dark-solid');
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('dark_solid')).toBe('dark-solid');
    expect(parseTheme('nope')).toBeUndefined();
    expect(parseAccent('emerald')).toBe('emerald');
    expect(parseAccent('pink')).toBeUndefined();
  });

  it('defaults to light for new visitors, whatever the system scheme or transparency setting', () => {
    for (const flags of [{ colorScheme: 'dark' }, { colorScheme: 'light' }, { colorScheme: 'dark', reduceTransparency: true }] as const) {
      stubMatchMedia(flags);
      expect(fallbackTheme()).toBe('light');
      expect(detectAppearance()).toEqual({ theme: 'light', accent: 'emerald' });
    }
  });

  it('honours a saved choice, but not glass when transparency is reduced', () => {
    stubMatchMedia({ colorScheme: 'light', reduceTransparency: false });
    persistAppearance({ theme: 'dark-solid', accent: 'emerald' });
    expect(detectAppearance()).toEqual({ theme: 'dark-solid', accent: 'emerald' });
    persistAppearance({ theme: 'glass', accent: 'emerald' });
    stubMatchMedia({ colorScheme: 'dark', reduceTransparency: true });
    expect(detectAppearance().theme).toBe('dark-solid');
  });
});
