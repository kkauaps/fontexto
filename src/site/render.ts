/**
 * Pure renderers for the public site's indexable HTML: head tags (title, description, canonical, hreflang,
 * Open Graph, Twitter), JSON-LD structured data, the static content pages, sitemap.xml, robots.txt and the
 * per-page CSP rules for Cloudflare Pages `_headers`. No I/O here; scripts/build-site-pages.ts writes the files.
 */
import { createHash } from 'node:crypto';
import { contentSecurityPolicy } from '../server/securityHeaders';
import { SITE_LANGS, SITE_SLUGS, type SiteContent, type SiteLang, type SitePage, type SiteSlug } from './types';

export const SITE_ORIGIN = 'https://fontexto.com';
export const CONTENT_UPDATED = '2026-11-14';
export const OG_IMAGE = { path: '/og-image.png', width: 1200, height: 630 } as const;
export const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';

const PREFIX: Record<SiteLang, string> = { en: '', es: 'es/', ru: 'ru/', 'pt-BR': 'pt-br/', 'zh-CN': 'zh-cn/', ja: 'ja/' };
export const LANG_NATIVE: Record<SiteLang, string> = {
  en: 'English',
  es: 'Español',
  ru: 'Русский',
  'pt-BR': 'Português (Brasil)',
  'zh-CN': '简体中文',
  ja: '日本語',
};

/** "/", "/es/", "/pt-br/faq/" */
export const pathOf = (lang: SiteLang, slug?: SiteSlug | ''): string => `/${PREFIX[lang]}${slug ? `${slug}/` : ''}`;
export const urlOf = (lang: SiteLang, slug?: SiteSlug | ''): string => SITE_ORIGIN + pathOf(lang, slug);

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Escaped text with **bold** and [label](slug | https://url) marks. Emails become mailto links wrapped in Cloudflare <!--email_off--> markers so Email Obfuscation cannot rewrite them to "[email protected]". */
export function emailOff(href: string, label: string): string {
  return `<!--email_off--><a href="${href}">${label}</a><!--/email_off-->`;
}

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

export function inline(text: string, lang: SiteLang): string {
  let out = escapeHtml(text);
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]*)\)/g, (_m, label: string, target: string) => {
    if (/^https:\/\//.test(target)) return `<a href="${target}" rel="noopener">${label}</a>`;
    if (target !== '' && !(SITE_SLUGS as readonly string[]).includes(target)) throw new Error(`unknown site link target: ${target}`);
    return `<a href="${pathOf(lang, target as SiteSlug | '')}">${label}</a>`;
  });
  out = out.replace(EMAIL_RE, (addr) => emailOff(`mailto:${addr}`, addr));
  return out;
}

/** Plain text of a field with inline marks (for meta tags and structured data). */
export const plain = (text: string): string => text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

export interface HeadInput {
  lang: SiteLang;
  slug?: SiteSlug;
  title: string;
  description: string;
  ogImageAlt: string;
  ogLocale: string;
  allLocales: Record<SiteLang, string>;
}

/** <title>, description, canonical, hreflang alternates (+ x-default), Open Graph and Twitter card. */
export function headTags(h: HeadInput): string {
  const url = urlOf(h.lang, h.slug);
  const tags = [
    `<title>${escapeHtml(h.title)}</title>`,
    `<meta name="description" content="${escapeHtml(h.description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    ...SITE_LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${urlOf(l, h.slug)}" />`),
    `<link rel="alternate" hreflang="x-default" href="${urlOf('en', h.slug)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Fontexto" />`,
    `<meta property="og:title" content="${escapeHtml(h.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(h.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:locale" content="${h.ogLocale}" />`,
    ...SITE_LANGS.filter((l) => l !== h.lang).map((l) => `<meta property="og:locale:alternate" content="${h.allLocales[l]}" />`),
    `<meta property="og:image" content="${SITE_ORIGIN}${OG_IMAGE.path}" />`,
    `<meta property="og:image:type" content="image/png" />`,
    `<meta property="og:image:width" content="${OG_IMAGE.width}" />`,
    `<meta property="og:image:height" content="${OG_IMAGE.height}" />`,
    `<meta property="og:image:alt" content="${escapeHtml(h.ogImageAlt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(h.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(h.description)}" />`,
    `<meta name="twitter:image" content="${SITE_ORIGIN}${OG_IMAGE.path}" />`,
    `<meta name="twitter:image:alt" content="${escapeHtml(h.ogImageAlt)}" />`,
  ];
  return tags.map((t) => `    ${t}`).join('\n');
}

