/**
 * pdf.js validates `standardFontDataUrl`, `wasmUrl`, `cMapUrl` and `iccUrl`
 * with `val.endsWith("/")` (see getFactoryUrlProp in pdf.mjs). A native
 * Windows directory such as `C:\app\resources\pdfjs\standard_fonts\` ends
 * with a backslash and is rejected with "must include trailing slash".
 *
 * In Node, pdf.js reads these files with `fs.readFile(baseUrl + filename)`,
 * and Windows accepts forward slashes in file paths, so we hand pdf.js a
 * plain filesystem path that uses `/` separators and always ends with `/`.
 */
import path from 'node:path';

/** Converts a directory path (any OS, with or without trailing separator) to a pdf.js factory base URL. */
export function toPdfJsFactoryUrl(dir: string, pathApi: Pick<typeof path, 'resolve'> = path): string {
  const normalized = pathApi.resolve(dir).replace(/\\/g, '/');
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}
