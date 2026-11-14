import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { createApp, isLoopbackHost, isLoopbackOrigin } from '../src/server/app.js';
import { handleOaRequest, httpUrlOrUndefined, parseOaQuery } from '../src/core/openAccess';
import { evidenceCsv } from '../src/core/export';

describe('local server refuses rebinding hosts and cross-site writes', () => {
  it('accepts only loopback Host names', () => {
    expect(isLoopbackHost('127.0.0.1:5174')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('[::1]:5174')).toBe(true);
    expect(isLoopbackHost('attacker.example:5174')).toBe(false);
    expect(isLoopbackHost('127.0.0.1.attacker.example')).toBe(false);
    expect(isLoopbackHost(undefined)).toBe(false);
    expect(isLoopbackOrigin('http://127.0.0.1:5173')).toBe(true);
    expect(isLoopbackOrigin('https://evil.example')).toBe(false);
    expect(isLoopbackOrigin('null')).toBe(false);
  });

  it('answers 403 to a foreign Host or a foreign Origin on a write', async () => {
    const { app } = createApp({ dataDir: 'data-test-unused', externalMetadata: false });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const port = (server.address() as { port: number }).port;
    const req = (method: string, headers: Record<string, string>) =>
      new Promise<number>((resolve, reject) => {
        const r = http.request({ host: '127.0.0.1', port, path: '/api/health', method, headers }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        r.on('error', reject);
        r.end();
      });
    try {
      expect(await req('GET', { Host: `127.0.0.1:${port}` })).toBe(200);
      expect(await req('GET', { Host: `rebind.attacker.example:${port}` })).toBe(403);
      expect(await req('POST', { Host: `127.0.0.1:${port}`, Origin: 'https://evil.example' })).toBe(403);
    } finally {
      server.close();
    }
  });
});

describe('open-access API hardening', () => {
  it('rejects DOIs that would add query parameters or walk catalogue paths', () => {
    expect(parseOaQuery(new URLSearchParams({ doi: '10.1371/journal.pmed.0020124' }))?.doi).toBe('10.1371/journal.pmed.0020124');
    expect(parseOaQuery(new URLSearchParams({ doi: '10.1002/(sici)1097-4571(199806)49:8<693::aid-asi4>3.0.co;2-o' }))?.doi).toBeTruthy();
    for (const doi of ['10.1234/x?email=a', '10.1234/x#frag', '10.1234/../../v2', '10.1234/a%2Fb']) expect(parseOaQuery(new URLSearchParams({ doi }))).toBeUndefined();
  });

  it('only lets http(s) catalogue links through', () => {
    expect(httpUrlOrUndefined('https://repo.example/record/1')).toBe('https://repo.example/record/1');
    expect(httpUrlOrUndefined('javascript:alert(1)')).toBeUndefined();
    expect(httpUrlOrUndefined('data:text/html,x')).toBeUndefined();
    expect(httpUrlOrUndefined('not a url')).toBeUndefined();
  });

  it('marks API answers as data that is never sniffed or rendered', async () => {
    const res = await handleOaRequest(new URL('https://fontexto.test/api/oa/lookup'));
    expect(res.status).toBe(400);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
  });
});

describe('CSV export', () => {
  it('neutralises spreadsheet formulas coming from PDF text', () => {
    const csv = evidenceCsv(
      { occurrences: [{ page: 1, marker: '(X, 2020)', resolution: 'unresolved', passages: [], sentence: '=HYPERLINK("https://evil.example","x")', why: '+cmd' }] } as never,
      { nodes: {}, files: {} } as never,
    );
    expect(csv).toContain(`"'=HYPERLINK(""https://evil.example"",""x"")"`);
    expect(csv).toContain(`'+cmd`);
    expect(csv).not.toMatch(/;=HYPERLINK/);
  });
});
