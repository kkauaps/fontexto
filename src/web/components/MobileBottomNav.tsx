import type { ReactNode } from 'react';
import { useI18n } from '../i18n';

export type MobileAppTab = 'doc' | 'refs' | 'source';

const Icon = {
  doc: (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M7 4h7l5 5v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
      <path d="M14 4v5h5" />
    </svg>
  ),
  refs: (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 6h16M4 10h16M4 14h10M4 18h10" strokeLinecap="round" />
    </svg>
  ),
  source: (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
      <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
    </svg>
  ),
};

interface Props {
  tab: MobileAppTab;
  onTab: (tab: MobileAppTab) => void;
}

/** Phone tab bar: References · Document · Source (full-width PDF surfaces). */
export function MobileBottomNav({ tab, onTab }: Props) {
  const { t } = useI18n();
  const items: { id: MobileAppTab; label: string; icon: ReactNode }[] = [
    { id: 'refs', label: t.tabReferences, icon: Icon.refs },
    { id: 'doc', label: t.tabDocument, icon: Icon.doc },
    { id: 'source', label: t.tabSource, icon: Icon.source },
  ];
  return (
    <nav className="m-tabs m-tabs-icons" role="tablist" aria-label={t.views}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={tab === item.id}
          className={tab === item.id ? 'on' : ''}
          onClick={() => onTab(item.id)}
        >
          {item.icon}
          <span className="m-tab-label">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}