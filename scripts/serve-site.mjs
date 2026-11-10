#!/usr/bin/env node
/** Dev helper: serves dist/site exactly as Cloudflare Pages would (headers taken from the generated `_headers`). */
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve('dist/site');
const port = Number(process.argv[2] ?? 5193);
const headerLines = readFileSync(path.join(root, '_headers'), 'utf8').split('\n');
const globalHeaders = {};
for (let i = headerLines.findIndex((l) => l.trim() === '/*') + 1; i < headerLines.length && headerLines[i].startsWith('  '); i++) {
  const [k, ...v] = headerLines[i].trim().split(': ');
  globalHeaders[k] = v.join(': ');
}
// A local plain-http server cannot honour upgrade-insecure-requests / HSTS.
globalHeaders['Content-Security-Policy'] = globalHeaders['Content-Security-Policy'].replace('; upgrade-insecure-requests', '');
delete globalHeaders['Strict-Transport-Security'];
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf' };

createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  let file = path.join(root, p);
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) file = path.join(root, 'index.html');
  res.writeHead(200, { ...globalHeaders, 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' });
  res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}`));
