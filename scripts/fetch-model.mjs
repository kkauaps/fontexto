#!/usr/bin/env node
/**
 * Downloads the (optional) semantic-search model into ./models/minilm and verifies pinned SHA-256 digests.
 * Model: Xenova/paraphrase-multilingual-MiniLM-L12-v2 (Apache-2.0), 8-bit quantised ONNX. Not run by `npm ci`:
 * the app builds and works without it (the web build then ships without the semantic option).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = 'https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/';
const FILES = {
  'onnx/model_quantized.onnx': '66fc00f5f29afcaff34092e1bdd20008ca3918265a82fb9695a551e510cc4ebc',
  'tokenizer.json': 'b60b6b43406a48bf3638526314f3d232d97058bc93472ff2de930d43686fa441',
  'tokenizer_config.json': '3f5961b9ac86288cccdb97f32fb848d6187c78e1603958c53f3ea1f296b7d8a2',
  'config.json': '05b570bff786faa5c4604152aa16f19f77ed6dfc31e47dd0f3dd987078693ac7',
};
const dir = path.resolve('models/minilm');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

for (const [name, want] of Object.entries(FILES)) {
  const file = path.join(dir, name);
  if (existsSync(file) && sha(readFileSync(file)) === want) {
    console.log(`ok       ${name}`);
    continue;
  }
  console.log(`download ${name}`);
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha(buf) !== want) throw new Error(`${name}: SHA-256 não confere, arquivo recusado`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, buf);
}
console.log('Modelo pronto em models/minilm');
