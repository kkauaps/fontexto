import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { listboxTypeaheadIndex, placeAnchoredDropdown } from '../listbox';
import { isPhoneWidth } from '../fit';

export interface ListboxOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  value: T;
  options: ListboxOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  icon?: ReactNode;
  className?: string;
  /** Fills the container width (header menu on phones). */
  block?: boolean;
}

/**
 * Themed combobox/listbox replacing native &lt;select&gt; (native option styling cannot follow glass/dark/light).
 * On phones the panel is a fixed dropdown anchored to the trigger (right-aligned, clamped to the viewport).
 * On desktop it stays an absolutely positioned menu under the trigger.
 */
export function Listbox<T extends string>({ value, options, onChange, ariaLabel, icon, className, block }: Props<T>) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(() => isPhoneWidth());
  const [anchor, setAnchor] = useState<{ top: number; left: number; maxHeight: number; width: number } | null>(null);
  useEffect(() => {
    const onResize = () => setPhone(isPhoneWidth());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const typeBuf = useRef('');
  const typeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const selected = useMemo(() => options.find((o) => o.value === value), [options, value]);
  const labels = useMemo(() => options.map((o) => o.label), [options]);

  useEffect(() => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
  }, [value, options]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        rootRef.current?.querySelector<HTMLButtonElement>('[data-lb-trigger]')?.focus();
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const updateAnchor = useCallback(() => {
    if (!phone) return;
    const trigger = rootRef.current?.querySelector<HTMLElement>('[data-lb-trigger]');
    const list = listRef.current;
    if (!trigger || !list) return;
    const tr = trigger.getBoundingClientRect();
    const next = placeAnchoredDropdown(
      tr,
      { width: window.innerWidth, height: window.innerHeight },
      { width: Math.max(list.offsetWidth, list.scrollWidth, tr.width), height: Math.max(list.scrollHeight, list.offsetHeight) },
    );
    setAnchor(next);
  }, [phone]);

  useLayoutEffect(() => {
    if (!open || !phone) {
      setAnchor(null);
      return;
    }
    updateAnchor();
    listRef.current?.focus();
    const onWin = () => updateAnchor();
    window.addEventListener('resize', onWin);
    window.addEventListener('scroll', onWin, true);
    return () => {
      window.removeEventListener('resize', onWin);
      window.removeEventListener('scroll', onWin, true);
    };
  }, [open, phone, updateAnchor, options.length]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const pick = (idx: number) => {
    const o = options[idx];
    if (!o) return;
    onChange(o.value);
    setOpen(false);
    rootRef.current?.querySelector<HTMLButtonElement>('[data-lb-trigger]')?.focus();
  };

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!open) setOpen(true);
      if (e.key === 'ArrowDown') setActive((a) => (a + 1) % options.length);
      if (e.key === 'ArrowUp') setActive((a) => (a - 1 + options.length) % options.length);
    }
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a - 1 + options.length) % options.length);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(options.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(active);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      typeBuf.current += e.key;
      clearTimeout(typeTimer.current);
      typeTimer.current = setTimeout(() => {
        typeBuf.current = '';
      }, 700);
      setActive((a) => listboxTypeaheadIndex(labels, a, typeBuf.current));
    }
  };

  const activeId = `${listId}-opt-${active}`;
  const panelStyle: CSSProperties | undefined =
    phone && open && anchor
      ? { top: anchor.top, left: anchor.left, width: anchor.width, maxHeight: anchor.maxHeight }
      : undefined;

  return (
    <div ref={rootRef} className={`lb${block ? ' lb-block' : ''}${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        data-lb-trigger
        className="hdr-pill lb-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
      >
        {icon}
        <span className="lb-value">{selected?.label ?? value}</span>
        <span className="lb-chevron" aria-hidden="true" />
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          aria-activedescendant={activeId}
          className={`lb-panel${phone ? ' lb-anchored' : ''}`}
          style={panelStyle}
          tabIndex={-1}
          onKeyDown={onListKey}
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-opt-${i}`}
              role="option"
              data-idx={i}
              aria-selected={o.value === value}
              className={`lb-opt${i === active ? ' active' : ''}${o.value === value ? ' sel' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(i)}
            >
              <span className="lb-opt-label">{o.label}</span>
              {o.value === value && (
                <svg className="lb-check" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path d="M5 12.5l5.5 5.5L19 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
