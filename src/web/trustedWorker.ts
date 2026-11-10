/**
 * Every Web Worker of the app is created here, from same-origin files only, through one Trusted Types policy, so the
 * page can run under `require-trusted-types-for 'script'`.
 */
type TTPolicy = { createScriptURL: (url: string) => unknown };
const tt = (globalThis as unknown as { trustedTypes?: { createPolicy: (name: string, rules: { createScriptURL: (url: string) => string }) => TTPolicy } }).trustedTypes;
const policy = tt?.createPolicy('fontexto-pdfjs', {
  createScriptURL: (url: string) => {
    const u = new URL(url, globalThis.location.href);
    if (u.origin !== globalThis.location.origin) throw new TypeError('Worker bloqueado: origem diferente');
    return u.href;
  },
});

export function createWorker(url: string | URL, name?: string): Worker {
  const href = String(url);
  return new Worker((policy ? policy.createScriptURL(href) : href) as string, { type: 'module', name });
}