const ORG_ID = `${SITE_ORIGIN}/#organization`;
const WEBSITE_ID = `${SITE_ORIGIN}/#website`;
const APP_ID = `${SITE_ORIGIN}/#app`;
const PERSON_ID = `${SITE_ORIGIN}/#author`;

const AUTHOR = {
  '@type': 'Person',
  '@id': PERSON_ID,
  name: 'Pablo Kauã',
  alternateName: 'kkauaps',
  url: 'https://github.com/kkauaps',
  sameAs: ['https://github.com/kkauaps', 'https://x.com/kkauaps', 'https://www.threads.net/@kkauaps'],
} as const;

type Json = Record<string, unknown>;

function organization(): Json {
  // sameAs is omitted on the organization: public profiles belong to the author Person below.
  return {
    '@type': 'Organization',
    '@id': ORG_ID,
    name: 'Fontexto',
    url: `${SITE_ORIGIN}/`,
    logo: { '@type': 'ImageObject', url: `${SITE_ORIGIN}/icon-512.png` },
    email: 'oa@fontexto.com',
  };
}

function person(): Json {
  return { ...AUTHOR };
}

function website(): Json {
  return {
    '@type': 'WebSite',
    '@id': WEBSITE_ID,
    url: `${SITE_ORIGIN}/`,
    name: 'Fontexto',
    inLanguage: [...SITE_LANGS],
    publisher: { '@id': ORG_ID },
    author: { '@id': PERSON_ID },
    creator: { '@id': PERSON_ID },
  };
}

function application(lang: SiteLang, c: SiteContent): Json {
  return {
    '@type': 'WebApplication',
    '@id': APP_ID,
    name: 'Fontexto',
    url: urlOf(lang),
    description: c.chrome.appDescription,
    applicationCategory: 'EducationalApplication',
    operatingSystem: 'Web',
    browserRequirements: 'Requires JavaScript and a modern browser with WebAssembly.',
    inLanguage: [...SITE_LANGS],
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    license: LICENSE_URL,
    featureList: c.chrome.featureList,
    screenshot: `${SITE_ORIGIN}/preview-documento.png`,
    image: `${SITE_ORIGIN}${OG_IMAGE.path}`,
    publisher: { '@id': ORG_ID },
    author: { '@id': PERSON_ID },
    creator: { '@id': PERSON_ID },
  };
}

/** One @graph per page. Landing: Organization, WebSite, WebApplication, WebPage. Content pages: WebPage (FAQPage on the FAQ) + BreadcrumbList. */
export function structuredData(lang: SiteLang, c: SiteContent, slug?: SiteSlug, landing?: { title: string; description: string }): Json {
  const url = urlOf(lang, slug);
  if (!slug) {
    const meta = landing!;
    return {
      '@context': 'https://schema.org',
      '@graph': [
        organization(),
        person(),
        website(),
        application(lang, c),
        { '@type': 'WebPage', '@id': `${url}#webpage`, url, name: meta.title, description: meta.description, inLanguage: lang, isPartOf: { '@id': WEBSITE_ID }, about: { '@id': APP_ID }, primaryImageOfPage: { '@type': 'ImageObject', url: `${SITE_ORIGIN}${OG_IMAGE.path}` } },
      ],
    };
  }
  const page = c.pages[slug];
  const webPage: Json = {
    '@type': page.faq ? 'FAQPage' : slug === 'about' ? 'AboutPage' : 'WebPage',
    '@id': `${url}#webpage`,
    url,
    name: page.title,
    description: page.description,
    inLanguage: lang,
    dateModified: CONTENT_UPDATED,
    isPartOf: { '@type': 'WebSite', '@id': WEBSITE_ID, name: 'Fontexto', url: `${SITE_ORIGIN}/`, publisher: { '@id': ORG_ID }, author: { '@id': PERSON_ID }, creator: { '@id': PERSON_ID } },
    about: { '@type': 'WebApplication', '@id': APP_ID, name: 'Fontexto', author: { '@id': PERSON_ID }, creator: { '@id': PERSON_ID } },
    breadcrumb: { '@id': `${url}#breadcrumb` },
  };
  if (page.faq) {
    webPage.mainEntity = page.faq.map((f) => ({ '@type': 'Question', name: plain(f.q), acceptedAnswer: { '@type': 'Answer', text: plain(f.a) } }));
  }
  return {
    '@context': 'https://schema.org',
    '@graph': [
      person(),
      webPage,
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Fontexto', item: urlOf(lang) },
          { '@type': 'ListItem', position: 2, name: page.nav, item: url },
        ],
      },
    ],
  };
}

