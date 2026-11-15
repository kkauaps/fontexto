/** Next active option index for typeahead (prefix match on labels, case- and accent-insensitive). */
export function listboxTypeaheadIndex(labels: string[], start: number, prefix: string): number {
  if (!prefix) return start;
  const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const q = fold(prefix);
  const n = labels.length;
  if (!n) return -1;
  for (let i = 1; i <= n; i++) {
    const j = (start + i) % n;
    if (fold(labels[j]).startsWith(q)) return j;
  }
  return start;
}

export type BoxRect = { top: number; right: number; bottom: number; left: number; width: number; height: number };
export type ViewportSize = { width: number; height: number };

/**
 * Place a dropdown as a fixed panel anchored to a trigger: right-aligned,
 * clamped inside the viewport, and flipped above the trigger when there is
 * more room there than below.
 */
export function placeAnchoredDropdown(
  trigger: BoxRect,
  viewport: ViewportSize,
  panelSize: { width: number; height: number },
  options: { gap?: number; margin?: number } = {},
): { top: number; left: number; maxHeight: number; width: number } {
  const gap = options.gap ?? 6;
  const margin = options.margin ?? 8;
  const availW = Math.max(0, viewport.width - margin * 2);
  const width = Math.min(Math.max(panelSize.width, trigger.width, 0), availW);

  let left = trigger.right - width;
  left = Math.min(Math.max(left, margin), Math.max(margin, viewport.width - margin - width));

  const below = viewport.height - trigger.bottom - gap - margin;
  const above = trigger.top - gap - margin;
  const preferBelow = below >= Math.min(panelSize.height, 160) || below >= above;
  const maxHeight = Math.max(96, preferBelow ? below : above);
  const usedHeight = Math.min(panelSize.height, maxHeight);
  const top = preferBelow ? trigger.bottom + gap : Math.max(margin, trigger.top - gap - usedHeight);
  return { top, left, maxHeight, width };
}
