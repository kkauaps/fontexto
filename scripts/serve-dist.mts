// Dev helper: serves dist/web + API on a port (used for screenshots and header checks).
import path from 'node:path';
import { createApp } from '../src/server/app.ts';
const dataDir = process.env.DATA_DIR ?? 'data';
const port = Number(process.env.PORT ?? 5190);
const { app } = createApp({ dataDir, externalMetadata: false, webDir: path.resolve('dist/web') });
app.listen(port, '127.0.0.1', () => console.log(`serving on ${port} (data ${dataDir})`));
