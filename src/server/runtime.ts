/**
 * Runtime helpers for the local server and the packaged Windows executable.
 *
 * Packaged mode is detected with `node:sea`. In that case the UI and pdf.js
 * assets live in a `resources` folder next to the executable, the default
 * data directory is %APPDATA%\CitationTrace (or $HOME/.citation-trace),
 * and the process binds only to 127.0.0.1.
 */
import { execFile } from 'node:child_process';
import type { Express } from 'express';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { isSea } from 'node:sea';

export function isPackaged(): boolean {
  try {
    return isSea();
  } catch {
    return false;
  }
}

/** Directory that contains the executable when packaged; otherwise cwd. */
export function installDir(): string {
  return isPackaged() ? path.dirname(process.execPath) : process.cwd();
}

export function resourcesDir(): string {
  return path.join(installDir(), 'resources');
}

export function packagedWebDir(): string {
  return path.join(resourcesDir(), 'web');
}

export function packagedPdfjsDir(): string {
  return path.join(resourcesDir(), 'pdfjs');
}

export function defaultDataDir(): string {
  if (process.env.CITATION_GRAPH_DATA_DIR) return path.resolve(process.env.CITATION_GRAPH_DATA_DIR);
  if (isPackaged()) {
    const appData = process.env.APPDATA || process.env.XDG_DATA_HOME;
    if (appData) return path.join(appData, 'CitationTrace');
    return path.join(os.homedir(), '.citation-trace');
  }
  return path.resolve('data');
}

/** Preferred port, overridable by CITATION_GRAPH_PORT. */
export function preferredPort(): number {
  const raw = process.env.CITATION_GRAPH_PORT;
  if (raw) {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0 && n <= 65535) return n;
  }
  return 5174;
}

/**
 * Bind address. Packaged builds always use 127.0.0.1 so a double-click
 * never exposes the server on the LAN.
 */
export function bindHost(): string {
  if (isPackaged()) return '127.0.0.1';
  return process.env.CITATION_GRAPH_HOST ?? '127.0.0.1';
}

export function shouldOpenBrowser(argv: string[] = process.argv, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CITATION_GRAPH_NO_BROWSER === '1') return false;
  if (argv.includes('--no-browser')) return false;
  return isPackaged();
}

export function openInDefaultBrowser(url: string): void {
  if (process.platform === 'win32') {
    execFile('cmd', ['/c', 'start', '', url], { windowsHide: true });
    return;
  }
  if (process.platform === 'darwin') {
    execFile('open', [url]);
    return;
  }
  execFile('xdg-open', [url]);
}

/**
 * Listen on the preferred port, then the next 20 ports, then an OS-assigned
 * ephemeral port. Only EADDRINUSE triggers a fallback.
 */
export function listenOnFreePort(app: Express, host: string, preferred: number): Promise<{ server: Server; port: number }> {
  const candidates = [preferred, ...Array.from({ length: 20 }, (_, i) => preferred + i + 1)];

  const tryPort = (port: number): Promise<{ server: Server; port: number }> =>
    new Promise((resolve, reject) => {
      const server = app.listen(port, host);
      const onListening = () => {
        server.off('error', onError);
        const addr = server.address();
        if (!addr || typeof addr === 'string') {
          server.close();
          reject(new Error('Failed to determine the bound port'));
          return;
        }
        resolve({ server, port: addr.port });
      };
      const onError = (err: NodeJS.ErrnoException) => {
        server.off('listening', onListening);
        if (err.code === 'EADDRINUSE') reject(err);
        else reject(err);
      };
      server.once('listening', onListening);
      server.once('error', onError);
    });

  return (async () => {
    for (const port of candidates) {
      try {
        return await tryPort(port);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
      }
    }
    return tryPort(0);
  })();
}
