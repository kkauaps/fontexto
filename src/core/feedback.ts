/**
 * Opt-in calibration feedback: running totals of (automatic label, reader's label, score bucket, semantic on/off).
 * The request carries those four values only; nothing that identifies a reader, a document or a reference is read or
 * stored. Used to check and tune the label thresholds in evidence.ts against real assessments.
 */
import type { KvLike } from './visitCounter.js';

const STATUSES = new Set(['localizado', 'ressalva', 'nao_localizado']);
export const FEEDBACK_KEY_TTL_SEC = 60 * 60 * 24 * 400;

export interface FeedbackSample {
  auto: string;
  verdict: string;
  bucket: number;
  semantic: boolean;
}

/** Strict parse: exactly the four expected fields with allowed values, or undefined. */
export function parseFeedback(body: unknown): FeedbackSample | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const o = body as Record<string, unknown>;
  if (Object.keys(o).some((k) => !['auto', 'verdict', 'bucket', 'semantic'].includes(k))) return undefined;
  const { auto, verdict, bucket, semantic } = o;
  if (typeof auto !== 'string' || !STATUSES.has(auto)) return undefined;
  if (typeof verdict !== 'string' || !STATUSES.has(verdict)) return undefined;
  if (typeof semantic !== 'boolean') return undefined;
  if (typeof bucket !== 'number' || !Number.isFinite(bucket)) return undefined;
  // -1 = no scored passage; otherwise a multiple of 0.05 in [0, 1]
  if (bucket !== -1 && (bucket < 0 || bucket > 1 || Math.abs(bucket * 20 - Math.round(bucket * 20)) > 1e-6)) return undefined;
  return { auto, verdict, bucket: bucket === -1 ? -1 : Math.round(bucket * 20) / 20, semantic };
}

export const feedbackKey = (s: FeedbackSample) => `fb1:${s.semantic ? 'sem' : 'lex'}:${s.auto}:${s.verdict}:${s.bucket === -1 ? 'none' : s.bucket.toFixed(2)}`;

export async function recordFeedback(kv: KvLike, s: FeedbackSample): Promise<void> {
  const key = feedbackKey(s);
  const n = Number((await kv.get(key)) ?? 0);
  await kv.put(key, String((Number.isFinite(n) && n > 0 ? n : 0) + 1), { expirationTtl: FEEDBACK_KEY_TTL_SEC });
}

/**
 * Confusion summary from exported totals ({ key: count }): per mode and automatic label, how often readers agreed,
 * and the agreement of "localizado" above each score bucket (to place the threshold).
 */
export function summarizeFeedback(totals: Record<string, number>) {
  const rows = Object.entries(totals)
    .map(([k, n]) => {
      const m = /^fb1:(sem|lex):(\w+):(\w+):(none|\d\.\d\d)$/.exec(k);
      return m ? { mode: m[1], auto: m[2], verdict: m[3], bucket: m[4] === 'none' ? -1 : Number(m[4]), n } : undefined;
    })
    .filter((r): r is NonNullable<typeof r> => Boolean(r));
  const agreement: Record<string, { n: number; agree: number }> = {};
  for (const r of rows) {
    const a = (agreement[`${r.mode}:${r.auto}`] ??= { n: 0, agree: 0 });
    a.n += r.n;
    if (r.auto === r.verdict) a.agree += r.n;
  }
  /** Precision of a "localizado" verdict if the threshold were each bucket: readers' localizado among samples >= bucket. */
  const thresholds: Record<string, { bucket: number; n: number; precision: number }[]> = {};
  for (const mode of ['lex', 'sem']) {
    const scored = rows.filter((r) => r.mode === mode && r.bucket >= 0);
    thresholds[mode] = [...new Set(scored.map((r) => r.bucket))]
      .sort((x, y) => x - y)
      .map((b) => {
        const above = scored.filter((r) => r.bucket >= b);
        const n = above.reduce((s, r) => s + r.n, 0);
        const ok = above.filter((r) => r.verdict === 'localizado').reduce((s, r) => s + r.n, 0);
        return { bucket: b, n, precision: n ? ok / n : 0 };
      });
  }
  return { agreement, thresholds };
}