/** The <script type="application/ld+json"> element and the CSP hash of its exact text. */
export function ldScript(data: Json): { tag: string; hash: string } {
  // "<" is escaped so the JSON can never close the script element.
  const text = JSON.stringify(data).replace(/</g, '\\u003c');
  return { tag: `<script type="application/ld+json">${text}</script>`, hash: `sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}` };
}

export function allOgLocales(content: Record<SiteLang, SiteContent>): Record<SiteLang, string> {
  return Object.fromEntries(SITE_LANGS.map((l) => [l, content[l].chrome.ogLocale])) as Record<SiteLang, string>;
}

export interface Assets {
  /** The app stylesheet(s) from the Vite build, reused so the pages share the app's look. */
  css: string[];
  mark: string;
}

const iconLinks = `    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="icon" type="image/x-icon" href="/favicon.ico" />
    <link rel="apple-touch-icon" href="/icon-192.png" />
    <link rel="manifest" href="/site.webmanifest" />
    <meta name="theme-color" content="#ECEEF1" />`;

function brand(lang: SiteLang, assets: Assets): string {
  return `<a class="lp-brand sp-brand" href="${pathOf(lang)}"><span class="fx-mark-tile" aria-hidden="true"><img src="${assets.mark}" alt="" width="20" height="18" /></span><span class="wordmark">fontexto</span></a>`;
}

function langSwitch(lang: SiteLang, slug: SiteSlug | undefined, c: SiteContent): string {
  const items = SITE_LANGS.map((l) =>
    l === lang
      ? `<li><span aria-current="true">${LANG_NATIVE[l]}</span></li>`
      : `<li><a href="${pathOf(l, slug)}" hreflang="${l}" lang="${l}">${LANG_NATIVE[l]}</a></li>`,
  ).join('');
  return `<nav class="sp-langs" aria-label="${escapeHtml(c.chrome.languageLabel)}"><ul>${items}</ul></nav>`;
}

function footer(lang: SiteLang, slug: SiteSlug | undefined, c: SiteContent, assets: Assets): string {
  const links = SITE_SLUGS.map((s) => (s === slug ? `<li><span aria-current="page">${escapeHtml(c.pages[s].nav)}</span></li>` : `<li><a href="${pathOf(lang, s)}">${escapeHtml(c.pages[s].nav)}</a></li>`)).join('');
  return `<footer class="sp-footer">
      <div class="sp-footer-row">
        ${brand(lang, assets)}
        <nav aria-label="${escapeHtml(c.chrome.menuLabel)}"><ul class="sp-footer-links">${links}</ul></nav>
      </div>
      ${langSwitch(lang, slug, c)}
      <p class="sp-fine">${escapeHtml(c.chrome.footerNote)} ${escapeHtml(c.chrome.license)}</p>
    </footer>`;
}

function article(lang: SiteLang, page: SitePage, c: SiteContent): string {
  const parts: string[] = [];
  for (const s of page.sections) {
    parts.push(`<section class="sp-section"><h2>${inline(s.h2, lang)}</h2>`);
    if (s.ul) parts.push(`<ul>${s.ul.map((li) => `<li>${inline(li, lang)}</li>`).join('')}</ul>`);
    for (const p of s.p ?? []) parts.push(`<p>${inline(p, lang)}</p>`);
    parts.push('</section>');
  }
  if (page.faq) {
    parts.push('<div class="sp-faq">');
    for (const f of page.faq) parts.push(`<section class="sp-qa"><h2>${inline(f.q, lang)}</h2><p>${inline(f.a, lang)}</p></section>`);
    parts.push('</div>');
  }
  return parts.join('\n        ');
}

