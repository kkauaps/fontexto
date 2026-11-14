#!/usr/bin/env node
/**
 * Downloads (or reuses) the Portuguese + English Tesseract models into models/tessdata.
 * Used by the Vite build so the site can OCR on the same origin (no CDN at run time).
 */
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const DIR = path.resolve('models/tessdata');
const FILES = {
  'eng.traineddata.gz': 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
  'por.traineddata.gz': 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/por/4.0.0_best_int/por.traineddata.gz',
};

mkdirSync(DIR, { recursive: true });
for (const [name, url] of Object.entries(FILES)) {
  const dest = path.join(DIR, name);
  if (existsSync(dest) && statSync(dest).size > 10000) continue;
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Falha ao baixar ${name}: ${res.status}`);
  await pipeline(res.body, createWriteStream(dest));
  console.log('[fontexto] tessdata', name, statSync(dest).size);
}
