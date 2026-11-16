#!/usr/bin/env node
/**
 * Runs before `wrangler pages deploy`: makes sure the optional OA_CACHE KV namespace (global cache for /api/oa
 * lookups) exists and is bound in wrangler.toml. Idempotent: an already bound namespace is left alone.
 * Never blocks a deploy: if wrangler is not logged in or the API refuses, the site deploys without the global cache
 * (the per-data-centre cache still works).
 *
 *   node scripts/ensure-kv.mjs [path/to/wrangler.toml]
 *   WRANGLER="node fake-wrangler.mjs" ...   (tests)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BINDING = 'OA_CACHE';
const tomlPath = path.resolve(process.argv[2] ?? 'wrangler.toml');
const [cmd, ...cmdArgs] = (process.env.WRANGLER ?? 'npx --yes wrangler').split(' ');

const wrangler = (...args) => execFileSync(cmd, [...cmdArgs, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** `[[kv_namespaces]]` block with `binding = "OA_CACHE"` that is not commented out. */
export const isBound = (toml) => /^\[\[kv_namespaces\]\]\s*\n(?:[^\[\n].*\n)*?binding\s*=\s*"OA_CACHE"/m.test(toml);

/** Namespace id from `wrangler kv namespace create` output (toml or json snippet). */
export const idFromCreate = (out) => /\b(?:preview_)?id\s*[=:]\s*"([0-9a-f]{32})"/i.exec(out)?.[1];

/** Replaces the commented OA_CACHE example in wrangler.toml with a live binding (or appends one). */
export function bindInToml(toml, id, previewId) {
  const block = `[[kv_namespaces]]\nbinding = "${BINDING}"\nid = "${id}"\npreview_id = "${previewId}"\n`;
  const commented = /# \[\[kv_namespaces\]\]\n# binding = "OA_CACHE"\n# id = "[^"\n]*"\n# preview_id = "[^"\n]*"\n/;
  return commented.test(toml) ? toml.replace(commented, block) : `${toml.replace(/\n*$/, '\n')}\n${block}`;
}

function findOrCreate(list, title, preview) {
  const hit = list.find((n) => n.title === title);
  if (hit) return hit.id;
  const id = idFromCreate(wrangler('kv', 'namespace', 'create', BINDING, ...(preview ? ['--preview'] : [])));
  if (!id) throw new Error(`could not read the id of the new ${preview ? 'preview ' : ''}namespace`);
  return id;
}

function main() {
  const toml = readFileSync(tomlPath, 'utf8');
  if (isBound(toml)) return console.log(`[ensure-kv] ${BINDING} already bound.`);
  const project = /^name\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? 'fontexto';
  const list = JSON.parse(wrangler('kv', 'namespace', 'list'));
  const id = findOrCreate(list, `${project}-${BINDING}`, false);
  const previewId = findOrCreate(list, `${project}-${BINDING}_preview`, true);
  writeFileSync(tomlPath, bindInToml(toml, id, previewId));
  console.log(`[ensure-kv] ${BINDING} bound (id ${id}, preview ${previewId}). Commit wrangler.toml to keep it.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (e) {
    console.warn(`[ensure-kv] skipped (${String(e.message ?? e).split('\n')[0]}): deploying without the global lookup cache.`);
  }
}
