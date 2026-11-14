import { createContext, createElement, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type Theme = 'glass' | 'dark-solid' | 'light';
export type Accent = 'emerald' | 'teal' | 'amber' | 'blue' | 'violet';
export type Appearance = { theme: Theme; accent: Accent };

export const THEMES: Theme[] = ['glass', 'dark-solid', 'light'];
export const ACCENTS: Accent[] = ['emerald', 'teal', 'amber', 'blue', 'violet'];
export const DEFAULT_ACCENT: Accent = 'emerald';
export const APPEARANCE_STORAGE_KEY = 'fontexto.appearance';

export function parseTheme(raw: string | null | undefined): Theme | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === 'glass' || v === 'dark-solid' || v === 'light') return v;
  if (v === 'darksolid' || v === 'dark_solid' || v === 'solid') return 'dark-solid';
  return undefined;
}

export function parseAccent(raw: string | null | undefined): Accent | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase();
  return (ACCENTS as string[]).includes(v) ? (v as Accent) : undefined;
}

function mediaPrefers(query: string): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia(query).matches;
  } catch {
    return false;
  }
}

/** Theme used when the user has not saved a choice. */
export function fallbackTheme(): Theme {
  const reduce = mediaPrefers('(prefers-reduced-transparency: reduce)');
  const light = mediaPrefers('(prefers-color-scheme: light)');
  if (reduce) return light ? 'light' : 'dark-solid';
  return light ? 'light' : 'glass';
}

export function detectAppearance(): Appearance {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(APPEARANCE_STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as { theme?: unknown; accent?: unknown };
      const theme = parseTheme(typeof parsed.theme === 'string' ? parsed.theme : undefined);
      const accent = parseAccent(typeof parsed.accent === 'string' ? parsed.accent : undefined) ?? DEFAULT_ACCENT;
      if (theme) {
        const reduce = mediaPrefers('(prefers-reduced-transparency: reduce)');
        if (reduce && theme === 'glass') {
          const light = mediaPrefers('(prefers-color-scheme: light)');
          return { theme: light ? 'light' : 'dark-solid', accent };
        }
        return { theme, accent };
      }
    }
  } catch {
    /* private mode or bad JSON */
  }
  return { theme: fallbackTheme(), accent: DEFAULT_ACCENT };
}

export function persistAppearance(appearance: Appearance): void {
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(appearance));
  } catch {
    /* ignore */
  }
}

export function applyAppearance(appearance: Appearance): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-theme', appearance.theme);
  root.setAttribute('data-accent', appearance.accent);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const color = appearance.theme === 'light' ? '#ECEEF1' : appearance.theme === 'dark-solid' ? '#121417' : '#10141C';
    meta.setAttribute('content', color);
  }
}

const AppearanceContext = createContext<{
  appearance: Appearance;
  setTheme: (theme: Theme) => void;
  setAccent: (accent: Accent) => void;
} | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>(() => {
    const initial = detectAppearance();
    applyAppearance(initial);
    return initial;
  });

  const setTheme = useCallback((theme: Theme) => {
    setAppearance((prev) => {
      const next = { ...prev, theme };
      persistAppearance(next);
      applyAppearance(next);
      return next;
    });
  }, []);

  const setAccent = useCallback((accent: Accent) => {
    setAppearance((prev) => {
      const next = { ...prev, accent };
      persistAppearance(next);
      applyAppearance(next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ appearance, setTheme, setAccent }), [appearance, setTheme, setAccent]);
  return createElement(AppearanceContext.Provider, { value }, children);
}

export function useAppearance() {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error('useAppearance must be used within AppearanceProvider');
  return ctx;
}
