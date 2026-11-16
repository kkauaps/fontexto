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

/** Phone overlays: view switch + action buttons on top, legend at the bottom (px, see styles.css). */
const PHONE_TOP = 116;
const PHONE_BOTTOM = 84;
const PHONE_SIDE = 12;
/** Below this zoom node labels are unreadable on a phone: keep it and let the user pan instead. */
const PHONE_MIN_ZOOM = 0.6;

/**
 * Phone framing: fit the width between the overlays, top-aligned under the controls. A tall diagram (dozens of
 * references) keeps a readable zoom instead of shrinking to fit the height; the rest is reached by dragging.
 */
export function phoneViewport(bounds: { x: number; y: number; width: number; height: number }, w: number, h: number) {
  const availW = Math.max(1, w - 2 * PHONE_SIDE);
  const availH = Math.max(1, h - PHONE_TOP - PHONE_BOTTOM);
  const fitW = availW / Math.max(1, bounds.width);
  const fitH = availH / Math.max(1, bounds.height);
  const zoom = Math.min(1.2, fitW, Math.max(fitH, Math.min(PHONE_MIN_ZOOM, fitW)));
  const x = (w - bounds.width * zoom) / 2 - bounds.x * zoom;
  const tall = bounds.height * zoom > availH;
  const y = tall ? PHONE_TOP - bounds.y * zoom : PHONE_TOP + (availH - bounds.height * zoom) / 2 - bounds.y * zoom;
  return { x, y, zoom };
}
