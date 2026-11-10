import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { contentSecurityPolicy, pagesHeadersFile, securityHeaders } from '../src/server/securityHeaders.js';

const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? (n === 'public' ? [] : walk(path.join(dir, n))) : [path.join(dir, n)]));
const webFiles = walk('src/web').filter((f) => /\.(tsx?|html|css)$/.test(f));

describe('content security policy', () => {
  const csp = contentSecurityPolicy({ https: true });
  const directive = (name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `));
  it('allows only same-origin loading and no inline/eval code', () => {
    expect(csp).not.toMatch(/unsafe-inline|(?<!wasm-)unsafe-eval|\*|https?:/);
    expect(directive('default-src')).toBe("default-src 'self'");
    expect(directive('script-src')).toBe("script-src 'self' 'wasm-unsafe-eval'");
    expect(directive('style-src')).toBe("style-src 'self'");
    expect(directive('connect-src')).toBe("connect-src 'self'");
    expect(directive('object-src')).toBe("object-src 'none'");
    expect(directive('base-uri')).toBe("base-uri 'none'");
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive('form-action')).toBe("form-action 'none'");
    expect(csp).toContain("require-trusted-types-for 'script'");
    expect(csp).toContain('upgrade-insecure-requests');
  });
  it('does not force HTTPS-only behaviour on the local 127.0.0.1 app', () => {
    const local = securityHeaders({ https: false });
    expect(local['Content-Security-Policy']).not.toContain('upgrade-insecure-requests');
    expect(local['Strict-Transport-Security']).toBeUndefined();
  });
  it('emits the full header set for Cloudflare Pages', () => {
    const file = pagesHeadersFile();
    for (const h of ['Strict-Transport-Security: max-age=63072000; includeSubDomains; preload', 'X-Content-Type-Options: nosniff', 'Referrer-Policy: no-referrer', 'Cross-Origin-Opener-Policy: same-origin', 'Cross-Origin-Resource-Policy: same-origin', 'Permissions-Policy: ']) expect(file).toContain(h);
    expect(file).toMatch(/camera=\(\)/);
    expect(file).toMatch(/microphone=\(\)/);
    expect(file).toMatch(/geolocation=\(\)/);
  });
  it('is applied by the server that serves the UI', async () => {
    const { app } = createApp({ dataDir: 'data-test-unused', externalMetadata: false, webDir: path.resolve('src/web') });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    try {
      const { port } = server.address() as { port: number };
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    } finally {
      server.close();
    }
  });
});

describe('no third-party code or network use in the web app', () => {
  it('never injects text as HTML or evaluates strings', () => {
    for (const f of webFiles.filter((x) => /\.tsx?$/.test(x))) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write|\beval\(|new Function\(/);
    }
  });
  // doi.org is only a clickable link (target=_blank, rel=noreferrer noopener), never fetched.
  it('references no external origin in source, styles or the HTML shell', () => {
    const allowed = /^https?:\/\/(www\.w3\.org\/|doi\.org\/|127\.0\.0\.1|localhost)/;
    for (const f of webFiles) {
      const src = readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      for (const m of src.matchAll(/https?:\/\/[^\s'"`)<>]+/g)) expect(m[0], `${f}: ${m[0]}`).toMatch(allowed);
    }
  });
  it('only talks to its own /api through fetch', () => {
    for (const f of webFiles.filter((x) => /\.tsx?$/.test(x))) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\bfetch\(\s*([^,)]+)/g)) expect(m[1], f).toMatch(/^(url|`\$\{?base|'\/api|`\/api)/);
      expect(src, f).not.toMatch(/XMLHttpRequest|sendBeacon|WebSocket\(|EventSource\(/);
    }
  });
});
