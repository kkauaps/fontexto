/** Tiny fictional citing + source PDFs for local mobile/ highlight checks (not committed as binaries). */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const citing =
  `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 120>>stream
BT /F1 12 Tf 72 720 Td (Fictional survey by Doe \\(2024\\) on moss growth models.) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000264 00000 n 
0000000436 00000 n 
trailer<</Size 6/Root 1 0 R>>
startxref
503
%%EOF`;

const source =
  `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 200>>stream
BT /F1 12 Tf 72 720 Td (Journal of Nothing \\(2024\\)) Tj 0 -24 Td (Moss growth models require careful calibration of rainfall.) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000264 00000 n 
0000000516 00000 n 
trailer<</Size 6/Root 1 0 R>>
startxref
583
%%EOF`;

writeFileSync(join(dir, 'fictional-citing.pdf'), citing);
writeFileSync(join(dir, 'fictional-source.pdf'), source);
console.log('Wrote fictional-citing.pdf and fictional-source.pdf under tests/fixtures/');