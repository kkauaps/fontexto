/**
 * Server entry point. Local-first: binds to 127.0.0.1 unless HOST is set.
 *
 * Environment:
 *   CITATION_GRAPH_PORT              (default 5174)
 *   CITATION_GRAPH_DATA_DIR          (default ./data)
 *   CITATION_GRAPH_HOST              (default 127.0.0.1)
 *   CITATION_GRAPH_EXTERNAL_METADATA on|off (default off) – allows opt-in OpenAlex lookups by DOI
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { externalMetadataEnabledByEnv } from './metadata.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.CITATION_GRAPH_PORT ?? 5174);
const host = process.env.CITATION_GRAPH_HOST ?? '127.0.0.1';
const dataDir = path.resolve(process.env.CITATION_GRAPH_DATA_DIR ?? 'data');
// dist/server/server/index.js -> dist/web ; src/server/index.ts (dev) -> no static UI (Vite serves it)
const webDir = path.resolve(here, '../../web');

const { app } = createApp({ dataDir, externalMetadata: externalMetadataEnabledByEnv(), webDir });
app.listen(port, host, () => {
  console.log(`CitationTrace API listening on http://${host}:${port} (data: ${dataDir})`);
  console.log(`External metadata lookups: ${externalMetadataEnabledByEnv() ? 'available (opt-in per request)' : 'disabled'}`);
});
