/**
 * Every user-visible product string that may change when the product is renamed
 * lives here (the server-side executable name is set in scripts/package-win.mjs).
 */
export const BRAND = {
  name: 'CitationTrace',
  tagline: 'Grafo de citações e evidências',
  /** Shown on the welcome screen. Reword when the app runs somewhere other than the user's own machine. */
  privacyNote: 'Os arquivos enviados ficam guardados apenas neste computador e nunca são enviados a serviços externos.',
} as const;

export const pageTitle = (section?: string) => (section ? `${section} · ${BRAND.name}` : `${BRAND.name} — ${BRAND.tagline}`);
