/** Phone breakpoint shared with styles.css (`@media (max-width: 760px)`). */
export const PHONE_MAX_WIDTH = 760;

export function isPhoneWidth(width = typeof window !== 'undefined' ? window.innerWidth : Infinity): boolean {
  return width <= PHONE_MAX_WIDTH;
}

/**
 * Scale that makes a PDF page fill the available width on a phone.
 * Returns undefined on wider screens, where the default zoom is kept.
 */
export function phoneFitScale(pageWidthAtScale1: number, available?: number, viewport = typeof window !== 'undefined' ? window.innerWidth : Infinity): number | undefined {
  if (!isPhoneWidth(viewport) || !(pageWidthAtScale1 > 0)) return undefined;
  const room = Math.max(200, (available && available > 0 ? available : viewport) - 16);
  return Math.min(2.4, Math.max(0.4, +(room / pageWidthAtScale1).toFixed(3)));
}
