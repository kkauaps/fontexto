import { describe, expect, it } from 'vitest';
import { siteContent } from '../src/site/content';
import { SITE_LANGS } from '../src/site/types';
import {
  VISIT_COUNTED_KEY,
  VISITS_VISIBLE_AT,
  dayTotalKey,
  formatVisitCount,
  incrementVisit,
  isPreviewHost,
  isVisitStorageKey,
  parseVisitOverride,
  shardKey,
  shouldShowVisits,
  sumWindow,
  utcDayStamp,
  type KvLike,
} from '../src/core/visitCounter';
import { dateLocale, messages, type Locale } from '../src/web/i18n';

class MemoryKv implements KvLike {
  readonly store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

describe('visit counter visibility', () => {
  it('hides counts below 1000 and shows them from 1000 up', () => {
    expect(VISITS_VISIBLE_AT).toBe(1000);
    expect(shouldShowVisits(0)).toBe(false);
    expect(shouldShowVisits(1)).toBe(false);
    expect(shouldShowVisits(999)).toBe(false);
    expect(shouldShowVisits(999.9)).toBe(false);
    expect(shouldShowVisits(1000)).toBe(true);
    expect(shouldShowVisits(1001)).toBe(true);
    expect(shouldShowVisits(12_000)).toBe(true);
    expect(shouldShowVisits(Number.NaN)).toBe(false);
    expect(shouldShowVisits(-1)).toBe(false);
  });
});

describe('preview-only override', () => {
  it('is ignored on production hosts', () => {
    for (const host of ['fontexto.com', 'www.fontexto.com', 'fontexto.pages.dev']) {
      expect(isPreviewHost(host)).toBe(false);
      expect(parseVisitOverride(host, '?fx_visits=1000')).toBeUndefined();
      expect(parseVisitOverride(host, '?fx_visits=999')).toBeUndefined();
    }
  });

  it('works on Pages preview hostnames and local dev', () => {
    expect(parseVisitOverride('feat-anonymous-visit-counter.fontexto.pages.dev', '?fx_visits=1000')).toBe(1000);
    expect(parseVisitOverride('abc123.fontexto.pages.dev', 'fx_visits=999')).toBe(999);
    expect(parseVisitOverride('localhost:5173', '?fx_visits=1000')).toBe(1000);
    expect(parseVisitOverride('127.0.0.1', '?fx_visits=0')).toBe(0);
    expect(parseVisitOverride('feat.fontexto.pages.dev', '?fx_visits=not-a-number')).toBeUndefined();
    expect(parseVisitOverride('evil.pages.dev', '?fx_visits=1000')).toBeUndefined();
  });
});

describe('localized line', () => {
  const locales = Object.keys(messages) as Locale[];

  it('formats a compact count in every UI language', () => {
    const en = formatVisitCount(dateLocale.en, 1200);
    expect(en).toMatch(/1[.,]?2k/i);
    expect(formatVisitCount(dateLocale['pt-BR'], 1200).length).toBeGreaterThan(0);
    expect(formatVisitCount(dateLocale.ru, 1200).length).toBeGreaterThan(0);
    expect(formatVisitCount(dateLocale['zh-CN'], 1200).length).toBeGreaterThan(0);
  });

  it('builds a localized sentence that includes the formatted count', () => {
    for (const locale of locales) {
      const count = formatVisitCount(dateLocale[locale], 1200);
      const line = messages[locale].recentVisits(count);
      expect(line).toContain(count);
      expect(line.toLowerCase()).toMatch(/30/);
    }
  });
});

describe('anonymous storage', () => {
  it('writes only dated numeric keys and never personal data', async () => {
    const kv = new MemoryKv();
    const now = new Date('2026-11-15T23:00:00Z');
    await incrementVisit(kv, now, 4);
    await incrementVisit(kv, now, 4);
    const keys = [...kv.store.keys()];
    expect(keys).toEqual([shardKey(utcDayStamp(now), 4)]);
    expect(keys.every(isVisitStorageKey)).toBe(true);
    expect(kv.store.get(keys[0])).toBe('2');
    expect(VISIT_COUNTED_KEY).toBe('fontexto:visit-counted');
    const dumped = [...kv.store.entries()].join(' ');
    expect(dumped).not.toMatch(/ip|cookie|ua=|fingerprint|email|session|user/i);
  });

  it('sums thirty UTC days and rolls up past days only', async () => {
    const kv = new MemoryKv();
    const today = new Date('2026-11-15T12:00:00Z');
    const yesterday = new Date('2026-11-14T12:00:00Z');
    await incrementVisit(kv, yesterday, 0);
    await incrementVisit(kv, yesterday, 1);
    await incrementVisit(kv, today, 0);
    expect(await sumWindow(kv, today)).toBe(3);
    expect(kv.store.get(dayTotalKey('2026-11-14'))).toBe('2');
    expect(kv.store.has(dayTotalKey('2026-11-15'))).toBe(false);
    await incrementVisit(kv, today, 2);
    expect(await sumWindow(kv, today)).toBe(4);
  });
});

describe('privacy copy mentions the anonymous total', () => {
  it('documents the aggregate count and the lack of personal data in every language', () => {
    for (const lang of SITE_LANGS) {
      const page = siteContent[lang].pages.privacy;
      const blob = [page.description, page.lead, ...page.sections.flatMap((s) => [s.h2, ...(s.p ?? []), ...(s.ul ?? [])])].join('\n');
      expect(blob, lang).toMatch(/1[.,]?000|1000|1,000/);
      expect(blob, lang).toMatch(/30/);
      expect(blob.toLowerCase(), lang).toMatch(/anonymous|an[oóô]nim|аноним|匿名/);
      expect(blob, lang).toMatch(/IP/i);
      expect(blob.toLowerCase(), lang).not.toMatch(/google analytics|gtag|fingerprint/);
    }
  });
});
