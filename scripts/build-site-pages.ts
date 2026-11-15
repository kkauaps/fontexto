#!/usr/bin/env tsx
/**
 * Public-site pages for search engines, run after `vite build --mode web` and the landing prerender
 * (`vite build --mode web --ssr prerender.tsx`). Writes into dist/site:
 *   - "/", "/es/", "/ru/", "/pt-br/": the app shell with SEO head, JSON-LD and the prerendered landing;
 *   - /<lang>/{how-it-works,faq,about,privacy,open-access-sources}/: static content pages;
 *   - sitemap.xml (with hreflang alternates), robots.txt, 404.html, the brand mark;
 *   - per-page CSP rules (JSON-LD hashes) appended to _headers.
 */
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { siteContent } from '../src/site/content/index';
import { landingPage, notFoundPage, pageHeaderRules, pathOf, robotsTxt, sitemapXml, staticPage, type Assets } from '../src/site/render';
import { SITE_LANGS, SITE_SLUGS, type SiteLang } from '../src/site/types';

const out = path.resolve('dist/site');
const shell = readFileSync(path.join(out, 'index.html'), 'utf8');
const css = [...shell.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
if (!css.length) throw new Error('dist/site/index.html has no stylesheet: run vite build --mode web first');

const prerender = (await import(pathToFileURL(path.resolve('dist/prerender/prerender.js')).href)) as {
  renderLanding: (l: SiteLang) => string;
  landingMeta: (l: SiteLang) => { title: string; description: string };
};

copyFileSync(path.resolve('src/web/assets/fontexto-mark.svg'), path.join(out, 'fontexto-mark.svg'));
const assets: Assets = { css, mark: '/fontexto-mark.svg' };

const hashes = new Map<string, string[]>();
const write = (urlPath: string, html: string) => {
  const dir = path.join(out, urlPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'index.html'), html);
};

for (const lang of SITE_LANGS) {
  const home = landingPage(shell, lang, siteContent, prerender.landingMeta(lang), prerender.renderLanding(lang));
  write(pathOf(lang), home.html);
  hashes.set(pathOf(lang), home.hashes);
  for (const slug of SITE_SLUGS) {
    const page = staticPage(lang, slug, siteContent, assets);
    write(pathOf(lang, slug), page.html);
    hashes.set(pathOf(lang, slug), page.hashes);
  }
}

writeFileSync(path.join(out, '404.html'), notFoundPage(siteContent, assets));
writeFileSync(path.join(out, 'sitemap.xml'), sitemapXml());
writeFileSync(path.join(out, 'robots.txt'), robotsTxt());
appendFileSync(path.join(out, '_headers'), pageHeaderRules(hashes));
rmSync(path.resolve('dist/prerender'), { recursive: true, force: true });
console.log(`[fontexto] public site: ${hashes.size} indexable pages, sitemap.xml, robots.txt, 404.html`);
