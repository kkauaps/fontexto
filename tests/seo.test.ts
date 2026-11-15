import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { siteContent } from '../src/site/content/index';
import { headTags, inline, landingPage, ldScript, pageHeaderRules, pathOf, robotsTxt, siteUrls, sitemapXml, staticPage, structuredData, urlOf } from '../src/site/render';
import { SITE_LANGS, SITE_SLUGS } from '../src/site/types';
import { detectLocale, localeFromPath, sitePath } from '../src/web/i18n';

const assets = { css: ['/assets/index-test.css'], mark: '/fontexto-mark.svg' };
const ldOf = (html: string) => {
  const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
  expect(m, 'JSON-LD block').toBeTruthy();
  return { text: m![1], data: JSON.parse(m![1]) };
};
const graphTypes = (d: { '@graph': { '@type': string }[] }) => d['@graph'].map((n) => n['@type']);

describe('public site URLs', () => {
  it('has a home and five content pages in each locale', () => {
    expect(siteUrls()).toHaveLength(36);
    expect(pathOf('en')).toBe('/');
    expect(pathOf('pt-BR', 'faq')).toBe('/pt-br/faq/');
    expect(urlOf('ru', 'about')).toBe('https://fontexto.com/ru/about/');
  });
  it('the app picks the language from the page path, after an explicit ?lang', () => {
    expect(localeFromPath('/es/')).toBe('es');
    expect(localeFromPath('/pt-br/faq/')).toBe('pt-BR');
    expect(localeFromPath('/')).toBeUndefined();
    expect(localeFromPath('/estonia')).toBeUndefined();
    expect(detectLocale('', '/ru/')).toBe('ru');
    expect(detectLocale('?lang=es', '/ru/')).toBe('es');
    expect(sitePath('pt-BR', 'privacy')).toBe('/pt-br/privacy/');
  });
});

describe('head tags', () => {
  const head = headTags({
    lang: 'es',
    slug: 'faq',
    title: 'T',
    description: 'D',
    ogImageAlt: 'A',
    ogLocale: 'es_ES',
    allLocales: { en: 'en_US', es: 'es_ES', ru: 'ru_RU', 'pt-BR': 'pt_BR', 'zh-CN': 'zh_CN', ja: 'ja_JP' },
  });
  it('self-canonical, hreflang for every language plus x-default', () => {
    expect(head).toContain('<link rel="canonical" href="https://fontexto.com/es/faq/" />');
    for (const [l, u] of [['en', '/faq/'], ['es', '/es/faq/'], ['ru', '/ru/faq/'], ['pt-BR', '/pt-br/faq/'], ['x-default', '/faq/']]) {
      expect(head).toContain(`hreflang="${l}" href="https://fontexto.com${u}"`);
    }
  });
  it('Open Graph and Twitter card with the 1200x630 image', () => {
    for (const s of ['og:title', 'og:description', 'og:url', 'og:locale" content="es_ES"', 'og:image" content="https://fontexto.com/og-image.png"', 'og:image:width" content="1200"', 'og:image:height" content="630"', 'twitter:card" content="summary_large_image"']) expect(head).toContain(s);
  });
  it('never asks search engines to skip a public page', () => {
    for (const lang of SITE_LANGS) for (const slug of SITE_SLUGS) expect(staticPage(lang, slug, siteContent, assets).html).not.toMatch(/noindex/);
  });
});

describe('structured data', () => {
  const person = {
    '@type': 'Person',
    '@id': 'https://fontexto.com/#author',
    name: 'Pablo Kauã',
    alternateName: 'kkauaps',
    url: 'https://github.com/kkauaps',
    sameAs: ['https://github.com/kkauaps', 'https://x.com/kkauaps', 'https://www.threads.net/@kkauaps'],
  };
  const authorRef = { author: { '@id': 'https://fontexto.com/#author' }, creator: { '@id': 'https://fontexto.com/#author' } };

  it('home: Organization, author Person, WebSite, a free EducationalApplication under the AGPL, WebPage', () => {
    const d = structuredData('en', siteContent.en, undefined, { title: 'T', description: 'D' }) as { '@graph': Record<string, unknown>[] };
    expect(graphTypes(d as never)).toEqual(['Organization', 'Person', 'WebSite', 'WebApplication', 'WebPage']);
    const [org, who, site, app] = d['@graph'];
    expect(app).toMatchObject({ applicationCategory: 'EducationalApplication', operatingSystem: 'Web', offers: { '@type': 'Offer', price: '0' }, license: 'https://www.gnu.org/licenses/agpl-3.0.html' });
    expect(org).not.toHaveProperty('sameAs');
    expect(org).toMatchObject({ '@type': 'Organization', name: 'Fontexto' });
    expect(who).toEqual(person);
    expect(site).toMatchObject({ '@type': 'WebSite', publisher: { '@id': 'https://fontexto.com/#organization' }, ...authorRef });
    expect(app).toMatchObject({ publisher: { '@id': 'https://fontexto.com/#organization' }, ...authorRef });
  });

  it('author Person is valid JSON-LD on the home page and on every content page', () => {
    const home = structuredData('en', siteContent.en, undefined, { title: 'T', description: 'D' });
    const parsed = JSON.parse(ldScript(home).tag.replace(/^<script type="application\/ld\+json">/, '').replace(/<\/script>$/, ''));
    expect(parsed['@graph'].find((n: { '@type': string }) => n['@type'] === 'Person')).toEqual(person);
    for (const lang of SITE_LANGS) {
      for (const slug of SITE_SLUGS) {
        const { html } = staticPage(lang, slug, siteContent, assets);
        const data = ldOf(html).data as { '@graph': Record<string, unknown>[] };
        expect(data['@graph'].find((n) => n['@type'] === 'Person')).toEqual(person);
        const page = data['@graph'].find((n) => n['@type'] === 'WebPage' || n['@type'] === 'AboutPage' || n['@type'] === 'FAQPage') as Record<string, Record<string, unknown>>;
        expect(page.isPartOf).toMatchObject(authorRef);
        expect(page.about).toMatchObject(authorRef);
      }
    }
  });
  it('FAQPage only on the FAQ, with exactly the visible questions', () => {
    for (const lang of SITE_LANGS) {
      for (const slug of SITE_SLUGS) {
        const { html } = staticPage(lang, slug, siteContent, assets);
        const types = graphTypes(ldOf(html).data);
        expect(types.includes('FAQPage'), `${lang} ${slug}`).toBe(slug === 'faq');
        expect(types).toContain('BreadcrumbList');
      }
      const faq = staticPage(lang, 'faq', siteContent, assets).html;
      const faqPage = ldOf(faq).data['@graph'].find((n: { '@type': string }) => n['@type'] === 'FAQPage');
      const questions = faqPage.mainEntity as { name: string }[];
      expect(questions.length).toBe(siteContent[lang].pages.faq.faq!.length);
      for (const q of questions) expect(faq).toContain(`<h2>${q.name.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}</h2>`);
    }
  });
  it('the JSON cannot close its script element', () => {
    expect(ldScript({ x: '</script><script>alert(1)</script>' }).tag).not.toMatch(/<\/script><script>/);
  });
});


