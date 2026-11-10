/**
 * Optional external metadata lookup (OpenAlex), strictly opt-in.
 *
 * Privacy guarantees:
 *  - Disabled unless the server is started with CITATION_GRAPH_EXTERNAL_METADATA=on
 *    AND the request carries explicit consent.
 *  - Only a public identifier (normalized DOI) is ever sent. Titles, file
 *    contents, extracted text and file names are never transmitted.
 *  - Results only fill *missing* fields and are recorded as `external_metadata`.
 */
import type { Author } from '../core/model.js';
import { normalizeDoi, parseAuthor } from '../core/normalize.js';
import type { ExternalMetadata } from '../core/pipeline.js';

export interface MetadataConfig {
  enabled: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export const externalMetadataEnabledByEnv = () => /^(1|on|true|yes)$/i.test(process.env.CITATION_GRAPH_EXTERNAL_METADATA ?? '');

export function openAlexUrl(doi: string): string {
  const d = normalizeDoi(doi);
  if (!d) throw new Error('Invalid DOI');
  return `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(d)}`;
}

function abstractFromInvertedIndex(idx: Record<string, number[]> | null | undefined): string | undefined {
  if (!idx) return undefined;
  const words: string[] = [];
  for (const [w, positions] of Object.entries(idx)) for (const p of positions) words[p] = w;
  const s = words.filter(Boolean).join(' ').trim();
  return s || undefined;
}

export async function lookupDoi(doi: string, cfg: MetadataConfig): Promise<ExternalMetadata | undefined> {
  if (!cfg.enabled) return undefined;
  const f = cfg.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs ?? 10000);
  try {
    const res = await f(openAlexUrl(doi), { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return undefined;
    const w = (await res.json()) as {
      title?: string;
      publication_year?: number;
      authorships?: { author?: { display_name?: string } }[];
      primary_location?: { source?: { display_name?: string } };
      abstract_inverted_index?: Record<string, number[]>;
    };
    const authors: Author[] = (w.authorships ?? [])
      .map((a) => a.author?.display_name)
      .filter((n): n is string => Boolean(n))
      .map((n) => parseAuthor(n));
    return {
      source: 'openalex',
      title: w.title ?? undefined,
      year: w.publication_year ?? undefined,
      authors: authors.length ? authors : undefined,
      venue: w.primary_location?.source?.display_name ?? undefined,
      abstract: abstractFromInvertedIndex(w.abstract_inverted_index),
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Looks up a list of DOIs (sequentially, politely). Returns results keyed by DOI. */
export async function lookupMany(dois: string[], cfg: MetadataConfig): Promise<Record<string, ExternalMetadata>> {
  const out: Record<string, ExternalMetadata> = {};
  if (!cfg.enabled) return out;
  for (const d of [...new Set(dois.map((x) => normalizeDoi(x)).filter((x): x is string => Boolean(x)))]) {
    const r = await lookupDoi(d, cfg);
    if (r) out[d] = r;
  }
  return out;
}
