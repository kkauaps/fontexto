import { useI18n } from '../i18n';
import { THEMES, useAppearance, type Theme } from '../appearance';

const LABEL: Record<Theme, 'themeGlass' | 'themeDarkSolid' | 'themeLight'> = {
  glass: 'themeGlass',
  'dark-solid': 'themeDarkSolid',
  light: 'themeLight',
};

export function AppearanceSwitcher() {
  const { t } = useI18n();
  const { appearance, setTheme } = useAppearance();
  return (
    <label className="appearance-switch">
      <span className="visually-hidden">{t.appearance}</span>
      <select
        aria-label={t.appearance}
        value={appearance.theme}
        onChange={(e) => setTheme(e.target.value as Theme)}
      >
        {THEMES.map((theme) => (
          <option key={theme} value={theme}>
            {t[LABEL[theme]]}
          </option>
        ))}
      </select>
    </label>
  );
}
