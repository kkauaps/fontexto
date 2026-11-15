# Security policy

Fontexto processes people's academic documents, so we treat security reports as a priority.

## Reporting a vulnerability

Email **contact@xoryn.com.br** with "Fontexto security" in the subject.

- Describe the problem, how to reproduce it and the impact you see.
- Please do not open a public issue with details before a fix is out.
- We reply within 5 business days and let you know when a fix ships. We are happy to credit you if you want.
- Do not access other people's data, do not run denial-of-service tests and do not use social engineering.

The same contact is published in [`/.well-known/security.txt`](https://fontexto.com/.well-known/security.txt).

## Supported versions

Only the version published from `main` (the one running on fontexto.com) receives security fixes.

## What the project does to protect users

- **Local first.** In the web edition, PDFs and `.bib` files are read in your own browser and never uploaded. The only
  network calls are the optional free-PDF and graph lookups, which send bibliographic metadata of the references (DOI,
  title, year, first author) to the site's own `/api/oa/*` proxy, never the document itself. No analytics, ads, or
  third-party scripts, fonts or CDNs.
- **Strict CSP** (`src/server/securityHeaders.ts`, emitted as `_headers` at build time): no `unsafe-inline` or
  `unsafe-eval`, `connect-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, Trusted Types for scripts. Plus
  HSTS, `nosniff`, `Referrer-Policy: no-referrer`, a `Permissions-Policy` that denies camera, microphone, geolocation and
  similar, and COOP/COEP/CORP.
- **PDF and `.bib` text never becomes HTML.** React escapes everything; there is no `innerHTML` or
  `dangerouslySetInnerHTML` (a test guards this).
- **pdf.js** runs in a Web Worker with `isEvalSupported: false`, on a version patched for CVE-2024-4367, with fonts and
  decoders served by the site itself.
- **API keys stay on the server.** Catalogue keys (`OPENALEX_API_KEY`, `CORE_API_KEY`, `S2_API_KEY`) are Cloudflare Pages
  secrets read only by the `/api/oa/*` functions; they are never bundled into client code.
- **Supply chain:** versioned `package-lock.json`, `npm ci` in builds, `npm audit` with no high or critical findings,
  Dependabot, GitHub Actions pinned by SHA with minimal permissions, and CodeQL.