describe('email addresses', () => {
  it('wraps contact emails in mailto links and Cloudflare email_off markers', () => {
    for (const lang of SITE_LANGS) {
      const { html } = staticPage(lang, 'about', siteContent, assets);
      expect(html).toContain('<!--email_off--><a href="mailto:oa@fontexto.com">oa@fontexto.com</a><!--/email_off-->');
      expect(html).toContain('<!--email_off--><a href="mailto:contact@xoryn.com.br">contact@xoryn.com.br</a><!--/email_off-->');
      expect(html).not.toContain('[email');
    }
    const faq = staticPage('en', 'faq', siteContent, assets).html;
    expect(faq).toContain('mailto:contact@xoryn.com.br');
  });
});

describe('CSP for the inline JSON-LD', () => {
  it('each page ships the sha256 of its exact JSON-LD text, and _headers allows exactly that hash on that path', () => {
    const { html, hashes } = staticPage('ru', 'privacy', siteContent, assets);
    const expected = `sha256-${createHash('sha256').update(ldOf(html).text, 'utf8').digest('base64')}`;
    expect(hashes).toEqual([expected]);
    const rules = pageHeaderRules(new Map([['/ru/privacy/', hashes]]));
    expect(rules).toContain('/ru/privacy/\n  ! Content-Security-Policy\n');
    expect(rules).toContain(`script-src 'self' 'wasm-unsafe-eval' '${expected}'`);
    expect(rules).not.toMatch(/unsafe-inline/);
  });
});

describe('landing pages from the app shell', () => {
  const shell = '<!doctype html>\n<html lang="en" data-theme="light">\n  <head>\n    <meta name="description" content="old" />\n    <title>old</title>\n  </head>\n  <body>\n    <div id="root"><div class="boot" role="status"><img src="/favicon.svg" alt="" /><p>Loading</p></div></div>\n    <script type="module" src="/assets/index.js"></script>\n  </body>\n</html>';
  it('puts the SEO head, JSON-LD and the prerendered landing into the shell', () => {
    const { html } = landingPage(shell, 'pt-BR', siteContent, { title: 'Título', description: 'Descrição' }, '<div class="landing">conteúdo</div>');
    expect(html).toContain('<html lang="pt-BR"');
    expect(html).toContain('<title>Título</title>');
    expect(html).not.toContain('content="old"');
    expect(html).toContain('<link rel="canonical" href="https://fontexto.com/pt-br/" />');
    expect(html).toContain('<div id="root"><div class="landing">conteúdo</div></div>');
    expect(html).toContain('<script type="module" src="/assets/index.js"></script>');
    expect(graphTypes(ldOf(html).data)).toContain('WebApplication');
  });
});

describe('sitemap and robots', () => {
  const xml = sitemapXml();
  it('lists all public pages with hreflang alternates', () => {
    expect(xml.match(/<loc>/g)).toHaveLength(36);
    expect(xml.match(/hreflang="x-default"/g)).toHaveLength(36);
    expect(xml).toContain('<loc>https://fontexto.com/es/open-access-sources/</loc>');
  });
  it('robots.txt points to the sitemap and keeps the API out', () => {
    expect(robotsTxt()).toContain('Sitemap: https://fontexto.com/sitemap.xml');
    expect(robotsTxt()).toContain('Disallow: /api/');
  });
});

describe('content', () => {
  it('every language has every page, with a title and description of a sensible length', () => {
    for (const lang of SITE_LANGS) {
      for (const slug of SITE_SLUGS) {
        const p = siteContent[lang].pages[slug];
        expect(p.title.length, `${lang} ${slug} title`).toBeLessThanOrEqual(65);
        expect(p.description.length, `${lang} ${slug} description`).toBeGreaterThan(70);
        expect(p.description.length, `${lang} ${slug} description`).toBeLessThanOrEqual(170);
      }
    }
  });
  it('links resolve to existing pages and text is escaped', () => {
    expect(inline('a [FAQ](faq) **b** <i>', 'es')).toBe('a <a href="/es/faq/">FAQ</a> <strong>b</strong> &lt;i&gt;');
    expect(() => inline('[x](nope)', 'en')).toThrow();
    for (const lang of SITE_LANGS) for (const slug of SITE_SLUGS) staticPage(lang, slug, siteContent, assets);
  });
});
