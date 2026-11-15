import { useEffect, type ReactNode } from 'react';
import { useI18n } from '../i18n';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Extra class on the panel (e.g. doc-filter-sheet). */
  className?: string;
}

/** Mobile bottom sheet with scrim; does not steal layout height from the PDF pane. */
export function BottomSheet({ open, onClose, title, children, className }: Props) {
  const { t } = useI18n();
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <button type="button" className="sheet-scrim" aria-label={t.close} onClick={onClose} />
      <div className={`bottom-sheet${className ? ` ${className}` : ''}`} role="dialog" aria-label={title}>
        <header className="bottom-sheet-head">
          <h3>{title}</h3>
          <button type="button" className="sheet-close" onClick={onClose} aria-label={t.close}>
            ×
          </button>
        </header>
        <div className="bottom-sheet-body">{children}</div>
      </div>
    </>
  );
}