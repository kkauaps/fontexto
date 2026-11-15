import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { edition } from '../api';
import { en, type Messages } from './en';
import { es } from './es';
import { ja } from './ja';
import { ptBR } from './pt-BR';
import { ru } from './ru';
import { zhCN } from './zh-CN';

export type Locale = 'en' | 'es' | 'ru' | 'pt-BR' | 'zh-CN' | 'ja';
export type { Messages };

export const LOCALES: Locale[] = ['en', 'es', 'ru', 'pt-BR', 'zh-CN', 'ja'];
export const DEFAULT_LOCALE: Locale = 'en';
export const LANG_STORAGE_KEY = 'fontexto:lang';

export const LOCALE_NATIVE: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  ru: 'Русский',
  'pt-BR': 'Português (Brasil)',
  'zh-CN': '简体中文',
  ja: '日本語',
};

export const messages: Record<Locale, Messages> = { en, es, ru, 'pt-BR': ptBR, 'zh-CN': zhCN, ja };

export const htmlLang: Record<Locale, string> = {
  en: 'en',
  es: 'es',
  ru: 'ru',
  'pt-BR': 'pt-BR',
  'zh-CN': 'zh-CN',
  ja: 'ja',
};
export const dateLocale: Record<Locale, string> = {
  en: 'en-US',
  es: 'es',
  ru: 'ru',
  'pt-BR': 'pt-BR',
  'zh-CN': 'zh-CN',
  ja: 'ja-JP',
};

const ALIASES: Record<string, Locale> = {
  en: 'en',
  'en-us': 'en',
  'en-gb': 'en',
  eng: 'en',
  es: 'es',
  'es-es': 'es',
  'es-mx': 'es',
  'es-ar': 'es',
  spa: 'es',
  ru: 'ru',
  'ru-ru': 'ru',
  rus: 'ru',
  pt: 'pt-BR',
  'pt-br': 'pt-BR',
  'pt-pt': 'pt-BR',
  por: 'pt-BR',
  zh: 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh-hans': 'zh-CN',
  'zh-sg': 'zh-CN',
  cmn: 'zh-CN',
  ja: 'ja',
  'ja-jp': 'ja',
  jpn: 'ja',
};

export function parseLocale(raw: string | null | undefined): Locale | undefined {
  if (!raw) return undefined;
  return ALIASES[raw.trim().toLowerCase()];
}

/** Home page of each language on the public site ("/" is English, the default). */
export const LOCALE_PATH: Record<Locale, string> = {
  en: '/',
  es: '/es/',
  ru: '/ru/',
  'pt-BR': '/pt-br/',
  'zh-CN': '/zh-cn/',
  ja: '/ja/',
};

/** Locale of a language-prefixed public page ("/es/", "/pt-br/faq/"), or undefined for English/unprefixed paths. */
export function localeFromPath(pathname: string): Locale | undefined {
  const m = /^\/(es|ru|pt-br|zh-cn|ja)(\/|$)/i.exec(pathname);
  return m ? parseLocale(m[1]) : undefined;
}

/** Link to a static page of the public site in a given language ("faq" -> "/es/faq/"). */
export function sitePath(locale: Locale, slug = ''): string {
  return LOCALE_PATH[locale] + (slug ? `${slug}/` : '');
}

export function detectLocale(
  search = typeof window === 'undefined' ? '' : window.location.search,
  pathname = typeof window === 'undefined' ? '/' : window.location.pathname,
): Locale {
  try {
    const fromQuery = parseLocale(new URLSearchParams(search).get('lang'));
    if (fromQuery) return fromQuery;
    const fromPath = localeFromPath(pathname);
    if (fromPath) return fromPath;
    if (typeof localStorage !== 'undefined') {
      const fromStore = parseLocale(localStorage.getItem(LANG_STORAGE_KEY));
      if (fromStore) return fromStore;
    }
  } catch {
    /* private mode or non-browser */
  }
  return DEFAULT_LOCALE;
}

export function persistLocale(locale: Locale): void {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
}

export function replaceSearch(patch: Record<string, string | null>): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === '') url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  const next = url.pathname + url.search + url.hash;
  if (next !== window.location.pathname + window.location.search + window.location.hash) {
    history.replaceState(null, '', next);
  }
}

export function applyDocumentMeta(locale: Locale, section?: string): void {
  if (typeof document === 'undefined') return;
  const t = messages[locale];
  document.documentElement.lang = htmlLang[locale];
  document.title = t.pageTitle(section);
  let meta = document.querySelector('meta[name="description"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'description');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', t.metaDescription);
}

export function formatDate(locale: Locale, iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(dateLocale[locale]);
}

export function formatDateTime(locale: Locale, iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(dateLocale[locale]);
}

export function privacyNote(t: Messages): string {
  return edition === 'web' ? t.privacyNoteWeb : t.privacyNote;
}

export function categoryLabel(t: Messages, name: string): string {
  if (name === 'Documento principal') return t.mainDocument;
  if (name === 'Sem categoria') return t.uncategorized;
  return name;
}

interface I18nValue {
  locale: Locale;
  t: Messages;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nValue>({ locale: DEFAULT_LOCALE, t: en, setLocale: () => undefined });

export function LocaleProvider({ children, initial }: { children: ReactNode; initial?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(() => initial ?? detectLocale());
  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    persistLocale(next);
    replaceSearch({ lang: next });
    applyDocumentMeta(next);
  }, []);
  useEffect(() => {
    applyDocumentMeta(locale);
  }, [locale]);
  const value = useMemo(() => ({ locale, t: messages[locale], setLocale }), [locale, setLocale]);
  return createElement(I18nContext.Provider, { value }, children);
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}

export { translateRuntime, evidenceStatusText, refStatusText, reasonText, methodLabel, verificationLabel, verificationHelp, identityReason, reviewActionLabel } from './runtime';