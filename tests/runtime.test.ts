/** Packaged-runtime helpers: data dir, browser flag, and free-port fallback. */
import express from 'express';
import type { Server } from 'node:http';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bindHost,
  defaultDataDir,
  listenOnFreePort,
  preferredPort,
  shouldOpenBrowser,
} from '../src/server/runtime';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve, reject) => {
          s.close((err) => (err ? reject(err) : resolve()));
        }),
    ),
  );
});

describe('runtime helpers', () => {
  it('keeps the unpackaged data dir at ./data unless CITATION_GRAPH_DATA_DIR is set', () => {
    const prev = process.env.CITATION_GRAPH_DATA_DIR;
    delete process.env.CITATION_GRAPH_DATA_DIR;
    try {
      expect(defaultDataDir()).toBe(path.resolve('data'));
    } finally {
      if (prev === undefined) delete process.env.CITATION_GRAPH_DATA_DIR;
      else process.env.CITATION_GRAPH_DATA_DIR = prev;
    }
  });

  it('honours CITATION_GRAPH_DATA_DIR', () => {
    const prev = process.env.CITATION_GRAPH_DATA_DIR;
    process.env.CITATION_GRAPH_DATA_DIR = path.resolve('tmp-citation-trace-data');
    try {
      expect(defaultDataDir()).toBe(path.resolve('tmp-citation-trace-data'));
    } finally {
      if (prev === undefined) delete process.env.CITATION_GRAPH_DATA_DIR;
      else process.env.CITATION_GRAPH_DATA_DIR = prev;
    }
  });

  it('defaults the preferred port to 5174 and parses CITATION_GRAPH_PORT', () => {
    const prev = process.env.CITATION_GRAPH_PORT;
    try {
      delete process.env.CITATION_GRAPH_PORT;
      expect(preferredPort()).toBe(5174);
      process.env.CITATION_GRAPH_PORT = '18080';
      expect(preferredPort()).toBe(18080);
    } finally {
      if (prev === undefined) delete process.env.CITATION_GRAPH_PORT;
      else process.env.CITATION_GRAPH_PORT = prev;
    }
  });

  it('binds unpackaged servers to 127.0.0.1 by default', () => {
    const prev = process.env.CITATION_GRAPH_HOST;
    delete process.env.CITATION_GRAPH_HOST;
    try {
      expect(bindHost()).toBe('127.0.0.1');
    } finally {
      if (prev === undefined) delete process.env.CITATION_GRAPH_HOST;
      else process.env.CITATION_GRAPH_HOST = prev;
    }
  });

  it('does not open a browser when --no-browser or CITATION_GRAPH_NO_BROWSER=1 is set', () => {
    expect(shouldOpenBrowser(['node', 'index.js', '--no-browser'], {})).toBe(false);
    expect(shouldOpenBrowser(['node', 'index.js'], { CITATION_GRAPH_NO_BROWSER: '1' })).toBe(false);
  });
});

describe('listenOnFreePort', () => {
  it('falls back to the next port when the preferred one is in use', async () => {
    const occupied = express();
    const first = await listenOnFreePort(occupied, '127.0.0.1', 0);
    servers.push(first.server);

    const app = express();
    app.get('/api/health', (_req, res) => res.json({ ok: true }));
    const second = await listenOnFreePort(app, '127.0.0.1', first.port);
    servers.push(second.server);

    expect(second.port).not.toBe(first.port);
    const res = await fetch(`http://127.0.0.1:${second.port}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
