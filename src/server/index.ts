/**
 * Server entry point. Local-first: binds to 127.0.0.1 unless HOST is set.
 * Packaged Windows builds always bind to 127.0.0.1 and fall back to a free
 * port if the preferred one is taken.
 *
 * Environment:
 *   CITATION_GRAPH_PORT              (default 5174; next free port if busy)
 *   CITATION_GRAPH_DATA_DIR          (default ./data, or %APPDATA%\CitationTrace when packaged)
 *   CITATION_GRAPH_HOST              (default 127.0.0.1; ignored when packaged)
 *   CITATION_GRAPH_EXTERNAL_METADATA on|off (default off) – allows opt-in OpenAlex lookups by DOI
 *   CITATION_GRAPH_NO_BROWSER        1 to skip opening the default browser (also --no-browser)
 */
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { externalMetadataEnabledByEnv } from './metadata.js';
import { configurePdfJs } from './pdfText.js';
import {
  bindHost,
  defaultDataDir,
  isPackaged,
  listenOnFreePort,
  openInDefaultBrowser,
  packagedPdfjsDir,
  packagedWebDir,
  preferredPort,
  shouldOpenBrowser,
} from './runtime.js';

function sourceDir(): string {
  // A packaged SEA binary has no module file path; this is only used unpackaged.
  const metaUrl = import.meta.url;
  if (!metaUrl) return path.dirname(process.execPath);
  return path.dirname(fileURLToPath(metaUrl));
}

function configurePackagedAssets(): void {
  const pdfjsDir = packagedPdfjsDir();
  const modulePath = path.join(pdfjsDir, 'pdf.mjs');
  const workerPath = path.join(pdfjsDir, 'pdf.worker.mjs');
  const webDir = packagedWebDir();
  if (!existsSync(modulePath) || !existsSync(workerPath)) {
    console.error(`CitationTrace could not find pdf.js assets in:\n  ${pdfjsDir}\nKeep the resources folder next to CitationTrace.exe.`);
    process.exit(1);
  }
  if (!existsSync(webDir)) {
    console.error(`CitationTrace could not find the web UI in:\n  ${webDir}\nKeep the resources folder next to CitationTrace.exe.`);
    process.exit(1);
  }
  const fontsDir = path.join(pdfjsDir, 'standard_fonts');
  const wasmDir = path.join(pdfjsDir, 'wasm');
  configurePdfJs({
    moduleUrl: pathToFileURL(modulePath).href,
    workerSrc: pathToFileURL(workerPath).href,
    // pdf.js requires factory URLs to end with "/" (not "\\"); configurePdfJs normalises them.
    standardFontDataUrl: fontsDir,
    ...(existsSync(wasmDir) ? { wasmUrl: wasmDir } : {}),
  });
}

async function main(): Promise<void> {
  const packaged = isPackaged();
  if (packaged) configurePackagedAssets();

  const portHint = preferredPort();
  const host = bindHost();
  const dataDir = defaultDataDir();
  // dist/server/server/index.js -> dist/web ; src/server/index.ts (dev) -> no static UI (Vite serves it)
  // Packaged executable: resources/web next to the exe.
  const webDir = packaged ? packagedWebDir() : path.resolve(sourceDir(), '../../web');

  const { app } = createApp({ dataDir, externalMetadata: externalMetadataEnabledByEnv(), webDir });
  const { server, port } = await listenOnFreePort(app, host, portHint);
  const url = `http://${host}:${port}`;
  console.log(`CitationTrace listening on ${url} (data: ${dataDir})`);
  console.log(`External metadata lookups: ${externalMetadataEnabledByEnv() ? 'available (opt-in per request)' : 'disabled'}`);
  if (port !== portHint) {
    console.log(`Port ${portHint} was in use; using ${port} instead.`);
  }

  if (packaged) {
    try {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(path.join(dataDir, 'last-url.txt'), url, 'utf8');
    } catch (err) {
      console.warn('Could not write last-url.txt:', (err as Error).message);
    }
  }

  if (shouldOpenBrowser()) {
    openInDefaultBrowser(url);
  }

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
