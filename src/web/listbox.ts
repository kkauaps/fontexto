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