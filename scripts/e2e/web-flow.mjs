#!/usr/bin/env node
/**
 * End-to-end check of the browser edition in headless Chrome: upload article (+ .bib) + reference PDFs, read the graph,
 * the Documento view and a reference PDF page; fail on any CSP / Trusted Types violation.
 *
 *   BASE=http://127.0.0.1:5193 INPUT=/path/inputs SHOTS=/path/out MODE=bib|nobib|doc [SEMANTIC=1] \
 *   (MODE=doc uploads only the article and needs the /api/oa Functions: use `wrangler pages dev dist/site`)
 *   PLAYWRIGHT_CORE=/path/to/playwright-core CHROME=/usr/bin/google-chrome node scripts/e2e/web-flow.mjs
 */
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const BASE = process.env.BASE ?? 'http://127.0.0.1:5193';
const INPUT = process.env.INPUT;
const SHOTS = process.env.SHOTS ?? 'shots';
const MODE = process.env.MODE ?? 'bib';
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  window.__violations = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__violations.push(`${e.violatedDirective} ${e.blockedURI}`));
});
const page = await ctx.newPage();
const problems = [];
page.on('console', (m) => {
  if (['error', 'warning'].includes(m.type())) problems.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
const origins = new Set();
page.on('request', (r) => origins.add(new URL(r.url()).origin));
const shot = (n) => page.screenshot({ path: path.join(SHOTS, `${MODE}-${n}.png`) });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

process.on('uncaughtException', (e) => {
  console.error('FAILED:', e.message.split('\n')[0]);
  console.error(JSON.stringify({ origins: [...origins], problems: problems.slice(0, 30) }, null, 1));
  process.exit(1);
});
const t0 = Date.now();
await page.goto(BASE);
await shot('01-landing');
await page.getByRole('button', { name: MODE === 'bib' ? 'Envie com o .bib' : MODE === 'doc' ? 'Só o meu documento' : 'Documento + PDFs das referências' }).click();
const files = readdirSync(INPUT);
await page.setInputFiles('#uf-main', path.join(INPUT, files.find((f) => f.startsWith('demo'))));
if (MODE === 'bib') await page.setInputFiles('#uf-bib', path.join(INPUT, files.find((f) => f.endsWith('.bib'))));
if (MODE !== 'doc') await page.setInputFiles('#uf-refs', files.filter((f) => f.startsWith('refs-')).map((f) => path.join(INPUT, f)));
await page.locator('.uf-name input').fill(`demo-${MODE}`);
await shot('02-form');
await page.getByRole('button', { name: 'Processar e abrir' }).click();
log('processing…');
await page.waitForSelector('.uf-steps', { timeout: 10_000 });
await page.waitForFunction(() => document.body.innerText.includes('Abrir no Fontexto') || document.body.innerText.includes('Abrir o projeto assim mesmo') || document.querySelector('[role=tab]'), null, { timeout: 600_000 });
log('processed in', Math.round((Date.now() - t0) / 1000), 's');
await shot('03-review');
const failed = await page.getByText('Algo deu errado').count();
if (failed) throw new Error('Processing failed: ' + (await page.locator('.notice.error').innerText()));
if (await page.getByRole('button', { name: 'Abrir no Fontexto' }).count()) await page.getByRole('button', { name: 'Abrir no Fontexto' }).click();
await page.waitForSelector('.react-flow, .docview, .app', { timeout: 60_000 });
await shot('04-grafo');

await page.getByRole('tab', { name: /Documento/ }).click();
await page.waitForSelector('.doc-chips', { timeout: 60_000 });
await page.waitForSelector('.doc-pages canvas', { timeout: 60_000 });
await page.waitForTimeout(1500);
const chips = await page.locator('.doc-chips .chip-filter').allInnerTexts();
log('chips', JSON.stringify(chips.map((c) => c.replace(/\s+/g, ' '))));
await shot('05-documento');

if (process.env.SEMANTIC === '1') {
  const btn = page.getByRole('button', { name: 'Ativar busca semântica' });
  await btn.waitFor({ timeout: 30_000 });
  await btn.click();
  const ts = Date.now();
  await page.waitForFunction(() => !document.body.innerText.includes('Ativar busca semântica') && !document.querySelector('.notice progress'), null, { timeout: 1_800_000, polling: 2000 });
  log('semantic done in', Math.round((Date.now() - ts) / 1000), 's');
  await page.waitForTimeout(1500);
  const chips2 = await page.locator('.doc-chips .chip-filter').allInnerTexts();
  log('chips after semantic', JSON.stringify(chips2.map((c) => c.replace(/\s+/g, ' '))));
  await shot('06-semantica');
}

// open a citation and its reference PDF page
const rows = page.locator('.cit-list li button, .cit-list li');
log('citation rows', await rows.count());
await rows.first().click();
await page.waitForTimeout(800);
await shot('07-citacao');
const open = page.getByRole('button', { name: /Abrir no artigo/ }).first();
if (await open.count()) {
  await open.click();
  await page.waitForSelector('canvas >> nth=-1', { timeout: 30_000 }).catch(() => undefined);
  await page.waitForTimeout(2500);
  await shot('08-pdf-fonte');
} else log('no passage to open (first citation has none)');

const violations = await page.evaluate(() => window.__violations);
await browser.close();
console.log(JSON.stringify({ chips, origins: [...origins], violations, problems: problems.slice(0, 30) }, null, 1));
process.exit(violations.length || problems.some((p) => /Content Security|Trusted Type|violat/i.test(p)) ? 1 : 0);
