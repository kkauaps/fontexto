#!/usr/bin/env node
/** Dev helper: serves dist/site as Cloudflare Pages would: `_headers` rules (incl. "! Header" detach), folder index pages, 404.html. */
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve('dist/site');
const port = Number(process.argv[2] ?? 5193);

/** `_headers` as [{ pattern, set, detach }]; host-qualified rules (https://…) do not apply locally. */
const rules = [];
let cur;
for (const line of readFileSync(path.join(root, '_headers'), 'utf8').split('\n')) {
  if (!line.trim() || line.trim().startsWith('#')) continue;
  if (!line.startsWith(' ')) {
    cur = { pattern: line.trim(), set: {}, detach: [] };
    rules.push(cur);
  } else if (line.trim().startsWith('! ')) cur.detach.push(line.trim().slice(2));
  else {
    const [k, ...v] = line.trim().split(': ');
    cur.set[k] = v.join(': ');
  }
}
const matches = (pattern, p) => !pattern.startsWith('http') && (pattern.endsWith('*') ? p.startsWith(pattern.slice(0, -1)) : p === pattern);
function headersFor(p) {
  const h = {};
  for (const r of rules.filter((r) => matches(r.pattern, p))) {
    for (const d of r.detach) delete h[d];
    Object.assign(h, r.set);
  }
  // A local plain-http server cannot honour upgrade-insecure-requests / HSTS.
  if (h['Content-Security-Policy']) h['Content-Security-Policy'] = h['Content-Security-Policy'].replace('; upgrade-insecure-requests', '');
  delete h['Strict-Transport-Security'];
  return h;
}
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8' };
const isFile = (f) => f.startsWith(root) && existsSync(f) && statSync(f).isFile();

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  let file = path.join(root, p.endsWith('/') ? p + 'index.html' : p);
  if (!p.endsWith('/') && !isFile(file) && isFile(path.join(root, p, 'index.html'))) {
    res.writeHead(308, { Location: p + '/' + url.search });
    return res.end();
  }
  let status = 200;
  if (!isFile(file)) {
    file = path.join(root, '404.html');
    status = 404;
  }
  res.writeHead(status, { ...headersFor(p), 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' });
  res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}`));
