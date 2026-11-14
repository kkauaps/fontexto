import { useMemo, useRef, useState } from 'react';
import type { EvidenceReport } from '../../core/evidence';
import type { CitationGraph, PublicationNode } from '../../core/model';
import { REF_STATUS_ORDER, refRows, type RefRow, type RefStatus } from '../../core/refStatus';
import { api, type OaCandidate, type OaHost, type OaResult, type OaVersion } from '../api';
import type { OpenRequest } from './SidePanel';
import { refStatusText, translateRuntime, useI18n, type Messages } from '../i18n';
import { libraryLink, saveLibraryPrefix, useLibraryPrefix } from '../library';
import { askAuthorMailto } from '../askAuthor';

/** Outcome of the free-PDF search for one reference (kept for the session only). */
export type OaState =
  | { kind: 'busy' }
  | { kind: 'got'; source: string; host?: OaHost; version?: OaVersion }
  | { kind: 'blocked'; result: OaResult }
  | { kind: 'closed'; result: OaResult }
  | { kind: 'not_found'; result?: OaResult }
  | { kind: 'error'; message: string };

const CONCURRENCY = 3;

function query(pub: PublicationNode) {
  return { doi: pub.doi, title: pub.title, year: pub.year, author: pub.authors[0]?.family };
}

const safeName = (pub: PublicationNode) => `${(pub.bibKeys[0] ?? pub.label).replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60) || 'referencia'}.pdf`;
const doiUrl = (doi?: string) => (doi ? `https://doi.org/${doi}` : undefined);

/**
 * Searches free PDFs for the given references (3 at a time) and adds the ones found, each linked to its entry.
 * Exported so the "só o documento" upload flow runs exactly the same thing.
 */