/** A complete static content page and the CSP hash of its JSON-LD. */
export function staticPage(lang: SiteLang, slug: SiteSlug, content: Record<SiteLang, SiteContent>, assets: Assets): { html: string; hashes: string[] } {
  const c = content[lang];
  const page = c.pages[slug];
  const title = /Fontexto/.test(page.title) ? page.title : `${page.title} · Fontexto`;
  const ld = ldScript(structuredData(lang, c, slug));
  const nav = (['how-it-works', 'faq', 'about'] as SiteSlug[])
    .map((s) => (s === slug ? `<a href="${pathOf(lang, s)}" aria-current="page">${escapeHtml(c.pages[s].nav)}</a>` : `<a href="${pathOf(lang, s)}">${escapeHtml(c.pages[s].nav)}</a>`))
    .join('');
  const date = new Date(`${CONTENT_UPDATED}T12:00:00Z`).toLocaleDateString(lang, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const html = `<!doctype html>
<html lang="${lang}" data-theme="light" data-accent="emerald">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="referrer" content="no-referrer" />
${headTags({ lang, slug, title, description: page.description, ogImageAlt: c.chrome.ogImageAlt, ogLocale: c.chrome.ogLocale, allLocales: allOgLocales(content) })}
${iconLinks}
${assets.css.map((href) => `    <link rel="stylesheet" href="${href}" />`).join('\n')}
    ${ld.tag}
  </head>
  <body class="sp">
    <a class="sp-skip" href="#main">${escapeHtml(c.chrome.skip)}</a>
    <div class="sp-page">
    <header class="sp-nav">
      ${brand(lang, assets)}
      <nav class="sp-menu" aria-label="${escapeHtml(c.chrome.menuLabel)}">${nav}</nav>
      <a class="lp-btn primary sp-cta" href="${pathOf(lang)}">${escapeHtml(c.chrome.openApp)}</a>
    </header>
    <main id="main" class="sp-main">
      <nav class="sp-crumbs" aria-label="${escapeHtml(c.chrome.breadcrumbLabel)}"><ol><li><a href="${pathOf(lang)}">Fontexto</a></li><li><span aria-current="page">${escapeHtml(page.nav)}</span></li></ol></nav>
      <article class="sp-article">
        <header class="sp-head">
          <h1>${inline(page.h1, lang)}</h1>
          <p class="sp-lead">${inline(page.lead, lang)}</p>
        </header>
        ${article(lang, page, c)}
        ${page.credit ? `<p class="sp-credit">${inline(page.credit, lang)}</p>` : ''}
        <p class="sp-updated">${escapeHtml(c.chrome.updated)}: <time datetime="${CONTENT_UPDATED}">${date}</time></p>
      </article>
      <aside class="sp-cta-card">
        <div>
          <h2>${escapeHtml(c.chrome.ctaTitle)}</h2>
          <p>${escapeHtml(c.chrome.ctaText)}</p>
        </div>
        <a class="lp-btn primary" href="${pathOf(lang)}">${escapeHtml(c.chrome.openApp)}</a>
      </aside>
    </main>
    ${footer(lang, slug, c, assets)}
    </div>
  </body>
</html>
`;
  return { html, hashes: [ld.hash] };
}

/**
 * The app shell (built index.html) turned into one language's home page: SEO head, JSON-LD and the
 * prerendered landing inside #root (the client replaces it on mount).
 */
export function landingPage(
  shell: string,
  lang: SiteLang,
  content: Record<SiteLang, SiteContent>,
  meta: { title: string; description: string },
  landingMarkup: string,
): { html: string; hashes: string[] } {
  const c = content[lang];
  const ld = ldScript(structuredData(lang, c, undefined, meta));
  let html = shell;
  const replaceOnce = (re: RegExp, to: string) => {
    if (!re.test(html)) throw new Error(`app shell: ${re} not found`);
    html = html.replace(re, () => to);
  };
  replaceOnce(/<html lang="[^"]*"/, `<html lang="${lang}"`);
  replaceOnce(/\s*<meta name="description"[^>]*>/, '');
  replaceOnce(
    /\s*<title>[^<]*<\/title>/,
    `\n${headTags({ lang, title: meta.title, description: meta.description, ogImageAlt: c.chrome.ogImageAlt, ogLocale: c.chrome.ogLocale, allLocales: allOgLocales(content) })}\n    ${ld.tag}`,
  );
  replaceOnce(/<div id="root">[\s\S]*?<\/div><\/div>/, `<div id="root">${landingMarkup}</div>`);
  return { html, hashes: [ld.hash] };
}

export function notFoundPage(content: Record<SiteLang, SiteContent>, assets: Assets): string {
  const c = content.en;
  const homes = SITE_LANGS.map((l) => `<li><a href="${pathOf(l)}" hreflang="${l}" lang="${l}">${LANG_NATIVE[l]}</a></li>`).join('');
  const pages = SITE_SLUGS.map((s) => `<li><a href="${pathOf('en', s)}">${escapeHtml(c.pages[s].nav)}</a></li>`).join('');
  return `<!doctype html>
<html lang="en" data-theme="light" data-accent="emerald">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="referrer" content="no-referrer" />
    <meta name="robots" content="noindex" />
    <title>Page not found · Fontexto</title>
${iconLinks}
${assets.css.map((href) => `    <link rel="stylesheet" href="${href}" />`).join('\n')}
  </head>
  <body class="sp">
    <div class="sp-page">
    <header class="sp-nav">${brand('en', assets)}<a class="lp-btn primary sp-cta" href="/">${escapeHtml(c.chrome.openApp)}</a></header>
    <main id="main" class="sp-main">
      <article class="sp-article">
        <header class="sp-head"><p class="lp-kicker">404</p><h1>Page not found</h1><p class="sp-lead">The page you asked for does not exist. These do:</p></header>
        <section class="sp-section"><h2>Fontexto</h2><ul>${homes}</ul></section>
        <section class="sp-section"><h2>More</h2><ul>${pages}</ul></section>
      </article>
    </main>
    </div>
  </body>
</html>
`;
}

/** Every indexable URL with its language alternates. */
export function siteUrls(): { lang: SiteLang; slug?: SiteSlug }[] {
  return SITE_LANGS.flatMap((lang) => [{ lang }, ...SITE_SLUGS.map((slug) => ({ lang, slug }))]);
}

export function sitemapXml(): string {
  const entries = siteUrls().map(({ lang, slug }) => {
    const alts = [...SITE_LANGS.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${urlOf(l, slug)}"/>`), `    <xhtml:link rel="alternate" hreflang="x-default" href="${urlOf('en', slug)}"/>`];
    return `  <url>\n    <loc>${urlOf(lang, slug)}</loc>\n    <lastmod>${CONTENT_UPDATED}</lastmod>\n${alts.join('\n')}\n  </url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join('\n')}\n</urlset>\n`;
}

export function robotsTxt(): string {
  return `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`;
}

/**
 * Extra `_headers` rules: each page's CSP replaces the global one ("! Content-Security-Policy" detaches the
 * header set by "/*") with the same policy plus the hash of that page's JSON-LD block.
 */
export function pageHeaderRules(hashesByPath: Map<string, string[]>): string {
  const lines: string[] = ['', '# Per-page CSP: the global policy plus the sha256 of the page’s inline JSON-LD (generated).'];
  for (const [p, hashes] of hashesByPath) {
    lines.push(p, '  ! Content-Security-Policy', `  Content-Security-Policy: ${contentSecurityPolicy({ https: true }, hashes)}`, '');
  }
  lines.push(
    '/sitemap.xml',
    '  Content-Type: application/xml; charset=utf-8',
    '',
    '/robots.txt',
    '  Content-Type: text/plain; charset=utf-8',
    '',
    '# The production *.pages.dev alias duplicates fontexto.com: keep it out of search results.',
    'https://:project.pages.dev/*',
    '  X-Robots-Tag: noindex',
    '',
  );
  return lines.join('\n');
}
