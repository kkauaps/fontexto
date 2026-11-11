#!/usr/bin/env node
/**
 * Build a portable Windows folder:
 *   dist/win/Fontexto/Fontexto.exe
 *   dist/win/Fontexto/resources/{web,pdfjs}
 *
 * The exe is a Node.js single executable application (SEA) that embeds the
 * bundled server. pdf.js (ESM + worker + fonts + wasm) and the Vite UI stay
 * as real files so the worker thread can load them from disk.
 *
 * Prerequisites: `npm run build` (typecheck + web bundle + server). This
 * script is invoked by `npm run package:win`.
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packDir = path.join(root, 'dist', 'package');
const outDir = path.join(root, 'dist', 'win', 'Fontexto');
const serverBundle = path.join(packDir, 'server.cjs');
const seaConfig = path.join(packDir, 'sea-config.json');
const seaBlob = path.join(packDir, 'sea-prep.blob');
const exePath = path.join(outDir, 'Fontexto.exe');

function stripPeSignature(file) {
  const buf = Buffer.from(readFileSync(file));
  if (buf.toString('ascii', 0, 2) !== 'MZ') {
    throw new Error(`${file} is not a PE executable`);
  }
  const peOffset = buf.readUInt32LE(0x3c);
  if (buf.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
    throw new Error(`${file} is not a PE executable`);
  }
  const magic = buf.readUInt16LE(peOffset + 24);
  const isPe32Plus = magic === 0x20b;
  const certDirOffset = peOffset + 24 + (isPe32Plus ? 144 : 128);
  const certOffset = buf.readUInt32LE(certDirOffset);
  const certSize = buf.readUInt32LE(certDirOffset + 4);
  if (!certOffset || !certSize) {
    console.log('Node executable is already unsigned.');
    return;
  }
  buf.writeUInt32LE(0, certDirOffset);
  buf.writeUInt32LE(0, certDirOffset + 4);
  const checksumOffset = peOffset + 24 + 64;
  buf.writeUInt32LE(0, checksumOffset);
  const trimmed = certOffset + certSize === buf.length || certOffset + certSize < buf.length ? buf.subarray(0, certOffset) : buf;
  writeFileSync(file, trimmed);
  console.log(`Removed Authenticode signature (${certSize} bytes) from ${path.basename(file)}.`);
}

rmSync(packDir, { recursive: true, force: true });
rmSync(outDir, { recursive: true, force: true });
mkdirSync(packDir, { recursive: true });

console.log('Bundling the server with esbuild…');
await build({
  entryPoints: [path.join(root, 'src', 'server', 'index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: serverBundle,
  external: ['pdfjs-dist', 'pdfjs-dist/legacy/build/pdf.mjs'],
  legalComments: 'none',
  logLevel: 'info',
  sourcemap: false,
});

// esbuild leaves import.meta.url empty in CJS. Rewrite it so unpackaged
// fallbacks still have a usable module URL if they are ever hit.
{
  const bundled = readFileSync(serverBundle, 'utf8');
  if (bundled.includes('import.meta.url')) {
    writeFileSync(
      serverBundle,
      bundled.replaceAll('import.meta.url', 'require("node:url").pathToFileURL(__filename).href'),
    );
  }
}

writeFileSync(
  seaConfig,
  JSON.stringify(
    {
      main: serverBundle,
      output: seaBlob,
      disableExperimentalSEAWarning: true,
      useCodeCache: true,
    },
    null,
    2,
  ),
);

console.log('Generating the SEA blob…');
try {
  execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit', cwd: root });
} catch (err) {
  console.warn('SEA blob with code cache failed; retrying without useCodeCache.');
  writeFileSync(
    seaConfig,
    JSON.stringify(
      {
        main: serverBundle,
        output: seaBlob,
        disableExperimentalSEAWarning: true,
      },
      null,
      2,
    ),
  );
  execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit', cwd: root });
}

mkdirSync(outDir, { recursive: true });
copyFileSync(process.execPath, exePath);
stripPeSignature(exePath);

// Fontexto icon + version info (pure-JS PE resource editing, before the SEA blob is injected).
{
  const ResEdit = await import('resedit');
  const exe = ResEdit.NtExecutable.from(readFileSync(exePath));
  const res = ResEdit.NtExecutableResource.from(exe);
  const ico = ResEdit.Data.IconFile.from(readFileSync(path.join(root, 'src', 'web', 'public', 'favicon.ico')));
  const group = res.entries.find((e) => e.type === 14);
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, group?.id ?? 1, group?.lang ?? 1033, ico.icons.map((i) => i.data));
  const [vi] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (vi) {
    vi.setStringValues({ lang: 1033, codepage: 1200 }, { FileDescription: 'Fontexto', ProductName: 'Fontexto', InternalName: 'Fontexto', OriginalFilename: 'Fontexto.exe', LegalCopyright: '' });
    vi.outputToResourceEntries(res.entries);
  }
  res.outputResource(exe);
  writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log('Applied the Fontexto icon and version info.');
}

const postjectCli = require.resolve('postject/dist/cli.js');
console.log('Injecting the SEA blob into Fontexto.exe…');
execFileSync(
  process.execPath,
  [postjectCli, exePath, 'NODE_SEA_BLOB', seaBlob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'],
  { stdio: 'inherit', cwd: root },
);

const webSrc = path.join(root, 'dist', 'web');
if (!existsSync(path.join(webSrc, 'index.html'))) {
  throw new Error('dist/web is missing. Run `npm run build` first.');
}

const resources = path.join(outDir, 'resources');
const pdfjsSrc = path.join(root, 'node_modules', 'pdfjs-dist');
const pdfjsDest = path.join(resources, 'pdfjs');
mkdirSync(pdfjsDest, { recursive: true });
cpSync(webSrc, path.join(resources, 'web'), { recursive: true });
copyFileSync(path.join(pdfjsSrc, 'legacy', 'build', 'pdf.mjs'), path.join(pdfjsDest, 'pdf.mjs'));
copyFileSync(path.join(pdfjsSrc, 'legacy', 'build', 'pdf.worker.mjs'), path.join(pdfjsDest, 'pdf.worker.mjs'));
cpSync(path.join(pdfjsSrc, 'standard_fonts'), path.join(pdfjsDest, 'standard_fonts'), { recursive: true });
if (existsSync(path.join(pdfjsSrc, 'wasm'))) {
  cpSync(path.join(pdfjsSrc, 'wasm'), path.join(pdfjsDest, 'wasm'), { recursive: true });
}

const exeSize = Math.round(readFileSync(exePath).byteLength / 1024 / 1024);
console.log(`Wrote ${outDir}`);
console.log(`  Fontexto.exe (${exeSize} MB) + resources/`);
