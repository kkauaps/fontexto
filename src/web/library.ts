/**
 * "Access via my library": an optional link prefix (EZproxy or similar) the researcher pastes once. It is kept in
 * this browser's localStorage only — never sent to Fontexto — and only used to build a link the user clicks.
 */
import { useSyncExternalStore } from 'react';

export const LIBRARY_STORAGE_KEY = 'fontexto:libraryPrefix';
const EVENT = 'fontexto:library';

/** Normalises a pasted prefix; undefined when it is not a usable http(s) link. */
export function parseLibraryPrefix(raw: string | null | undefined): string | undefined {
  const v = (raw ?? '').trim();
  if (!v || /\s/.test(v) || v.length > 500) return undefined;
  try {
    const u = new URL(v.replace(/\{(url|doi)\}/g, 'x'));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined;
    if (u.username || u.password) return undefined;
  } catch {
    return undefined;
  }
  return v;
}

/**
 * Library link for a work. "{url}" is replaced by the encoded target URL and "{doi}" by the DOI; without
 * placeholders the target is appended as is (the EZproxy "login?url=" convention).
 */
export function libraryLink(prefix: string | undefined, target: { url?: string; doi?: string }): string | undefined {
  const p = parseLibraryPrefix(prefix);
  const url = target.url ?? (target.doi ? `https://doi.org/${target.doi}` : undefined);
  if (!p || !url) return undefined;
  if (p.includes('{url}') || p.includes('{doi}')) {
    if (p.includes('{doi}') && !target.doi) return p.includes('{url}') ? p.replace(/\{url\}/g, encodeURIComponent(url)).replace(/\{doi\}/g, '') : undefined;
    return p.replace(/\{url\}/g, encodeURIComponent(url)).replace(/\{doi\}/g, target.doi ?? '');
  }
  return `${p}${url}`;
}

export function readLibraryPrefix(): string | undefined {
  try {
    return typeof localStorage !== 'undefined' ? parseLibraryPrefix(localStorage.getItem(LIBRARY_STORAGE_KEY)) : undefined;
  } catch {
    return undefined;
  }
}

/** Saves (or clears, with an empty value) the prefix. Returns false when the value is not a valid link. */
export function saveLibraryPrefix(raw: string): boolean {
  const v = raw.trim();
  const parsed = parseLibraryPrefix(v);
  if (v && !parsed) return false;
  try {
    if (parsed) localStorage.setItem(LIBRARY_STORAGE_KEY, parsed);
    else localStorage.removeItem(LIBRARY_STORAGE_KEY);
  } catch {
    return false;
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
  return true;
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

export function useLibraryPrefix(): string | undefined {
  return useSyncExternalStore(subscribe, readLibraryPrefix, () => undefined);
}
