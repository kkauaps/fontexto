/**
 * Build-time prerender of the app landing (one per language) so the public site's home pages carry real,
 * indexable HTML before the bundle loads. Built with `vite build --ssr` and used by scripts/build-site-pages.ts;
 * never shipped to the browser. The client replaces this markup on mount (createRoot), so it must only render
 * what the landing renders for a first-time visitor with no projects.
 */
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { Landing } from './components/Landing';
import { AppearanceProvider } from './appearance';
import { LocaleProvider, messages, type Locale } from './i18n';

const noop = () => undefined;

export function renderLanding(locale: Locale): string {
  return renderToString(
    <StrictMode>
      <AppearanceProvider>
        <LocaleProvider initial={locale}>
          <Landing projects={[]} onStart={noop} onOpen={noop} />
        </LocaleProvider>
      </AppearanceProvider>
    </StrictMode>,
  );
}

/** The exact title and description the client sets at run time (applyDocumentMeta), so both stay in sync. */
export function landingMeta(locale: Locale): { title: string; description: string } {
  const t = messages[locale];
  return { title: t.pageTitle(), description: t.metaDescription };
}
