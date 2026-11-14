/**
 * Wraps a JPEG in a one-page PDF so the rest of the app (pdf.js viewer, text layer fallback)
 * can treat a photo or scan like any other document.
 */
import type { ImageKind } from '../../core/ocr';
function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function jpegToPdf(jpeg: Uint8Array, width: number, height: number): Uint8Array {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const objects: Uint8Array[] = [];
  const add = (s: string | Uint8Array) => {
    objects.push(typeof s === 'string' ? enc(s) : s);
  };
  add('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n');
  add('2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n');
  add(`3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >> endobj\n`);
  add(
    concat([enc(`4 0 obj << /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >> stream\n`), jpeg, enc('\nendstream endobj\n')]),
  );
  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q\n`;
  add(`5 0 obj << /Length ${content.length} >> stream\n${content}endstream endobj\n`);

  const header = enc('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const parts: Uint8Array[] = [header];
  const offsets = [0];
  let pos = header.length;
  for (const o of objects) {
    offsets.push(pos);
    parts.push(o);
    pos += o.length;
  }
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  const tail = `${xref}trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
  parts.push(enc(tail));
  return concat(parts);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}


export async function wrapImageAsPdf(data: Uint8Array, kind: ImageKind): Promise<Uint8Array> {
  const { jpeg, width, height } = await toJpeg(data, kind);
  return jpegToPdf(jpeg, width, height);
}

async function toJpeg(data: Uint8Array, kind: ImageKind): Promise<{ jpeg: Uint8Array; width: number; height: number }> {
  const mime = kind === 'png' ? 'image/png' : kind === 'webp' ? 'image/webp' : 'image/jpeg';
  const blob = new Blob([data as unknown as BlobPart], { type: mime });
  const bmp = await createImageBitmap(blob);
  try {
    if (kind === 'jpeg') return { jpeg: data, width: bmp.width, height: bmp.height };
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas indisponível');
    ctx.drawImage(bmp, 0, 0);
    const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    return { jpeg: new Uint8Array(await out.arrayBuffer()), width: bmp.width, height: bmp.height };
  } finally {
    bmp.close();
  }
}
