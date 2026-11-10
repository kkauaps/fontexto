/**
 * Thematic categories. Suggestions come from user-editable keyword rules and
 * are always marked `suggested` until the researcher sets a category manually.
 * Categories (and their colors) are presentation only: they never create or
 * confirm a bibliographic relation.
 */
import type { CategoryAssignment, PublicationNode } from './model.js';
import { normalizeTitle } from './normalize.js';

export interface CategoryRule {
  name: string;
  color?: string;
  keywords: string[];
}

export const UNCATEGORIZED = 'Sem categoria';

export function suggestCategory(pub: Pick<PublicationNode, 'title' | 'abstract' | 'venue'>, rules: CategoryRule[]): CategoryAssignment | undefined {
  const text = ` ${normalizeTitle([pub.title, pub.abstract, pub.venue].filter(Boolean).join(' '))} `;
  if (!text.trim()) return undefined;
  let best: { rule: CategoryRule; matched: string[] } | undefined;
  for (const rule of rules) {
    const matched = rule.keywords.filter((k) => {
      const nk = normalizeTitle(k);
      return nk && text.includes(` ${nk} `);
    });
    if (matched.length > 0 && (!best || matched.length > best.matched.length)) best = { rule, matched };
  }
  return best ? { value: best.rule.name, source: 'suggested', matched: best.matched } : undefined;
}

export function categoryOf(pub: PublicationNode): string {
  return pub.category?.value ?? UNCATEGORIZED;
}
