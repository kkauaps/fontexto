import { useEffect, useRef } from 'react';
import { LOCALES, LOCALE_NATIVE, parseLocale, useI18n } from '../i18n';
import { THEMES, useAppearance, type Theme } from '../appearance';

const THEME_LABEL: Record<Theme, 'themeGlass' | 'themeDarkSolid' | 'themeLight'> = {
  glass: 'themeGlass',
  'dark-solid': 'themeDarkSolid',
  light: 'themeLight',
};

const Icon = {
  theme: (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" />
    </svg>
  ),
  globe: (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.4-3.6-8.5S9.5 6.1 12 3.5Z" />
    </svg>
  ),
  back: (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  ),
  more: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
      <circle cx="5" cy="12" r="1.9" />
      <circle cx="12" cy="12" r="1.9" />
      <circle cx="19" cy="12" r="1.9" />
    </svg>
  ),
};

function ThemePill() {
  const { t } = useI18n();
  const { appearance, setTheme } = useAppearance();
  return (
    <label className="hdr-pill hdr-select" title={t.appearance}>
      {Icon.theme}
      <select aria-label={t.appearance} value={appearance.theme} onChange={(e) => setTheme(e.target.value as Theme)}>
        {THEMES.map((theme) => (
          <option key={theme} value={theme}>
            {t[THEME_LABEL[theme]]}
          </option>
        ))}
      </select>
    </label>
  );
}

function LanguagePill() {
  const { t, locale, setLocale } = useI18n();
  return (
    <label className="hdr-pill hdr-select" title={t.language}>
      {Icon.globe}
      <select
        aria-label={t.language}
        value={locale}
        onChange={(e) => {
          const next = parseLocale(e.target.value);
          if (next) setLocale(next);
        }}
      >
        {LOCALES.map((code) => (
          <option key={code} value={code}>
            {LOCALE_NATIVE[code]}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Theme + language, the same on every screen: two matching glass pills on wide screens, one "⋯" menu on phones.
 */
export function HeaderControls() {
  const { t } = useI18n();
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      const el = menu.current;
      if (el?.open && !el.contains(e.target as Node)) el.open = false;
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && menu.current?.open) menu.current.open = false;
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', esc);
    };
  }, []);
  return (
    <div className="hdr-controls">
      <div className="hdr-inline">
        <ThemePill />
        <LanguagePill />
      </div>
      <details className="hdr-menu" ref={menu}>
        <summary className="hdr-pill hdr-icon" aria-label={t.displaySettings} title={t.displaySettings}>
          {Icon.more}
        </summary>
        <div className="hdr-menu-panel" role="group" aria-label={t.displaySettings}>
          <span className="hdr-menu-label">{t.appearance}</span>
          <ThemePill />
          <span className="hdr-menu-label">{t.language}</span>
          <LanguagePill />
        </div>
      </details>
    </div>
  );
}

/** "← Back" as a pill; icon-only when `compact` (phones) via CSS. */
export function BackPill({ onClick, label, className }: { onClick: () => void; label: string; className?: string }) {
  return (
    <button type="button" className={`hdr-pill hdr-back${className ? ` ${className}` : ''}`} onClick={onClick} aria-label={label} title={label}>
      {Icon.back}
      <span className="hdr-back-text">{label}</span>
    </button>
  );
}
