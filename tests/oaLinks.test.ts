/** Library (EZproxy) links and the "ask the author" mailto. Fictional works only. */
import { describe, expect, it } from 'vitest';
import { askAuthorMailto } from '../src/web/askAuthor';
import { messages } from '../src/web/i18n';
import { libraryLink, parseLibraryPrefix } from '../src/web/library';

const DOI = '10.5555/fx.0001';

describe('library prefix', () => {
  it('accepts http(s) prefixes only', () => {
    expect(parseLibraryPrefix(' https://ezproxy.example.edu/login?url= ')).toBe('https://ezproxy.example.edu/login?url=');
    for (const bad of ['', 'javascript:alert(1)', 'ftp://x.example/', 'https://user:pw@x.example/', 'not a link', 'https://a.example/ b']) expect(parseLibraryPrefix(bad), bad).toBeUndefined();
  });
  it('appends the target (EZproxy style) or fills {url} / {doi}', () => {
    expect(libraryLink('https://ezproxy.example.edu/login?url=', { doi: DOI })).toBe(`https://ezproxy.example.edu/login?url=https://doi.org/${DOI}`);
    expect(libraryLink('https://proxy.example.edu/go?target={url}&src=fx', { url: `https://doi.org/${DOI}` })).toBe(`https://proxy.example.edu/go?target=${encodeURIComponent(`https://doi.org/${DOI}`)}&src=fx`);
    expect(libraryLink('https://resolver.example.edu/openurl?id=doi:{doi}', { doi: DOI })).toBe(`https://resolver.example.edu/openurl?id=doi:${DOI}`);
    expect(libraryLink('https://resolver.example.edu/openurl?id=doi:{doi}', { url: 'https://journal.example.org/x' })).toBeUndefined();
    expect(libraryLink(undefined, { doi: DOI })).toBeUndefined();
    expect(libraryLink('https://ezproxy.example.edu/login?url=', {})).toBeUndefined();
  });
});

describe('ask the author', () => {
  const decode = (m: string) => {
    const [to, q] = m.replace(/^mailto:/, '').split('?');
    const p = new URLSearchParams(q.replace(/\+/g, '%2B'));
    return { to, subject: p.get('subject') ?? '', body: p.get('body') ?? '' };
  };
  it('uses the public address and a polite request in every language', () => {
    for (const t of Object.values(messages)) {
      const m = askAuthorMailto(t, { title: 'Lumen Index: Synthetic Benchmarks', year: 2021, doi: DOI, email: 'ada.quill@example.edu', name: 'Ada Quillfeather' });
      const d = decode(m as string);
      expect(d.to).toBe('ada.quill@example.edu');
      expect(d.subject).toContain('Lumen Index');
      expect(d.body).toContain('Ada Quillfeather');
      expect(d.body).toContain(`https://doi.org/${DOI}`);
      expect(m).not.toMatch(/ /);
    }
  });
  it('without a public address leaves "to" empty and a placeholder greeting', () => {
    const d = decode(askAuthorMailto(messages.en, { title: 'Lumen Index', name: 'Ada Quillfeather' }) as string);
    expect(d.to).toBe('');
    expect(d.body).toContain('[author’s name]');
    expect(d.body).not.toContain('Ada Quillfeather');
  });
  it('rejects odd addresses (no header injection)', () => {
    const d = decode(askAuthorMailto(messages.en, { title: 'Lumen Index', email: 'x@example.org?cc=evil@example.org' }) as string);
    expect(d.to).toBe('');
  });
});
