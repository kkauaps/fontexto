/** "Ask the author": a polite, prefilled e-mail request for a copy of a paper (mailto link, nothing is sent by Fontexto). */
import type { Messages } from './i18n';

export interface AskAuthorInput {
  title?: string;
  year?: number;
  doi?: string;
  /** Only when the address is printed in the work's public metadata. */
  email?: string;
  name?: string;
}

const enc = encodeURIComponent;

export function askAuthorMailto(t: Pick<Messages, 'askAuthorSubject' | 'askAuthorBody'>, w: AskAuthorInput): string | undefined {
  if (!w.title && !w.doi) return undefined;
  const title = w.title ?? (w.doi as string);
  const email = w.email && /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[a-z]{2,}$/i.test(w.email) ? w.email : '';
  const subject = t.askAuthorSubject(title);
  const body = t.askAuthorBody({ name: email ? w.name : undefined, title, year: w.year, doi: w.doi });
  return `mailto:${email}?subject=${enc(subject)}&body=${enc(body)}`;
}
