/** Shape of the static public pages (about, how it works, FAQ, privacy, open-access sources) in each language. */
export const SITE_LANGS = ['en', 'es', 'ru', 'pt-BR', 'zh-CN', 'ja'] as const;
export type SiteLang = (typeof SITE_LANGS)[number];

export const SITE_SLUGS = ['how-it-works', 'faq', 'about', 'privacy', 'open-access-sources'] as const;
export type SiteSlug = (typeof SITE_SLUGS)[number];

/**
 * Text fields accept two inline marks, everything else is escaped:
 *   **bold**  and  [label](target)  where target is a site slug ("faq", "" for the home page) or an https:// URL.
 */
export interface Section {
  h2: string;
  p?: string[];
  ul?: string[];
}

export interface FaqItem {
  q: string;
  a: string;
}

export interface SitePage {
  /** <title> (without the " · Fontexto" suffix, which the renderer adds). */
  title: string;
  /** Meta description, ~150 characters. */
  description: string;
  h1: string;
  lead: string;
  sections: Section[];
  /** Visible questions and answers; only the FAQ page has them (and only it gets FAQPage structured data). */
  faq?: FaqItem[];
  /** Short name in breadcrumbs and menus. */
  nav: string;
  /** Optional discreet credit line at the end of the article (About only). Supports [label](https://url). */
  credit?: string;
}

export interface SiteChrome {
  skip: string;
  menuLabel: string;
  languageLabel: string;
  breadcrumbLabel: string;
  openApp: string;
  ctaTitle: string;
  ctaText: string;
  footerNote: string;
  license: string;
  updated: string;
  /** Open Graph locale (en_US, es_ES, ru_RU, pt_BR). */
  ogLocale: string;
  /** One-paragraph description of the app for structured data. */
  appDescription: string;
  featureList: string[];
  ogImageAlt: string;
  /** Local names of the documents people check, e.g. “TFG, TFM, tesis” (es) or “курсовая, ВКР” (ru). */
  documentTypes: string;
  /** Who uses it, in local academic terms (schema.org EducationalAudience roles). */
  audience: string[];
  /** Search terms people use in this language. */
  keywords: string[];
}

export interface SiteContent {
  chrome: SiteChrome;
  pages: Record<SiteSlug, SitePage>;
}
