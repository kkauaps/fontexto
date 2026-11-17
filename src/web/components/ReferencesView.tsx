import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { EvidenceReport } from '../../core/evidence';
import type { CitationGraph, PublicationNode } from '../../core/model';
import { REF_STATUS_ORDER, refRows, type RefRow, type RefStatus } from '../../core/refStatus';
import { api, type OaCandidate, type OaHost, type OaResult, type OaVersion } from '../api';
import type { OpenRequest } from './SidePanel';
import { refStatusText, translateRuntime, useI18n, type Messages } from '../i18n';
import { OA_CATALOGS_BUSY } from '../i18n/runtime';
import { libraryLink, saveLibraryPrefix, useLibraryPrefix } from '../library';
import { extensionAvailable, fetchWithMyAccess, MY_ACCESS_SOURCE, useExtensionAvailable } from '../extension';
import { askAuthorMailto } from '../askAuthor';
import { makePacer, OA_DEFAULT_CONCURRENCY, OA_MIN_GAP_MS, OA_REQUEST_TIMEOUT_MS, OaDeadline, oaBatchLookup, oaEligible, oaQueryFromPub, runOaQueue, timeoutSignal, withRetry } from '../../core/oaClient';

/** Outcome of the free-PDF search for one reference (kept for the session only). */
export type OaState =
  | { kind: 'busy' }
  | { kind: 'got'; source: string; host?: OaHost; version?: OaVersion }
  | { kind: 'blocked'; result: OaResult }
  | { kind: 'closed'; result: OaResult }
  | { kind: 'not_found'; result?: OaResult }
  | { kind: 'error'; message: string };

export { arxivFromPub, makePacer, withRetry } from '../../core/oaClient';

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
  const queue = pubs.filter(oaEligible);
  // last state of each reference, to retry the ones without a PDF through the reader's own access afterwards
  const last = new Map<string, OaState>();
  const report = onState;
  onState = (pubId, s) => {
    last.set(pubId, s);
    report(pubId, s);
  };
  for (const p of pubs) if (!queue.includes(p)) onState(p.id, { kind: 'not_found' });
  const files: { file: File; publicationId: string }[] = [];
  try {
    // metadata batch is an optimisation with its own short budget and no retries; /api/oa/pdf still resolves each ref
    await oaBatchLookup(queue.map(oaQueryFromPub));
  } catch {
    /* ignore */
  }
  const pace = makePacer(OA_MIN_GAP_MS);
  await runOaQueue(queue, {
    concurrency: OA_DEFAULT_CONCURRENCY,
    onStart: (pub) => onState(pub.id, { kind: 'busy' }),
    run: (pub, signal) =>
      withRetry(async () => {
        await pace();
        if (signal.aborted) throw new OaDeadline();
        return api.oaFetchPdf(oaQueryFromPub(pub), safeName(pub), timeoutSignal(OA_REQUEST_TIMEOUT_MS, signal));
      }),
    onDone: (pub, r) => {
      if (r.file) {
        files.push({ file: r.file, publicationId: pub.id });
        onState(pub.id, { kind: 'got', source: r.source, host: r.host, version: r.version });
      } else if (r.result.status === 'oa') onState(pub.id, { kind: 'blocked', result: r.result });
      else if (r.result.status === 'closed') onState(pub.id, { kind: 'closed', result: r.result });
      // "not found" while catalogues were throttled or down is not an answer: say so instead of "not identified"
      else if (r.result.sources?.some((x) => x.status === 'rate_limited' || x.status === 'timeout' || x.status === 'error')) onState(pub.id, { kind: 'error', message: OA_CATALOGS_BUSY });
      else onState(pub.id, { kind: 'not_found', result: r.result });
    },
    // a reference that ran out of time is "catalogues busy, try again", not a raw error string
    onError: (pub, e) => onState(pub.id, { kind: 'error', message: e instanceof OaDeadline || e.name === 'TimeoutError' || e.name === 'AbortError' ? OA_CATALOGS_BUSY : e.message }),
  });
  // Extension installed: what the open catalogues could not give, try with the reader's own access (one at a time:
  // it is their browser and their library's session)
  if (extensionAvailable()) {
    for (const pub of pubs) {
      const prev = last.get(pub.id);
      if (prev?.kind === 'got') continue;
      const doi = (prev && 'result' in prev ? prev.result?.doi : undefined) ?? pub.doi;
      if (!doi) continue;
      onState(pub.id, { kind: 'busy' });
      const file = await fetchWithMyAccess(doi, safeName(pub));
      if (file) {
        files.push({ file, publicationId: pub.id });
        onState(pub.id, { kind: 'got', source: MY_ACCESS_SOURCE });
      } else onState(pub.id, prev ?? { kind: 'not_found' });
    }
  }
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
    <a className="oa-copy" href={c.url} target="_blank" rel="noreferrer noopener" title={`${candidateLabel(t, c)} · ${candidateTitle(t, c)}`}>
      <span className="oa-copy-text">{children ?? candidateLabel(t, c)}</span>
      <span className={`oa-chip oa-${c.host}`}>{t.oaHost[c.host]}</span>
    </a>
  );
}

