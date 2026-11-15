import { useEffect, useState } from 'react';
import {
  VISIT_COUNTED_KEY,
  formatVisitCount,
  parseVisitOverride,
  shouldShowVisits,
} from '../../core/visitCounter';
import { dateLocale, useI18n } from '../i18n';

async function fetchVisitTotal(): Promise<number | null> {
  try {
    const res = await fetch('/api/visits', { method: 'GET', headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (data && typeof data === 'object' && 'visits' in data) {
      const n = (data as { visits: unknown }).visits;
      if (typeof n === 'number' && Number.isFinite(n) && n >= 0) return n;
    }
    return null;
  } catch {
    return null;
  }
}

/** Landing line shown only when the last 30 days reach 1,000 visits. Failures stay silent. */
export function RecentVisits() {
  const { t, locale } = useI18n();
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const host = window.location.hostname;
        const search = window.location.search;
        const override = parseVisitOverride(host, search);
        try {
          if (sessionStorage.getItem(VISIT_COUNTED_KEY) !== '1') {
            const res = await fetch('/api/visits', { method: 'POST', keepalive: true });
            if (res.ok || res.status === 204) sessionStorage.setItem(VISIT_COUNTED_KEY, '1');
          }
        } catch {
          /* counting is best-effort */
        }
        const count = override ?? (await fetchVisitTotal());
        if (cancelled || count == null || !shouldShowVisits(count)) {
          if (!cancelled) setText(null);
          return;
        }
        setText(t.recentVisits(formatVisitCount(dateLocale[locale], count)));
      } catch {
        if (!cancelled) setText(null);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [t, locale]);

  if (!text) return null;
  return (
    <p className="lp-visits" aria-live="polite">
      {text}
    </p>
  );
}
