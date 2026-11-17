/**
 * Opt-in calibration feedback. When the reader agrees (off by default), each assessment they make sends four values
 * to Fontexto: the automatic label, their label, the passage score rounded to 0.05, and whether semantic search was
 * on. No text, title, DOI, file, project or identifier of any kind. The server only adds them to running totals.
 */
import { useSyncExternalStore } from 'react';
import { edition } from './api';
import type { EvidenceStatus } from '../core/evidence';

export const FEEDBACK_CONSENT_KEY = 'fontexto:feedback';
const EVENT = 'fontexto:feedback-consent';

export function feedbackConsent(): boolean {
  try {
    return localStorage.getItem(FEEDBACK_CONSENT_KEY) === 'on';
  } catch {
    return false;
  }
}

export function setFeedbackConsent(on: boolean) {
  try {
    if (on) localStorage.setItem(FEEDBACK_CONSENT_KEY, 'on');
    else localStorage.removeItem(FEEDBACK_CONSENT_KEY);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

export function useFeedbackConsent(): boolean {
  return useSyncExternalStore(subscribe, feedbackConsent, () => false);
}

export interface FeedbackSample {
  auto: EvidenceStatus;
  verdict: EvidenceStatus;
  score?: number;
  semantic: boolean;
}

/** Score rounded down to 0.05 (0..1), or -1 when there was no scored passage. */
export const scoreBucket = (score: number | undefined) => (typeof score === 'number' && Number.isFinite(score) ? Math.min(1, Math.max(0, Math.floor(score * 20) / 20)) : -1);

/** Sends one sample when the reader opted in (browser edition only). Failures are silent. */
export function sendFeedback(s: FeedbackSample) {
  if (edition !== 'web' || !feedbackConsent()) return;
  void fetch('/api/feedback', {
    method: 'POST',
    keepalive: true,
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ auto: s.auto, verdict: s.verdict, bucket: scoreBucket(s.score), semantic: s.semantic }),
  }).catch(() => undefined);
}