const OPEN_LIBRARY_EVENT = 'fontexto:open-library';

/** Provided by the References view: downloads one reference's PDF through the extension and links it. */
const MyAccessContext = createContext<((pub: PublicationNode, doi: string) => Promise<boolean>) | undefined>(undefined);

/** "Download with my access" for one reference (only with the extension installed and inside the References view). */
function ExtensionFetch({ pub, doi }: { pub: PublicationNode; doi?: string }) {
  const { t } = useI18n();
  const installed = useExtensionAvailable();
  const run = useContext(MyAccessContext);
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
  if (!installed || !run || !doi) return null;
  if (state === 'busy')
    return (
      <span className="oa-btn" aria-live="polite">
        <span className="spinner" /> {t.extFetching}
      </span>
    );
  return (
    <>
      <button
        type="button"
        className="oa-btn"
        onClick={async () => {
          setState('busy');
          setState((await run(pub, doi)) ? 'idle' : 'failed');
        }}
      >
        🔑 {t.extFetch}
      </button>
      {state === 'failed' && <span className="oa-bad small">{t.extFailed}</span>}
    </>
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
  return (
    <>
      {lib ? (
        <a className="oa-btn" href={lib} target="_blank" rel="noreferrer noopener">
          🏛 {t.libraryLink}
        </a>
      ) : (
        // not set up yet: most paywalled works open through the university's subscription
        <button type="button" className="oa-btn" onClick={() => window.dispatchEvent(new Event(OPEN_LIBRARY_EVENT))}>
          🏛 {t.libraryPrompt}
        </button>
      )}
      <ExtensionFetch pub={pub} doi={doi} />
      {mail && (
        <a className="oa-btn" href={mail} title={result?.contactEmail ? t.askAuthorWithEmail : t.askAuthorNoEmail}>
          ✉ {t.askAuthor}
        </a>
      )}
    </>
  );
}

/**
 * Result of the free-PDF lookup for one entry, always in the same two lines:
 * one muted line saying what was found, then the secondary actions as small pills on one line.
 */
export function OaCell({ state, pub }: { state?: OaState; pub: PublicationNode }) {
  const { t } = useI18n();
  if (!state) return null;
  const cell = (info: React.ReactNode, actions?: React.ReactNode, title?: string) => (
    <div className="oa-cell">
      <div className="oa-src" title={title}>
        {info}
      </div>
      {actions && <div className="oa-actions">{actions}</div>}
    </div>
  );
  switch (state.kind) {
    case 'busy':
      return cell(
        <>
          <span className="spinner" /> {t.lookingUp}
        </>,
      );
    case 'got':
      if (state.source === MY_ACCESS_SOURCE) return cell(<span className="oa-ok">✓ PDF · {t.extGot}</span>);
      return cell(<span className="oa-ok">{t.freePdfGot(state.version ? candidateLabel(t, { source: state.source, version: state.version }) : state.source)}</span>);
    case 'blocked': {
      const r = state.result;
      const best = r.pdfUrls[0] ?? r.readUrls?.[0];
      const rest = [...r.pdfUrls, ...(r.readUrls ?? [])].filter((c) => c !== best).slice(0, 4);
      const href = best?.url ?? r.landingUrl ?? doiUrl(r.doi ?? pub.doi);
      return cell(
        best ? (
          <>
            <span className="oa-src-k">{t.freeCopyFrom}</span> <CandidateLink c={best} />
          </>
        ) : (
          t.freeCopyManual
        ),
        <>
          {href && (
            <a className="oa-btn" href={href} target="_blank" rel="noreferrer noopener" title={t.freeCopyManual}>
              ⬇ {r.pdfUrls[0] ? t.downloadPdf : t.oaReadOnline}
            </a>
          )}
          {rest.length > 0 && (
            <details className="oa-more">
              <summary className="oa-btn">{t.oaOtherCopies(rest.length)}</summary>
              <div className="oa-more-list">
                {rest.map((c) => (
                  <CandidateLink key={c.url} c={c} />
                ))}
              </div>
            </details>
          )}
        </>,
        t.freeCopyManual,
      );
    }
    case 'closed': {
      const link = state.result.landingUrl ?? doiUrl(state.result.doi ?? pub.doi);
      return cell(
        t.noFreePdf,
        <>
          {link && (
            <a className="oa-btn" href={link} target="_blank" rel="noreferrer noopener">
              ↗ {t.publisherPage}
            </a>
          )}
          <NoFreeCopyActions result={state.result} pub={pub} />
        </>,
      );
    }
    case 'not_found':
      return cell(t.notFoundInOpen, <NoFreeCopyActions result={state.result} pub={pub} />);
    case 'error':
      return cell(<span className="oa-bad">{t.lookupFailed(translateRuntime(t, state.message))}</span>);
  }
}

/**
 * Optional library/EZproxy prefix, stored in this browser only.
 * `popover`: the settings float under the button (References toolbar) instead of pushing the page down.
 */
export function LibraryAccess({ popover = false }: { popover?: boolean }) {
  const { t } = useI18n();
  const prefix = useLibraryPrefix();
  const [open, setOpen] = useState(false);
  // "Access through your university?" on a reference without a free copy opens these settings
  useEffect(() => {
    const show = () => {
      setOpen(true);
      requestAnimationFrame(() => root.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    };
    window.addEventListener(OPEN_LIBRARY_EVENT, show);
    return () => window.removeEventListener(OPEN_LIBRARY_EVENT, show);
  }, []);
  const [value, setValue] = useState(prefix ?? '');
  const [note, setNote] = useState<{ ok: boolean; text: string } | undefined>();
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const save = (v: string) => {
    const ok = saveLibraryPrefix(v);
    setNote(ok ? (v.trim() ? { ok, text: t.librarySaved } : undefined) : { ok, text: t.libraryInvalid });
    if (ok && !v.trim()) setValue('');
  };
  useEffect(() => {
    if (!popover || !open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      toggle.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [popover, open]);
  return (
    <div ref={root} className={`library-access${popover ? ' is-popover' : ''}`}>
      <button
        ref={toggle}
        className={`${popover ? '' : 'soft '}small-btn${open ? ' on' : ''}`}
        aria-expanded={open}
        aria-controls="library-panel"
        onClick={() => {
          setOpen((o) => !o);
          setValue(prefix ?? '');
          setNote(undefined);
        }}
      >
        🏛 {t.libraryAccess}
        {prefix && <span className="oa-dot" aria-hidden />}
      </button>
      {open && (
        <form
          id="library-panel"
          className="library-panel"
          role={popover ? 'dialog' : undefined}
          aria-label={popover ? t.libraryTitle : undefined}
          onSubmit={(e) => {
            e.preventDefault();
            save(value);
          }}
        >
          <div className="library-head">
            <label htmlFor="library-prefix">{t.libraryTitle}</label>
            {popover && (
              <button type="button" className="library-x" aria-label={t.close} title={t.close} onClick={() => setOpen(false)}>
                ×
              </button>
            )}
          </div>
          <div className="library-input-row">
            <input
              id="library-prefix"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              autoFocus={popover}
              placeholder={t.libraryPlaceholder}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <button type="submit" className="primary">
              {t.librarySave}
            </button>
          </div>
          <span className="muted small">{t.libraryHint}</span>
          {(prefix || note) && (
            <span className="library-row">
              {prefix && (
                <button type="button" className="link-btn small" onClick={() => save('')}>
                  {t.libraryRemove}
                </button>
              )}
              {note && <span className={`small ${note.ok ? 'oa-ok' : 'oa-bad'}`} role="status">{note.text}</span>}
            </span>
          )}
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

  const myAccess = useCallback(
    async (pub: PublicationNode, doi: string) => {
      const file = await fetchWithMyAccess(doi, safeName(pub));
      if (!file) return false;
      onGraph(await api.addLinkedFiles(projectId, [{ file, publicationId: pub.id }]));
      setOa((prev) => ({ ...prev, [pub.id]: { kind: 'got', source: MY_ACCESS_SOURCE } }));
      return true;
    },
    [projectId, onGraph, setOa],
  );

  return (
    <MyAccessContext.Provider value={myAccess}>
    <div className="refs-view">
      <div className="refs-toolbar">
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
            <LibraryAccess popover />
            <button className="primary refs-oa-btn" disabled={Boolean(busy)} onClick={runOa} aria-describedby="oa-privacy">
              {busy === 'oa' ? t.searchingFreePdfs : t.searchFreePdfs(withoutPdf.length)}
            </button>
            <span className="info-tip">
              <button type="button" className="info-tip-btn" aria-label={t.oaPrivacyLabel} aria-describedby="oa-privacy">
                i
              </button>
              <span id="oa-privacy" role="tooltip" className="info-tip-body">
                {t.oaPrivacyHint}
              </span>
            </span>
          </div>
        )}
      </div>
      {message && (
        <div className="notice ok refs-banner" role="status" onClick={() => setMessage(undefined)}>
          {message}
        </div>
      )}
      <input ref={fileInput} type="file" accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" hidden onChange={(e) => onPick(e.target.files)} />
      <table className="refs-table">
        <thead>
          <tr>
            <th className="col-ref">{t.colReference}</th>
            <th className="col-status">{t.colStatus}</th>
            <th className="col-cites" title={t.colCitationsTitle}>
              {t.colCitations}
            </th>
            <th className="col-pdf">{t.colSourcePdf}</th>
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
    </MyAccessContext.Provider>
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
      <td className="ref-pdf-cell">
        <div className="ref-pdf">
          {row.hasPdf ? (
            <button className="ref-pdf-main" onClick={onOpenPdf}>
              {t.openPdf}
            </button>
          ) : (
            <button className="ref-pdf-main" disabled={busy} onClick={onUpload}>
              {busy ? t.sending : t.sendPdf}
            </button>
          )}
          {(!row.hasPdf || oa?.kind === 'got') && <OaCell state={oa} pub={pub} />}
        </div>
      </td>
    </tr>
  );
}