export async function fetchOpenAccess(
  projectId: string,
  pubs: PublicationNode[],
  onState: (pubId: string, s: OaState) => void,
  onGraph?: (g: CitationGraph) => void,
): Promise<{ got: number; graph?: CitationGraph }> {
  const queue = pubs.filter((p) => p.doi || (p.title && p.title.length >= 8));
  for (const p of pubs) if (!queue.includes(p)) onState(p.id, { kind: 'not_found' });
  const files: { file: File; publicationId: string }[] = [];
  let i = 0;
  const worker = async () => {
    while (i < queue.length) {
      const pub = queue[i++];
      onState(pub.id, { kind: 'busy' });
      try {
        const r = await api.oaFetchPdf(query(pub), safeName(pub));
        if (r.file) {
          files.push({ file: r.file, publicationId: pub.id });
          onState(pub.id, { kind: 'got', source: r.source, host: r.host, version: r.version });
        } else if (r.result.status === 'oa') onState(pub.id, { kind: 'blocked', result: r.result });
        else if (r.result.status === 'closed') onState(pub.id, { kind: 'closed', result: r.result });
        else onState(pub.id, { kind: 'not_found', result: r.result });
      } catch (e) {
        onState(pub.id, { kind: 'error', message: (e as Error).message });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  if (!files.length) return { got: 0 };
  const graph = await api.addLinkedFiles(projectId, files);
  onGraph?.(graph);
  return { got: files.length, graph };
}

/** "Europe PMC · published version" (tooltip: host type and the catalogues that found it). */
function candidateLabel(t: Messages, c: Pick<OaCandidate, 'source' | 'version'>) {
  return `${c.source} · ${t.oaVersion[c.version]}`;
}
function candidateTitle(t: Messages, c: OaCandidate) {
  return `${t.oaHost[c.host]} · ${t.oaFoundVia(c.via.join(', '))}${c.license ? ` · ${c.license}` : ''}`;
}

function CandidateLink({ c, children }: { c: OaCandidate; children?: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <a className="oa-copy" href={c.url} target="_blank" rel="noreferrer noopener" title={candidateTitle(t, c)}>
      {children ?? candidateLabel(t, c)}
      <span className={`oa-chip oa-${c.host}`}>{t.oaHost[c.host]}</span>
    </a>
  );
}

/** Library link + "ask the author" for a work with no free copy (or none we could fetch). */
function NoFreeCopyActions({ result, pub }: { result?: OaResult; pub: PublicationNode }) {
  const { t } = useI18n();
  const prefix = useLibraryPrefix();
  const doi = result?.doi ?? pub.doi;
  const lib = libraryLink(prefix, { url: result?.landingUrl ?? doiUrl(doi), doi });
  const author = result?.contactName ?? result?.authors?.[0] ?? [pub.authors[0]?.given, pub.authors[0]?.family].filter(Boolean).join(' ');
  const mail = askAuthorMailto(t, { title: result?.title ?? pub.title, year: result?.year ?? pub.year, doi, email: result?.contactEmail, name: result?.contactEmail ? author : undefined });
  if (!lib && !mail) return null;
  return (
    <span className="oa-actions">
      {lib && (
        <a className="oa-btn" href={lib} target="_blank" rel="noreferrer noopener">
          {t.libraryLink}
        </a>
      )}
      {mail && (
        <a className="oa-btn" href={mail} title={result?.contactEmail ? t.askAuthorWithEmail : t.askAuthorNoEmail}>
          ✉ {t.askAuthor}
        </a>
      )}
    </span>
  );
}

export function OaCell({ state, pub }: { state?: OaState; pub: PublicationNode }) {
  const { t } = useI18n();
  if (!state) return null;
  switch (state.kind) {
    case 'busy':
      return (
        <span className="muted small">
          <span className="spinner" /> {t.lookingUp}
        </span>
      );
    case 'got':
      return (
        <span className="oa-tag ok">
          {t.freePdfGot(state.version ? candidateLabel(t, { source: state.source, version: state.version }) : state.source)}
        </span>
      );
    case 'blocked': {
      const r = state.result;
      const best = r.pdfUrls[0] ?? r.readUrls?.[0];
      const rest = [...r.pdfUrls, ...(r.readUrls ?? [])].filter((c) => c !== best).slice(0, 4);
      return (
        <span className="oa-cell">
          <span className="oa-tag">
            {t.freeButManual}{' '}
            <a href={best?.url ?? r.landingUrl ?? doiUrl(r.doi ?? pub.doi)} target="_blank" rel="noreferrer noopener">
              {r.pdfUrls[0] ? t.download : t.oaReadOnline}
            </a>
            {t.andSendHere}
          </span>
          {best && <CandidateLink c={best} />}
          {rest.length > 0 && (
            <details className="oa-more">
              <summary>{t.oaOtherCopies(rest.length)}</summary>
              {rest.map((c) => (
                <CandidateLink key={c.url} c={c} />
              ))}
            </details>
          )}
        </span>
      );
    }
    case 'closed': {
      const link = state.result.landingUrl ?? doiUrl(state.result.doi ?? pub.doi);
      return (
        <span className="oa-cell">
          <span className="oa-tag">
            {t.noFreePdf}
            {link && (
              <>
                {' · '}
                <a href={link} target="_blank" rel="noreferrer noopener">
                  {t.publisherPage}
                </a>
              </>
            )}
          </span>
          <NoFreeCopyActions result={state.result} pub={pub} />
        </span>
      );
    }
    case 'not_found':
      return (
        <span className="oa-cell">
          <span className="oa-tag">{t.notFoundInOpen}</span>
          <NoFreeCopyActions result={state.result} pub={pub} />
        </span>
      );
    case 'error':
      return <span className="oa-tag">{t.lookupFailed(translateRuntime(t, state.message))}</span>;
  }
}

/** Optional library/EZproxy prefix, stored in this browser only. */
export function LibraryAccess() {
  const { t } = useI18n();
  const prefix = useLibraryPrefix();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(prefix ?? '');
  const [note, setNote] = useState<{ ok: boolean; text: string } | undefined>();
  const save = (v: string) => {
    const ok = saveLibraryPrefix(v);
    setNote(ok ? (v.trim() ? { ok, text: t.librarySaved } : undefined) : { ok, text: t.libraryInvalid });
    if (ok && !v.trim()) setValue('');
  };
  return (
    <div className="library-access">
      <button className="soft small-btn" aria-expanded={open} onClick={() => { setOpen((o) => !o); setValue(prefix ?? ''); setNote(undefined); }}>
        🏛 {t.libraryAccess}
        {prefix && <span className="oa-dot" aria-hidden />}
      </button>
      {open && (
        <form
          className="library-panel"
          onSubmit={(e) => {
            e.preventDefault();
            save(value);
          }}
        >
          <label htmlFor="library-prefix">{t.libraryTitle}</label>
          <input
            id="library-prefix"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder={t.libraryPlaceholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <span className="muted small">{t.libraryHint}</span>
          <span className="library-row">
            <button type="submit" className="primary">
              {t.librarySave}
            </button>
            {prefix && (
              <button type="button" onClick={() => save('')}>
                {t.libraryRemove}
              </button>
            )}
            {note && <span className={`small ${note.ok ? 'oa-ok' : 'oa-bad'}`} role="status">{note.text}</span>}
          </span>
        </form>
      )}
    </div>
  );
}

interface Props {
  projectId: string;
  graph: CitationGraph;
  evidence?: EvidenceReport;
  oa: Record<string, OaState>;
  setOa: (fn: (prev: Record<string, OaState>) => Record<string, OaState>) => void;
  onGraph: (g: CitationGraph) => void;
  onOpen: (r: OpenRequest) => void;
  onShowInDocument: (pubId: string) => void;
  onShowInGraph: (pubId: string) => void;
}

export function ReferencesView({ projectId, graph, evidence, oa, setOa, onGraph, onOpen, onShowInDocument, onShowInGraph }: Props) {
  const { t } = useI18n();
  const rows = useMemo(() => refRows(graph, evidence), [graph, evidence]);
  const [filter, setFilter] = useState<RefStatus | 'all'>('all');
  const [busy, setBusy] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const uploadFor = useRef<PublicationNode | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

  const counts = useMemo(() => Object.fromEntries(REF_STATUS_ORDER.map((s) => [s, rows.filter((r) => r.status === s).length])) as Record<RefStatus, number>, [rows]);
  const withoutPdf = rows.filter((r) => !r.hasPdf);
  const shown = filter === 'all' ? rows : rows.filter((r) => r.status === filter);

  const runOa = async () => {
    setBusy('oa');
    setMessage(undefined);
    try {
      const { got } = await fetchOpenAccess(projectId, withoutPdf.map((r) => r.pub), (id, s) => setOa((prev) => ({ ...prev, [id]: s })), onGraph);
      setMessage(got ? t.oaAdded(got) : t.oaNone);
    } catch (e) {
      setMessage(translateRuntime(t, (e as Error).message));
    } finally {
      setBusy(undefined);
    }
  };

  const onPick = async (files: FileList | null) => {
    const pub = uploadFor.current;
    const file = files?.[0];
    if (!pub || !file) return;
    setBusy(pub.id);
    try {
      onGraph(await api.addLinkedFiles(projectId, [{ file, publicationId: pub.id }]));
      setOa((prev) => {
        const next = { ...prev };
        delete next[pub.id];
        return next;
      });
    } catch (e) {
      setMessage(translateRuntime(t, (e as Error).message));
    } finally {
      setBusy(undefined);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  if (!rows.length) {
    return (
      <div className="refs-view">
        <div className="empty-card">
          <h2>{t.noReferencesYet}</h2>
          <p className="muted">{t.noReferencesHint}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="refs-view">
      <div className="refs-head">
        <div className="chip-row" role="group" aria-label={t.filterBySituation}>
          <button className={`chip-filter${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>
            {t.all} <b>{rows.length}</b>
          </button>
          {REF_STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => (
            <button key={s} className={`chip-filter rs-${s}${filter === s ? ' on' : ''}`} onClick={() => setFilter(s)}>
              <i className={`dot rs-${s}`} /> {refStatusText(t, s)} <b>{counts[s]}</b>
            </button>
          ))}
        </div>
        {withoutPdf.length > 0 && (
          <div className="refs-oa">
            <button className="primary" disabled={Boolean(busy)} onClick={runOa}>
              {busy === 'oa' ? t.searchingFreePdfs : t.searchFreePdfs(withoutPdf.length)}
            </button>
            <span className="muted small">{t.oaPrivacyHint}</span>
            <LibraryAccess />
          </div>
        )}
      </div>
      {message && (
        <div className="notice ok" onClick={() => setMessage(undefined)}>
          {message}
        </div>
      )}
      <input ref={fileInput} type="file" accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" hidden onChange={(e) => onPick(e.target.files)} />
      <table className="refs-table">
        <thead>
          <tr>
            <th>{t.colReference}</th>
            <th>{t.colStatus}</th>
            <th title={t.colCitationsTitle}>{t.colCitations}</th>
            <th>{t.colSourcePdf}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <RefLine
              key={r.pub.id}
              row={r}
              oa={oa[r.pub.id]}
              busy={busy === r.pub.id}
              onUpload={() => {
                uploadFor.current = r.pub;
                fileInput.current?.click();
              }}
              onOpenPdf={() => onOpen({ anchor: { fileId: r.pub.fileIds[0], page: 1 }, title: r.pub.label })}
              onShowInDocument={() => onShowInDocument(r.pub.id)}
              onShowInGraph={() => onShowInGraph(r.pub.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RefLine({ row, oa, busy, onUpload, onOpenPdf, onShowInDocument, onShowInGraph }: { row: RefRow; oa?: OaState; busy: boolean; onUpload: () => void; onOpenPdf: () => void; onShowInDocument: () => void; onShowInGraph: () => void }) {
  const { t } = useI18n();
  const { pub, counts } = row;
  const authors = pub.authors.slice(0, 3).map((a) => a.family).join(', ') + (pub.authors.length > 3 ? ' et al.' : '');
  return (
    <tr className={`rs-row rs-${row.status}`}>
      <td>
        <div className="ref-label">{pub.label}</div>
        <div className="muted small ref-title" title={pub.title}>
          {pub.title ?? authors}
          {pub.doi && (
            <>
              {' · '}
              <a href={doiUrl(pub.doi)} target="_blank" rel="noreferrer noopener">
                DOI
              </a>
            </>
          )}
        </div>
      </td>
      <td>
        <span className={`pill rs-${row.status}`}>{refStatusText(t, row.status)}</span>
        {row.manual > 0 && <span className="tag-manual" title={t.youLabeledSome}> ✎ {row.manual}</span>}
      </td>
      <td className="ref-counts">
        {row.citations === 0 ? (
          <span className="muted small">—</span>
        ) : (
          <button className="link-btn" onClick={onShowInDocument} title={t.seeTheseInDocument}>
            <span className="cnt ok">{counts.localizado}</span> · <span className="cnt warn">{counts.ressalva}</span> · <span className="cnt nl">{counts.nao_localizado}</span>
            {row.citations > counts.localizado + counts.ressalva + counts.nao_localizado && <span className="muted">{t.extraNoPdf(row.citations - counts.localizado - counts.ressalva - counts.nao_localizado)}</span>}
          </button>
        )}
        <button className="link-btn small" onClick={onShowInGraph}>
          {t.graphShort}
        </button>
      </td>
      <td>
        {row.hasPdf ? (
          <button onClick={onOpenPdf}>{t.openPdf}</button>
        ) : (
          <div className="ref-pdf">
            <button disabled={busy} onClick={onUpload}>
              {busy ? t.sending : t.sendPdf}
            </button>
            <OaCell state={oa} pub={pub} />
          </div>
        )}
      </td>
    </tr>
  );
}
