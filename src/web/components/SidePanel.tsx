import { type RefRow } from '../../core/refStatus';
import { useState } from 'react';
import { UNCATEGORIZED, type CategoryRule } from '../../core/categories';
import type { Anchor, CitationGraph, GraphEdge, GraphNode, PublicationNode, ReviewAction } from '../../core/model';
import { MAIN_DOCUMENT_ID } from '../../core/pipeline';
import { citationLists, type ViewEdge } from '../../core/view';
import { categoryLabel, formatDateTime, methodLabel, refStatusText, reviewActionLabel, translateRuntime, useI18n, verificationHelp, verificationLabel } from '../i18n';
import type { Selection } from './GraphCanvas';

export interface OpenRequest {
  anchor: Anchor;
  title: string;
  context?: string;
  /** Text to find and highlight on the opened page (via the pdf.js text layer). */
  phrase?: string;
  /** The citing sentence from the main document, shown while reading the reference. */
  citing?: string;
  /** All passages found for the same citation (this request included), to switch between them in the viewer. */
  alternatives?: { label: string; request: OpenRequest }[];
  /** Index of this request inside `alternatives`. */
  altIndex?: number;
}

interface Props {
  graph: CitationGraph;
  selection: Selection;
  viewEdges: ViewEdge[];
  rules: CategoryRule[];
  onClose: () => void;
  onSelect: (s: Selection) => void;
  onOpen: (r: OpenRequest) => void;
  /** Citations of the main document per publication id (from the evidence report). */
  docCitations?: Map<string, number>;
  onShowInDocument: (pubId: string) => void;
  onReview: (edgeId: string, action: ReviewAction) => Promise<void>;
  onCategory: (pubId: string, value: string | null | undefined) => Promise<void>;
  /** Verification summary per publication (same data as the Referências tab). */
  refRows?: Map<string, RefRow>;
}

const label = (g: CitationGraph, id: string) => g.nodes[id]?.label ?? id;

function Value({ v, children }: { v: unknown; children?: React.ReactNode }) {
  const { t } = useI18n();
  if (v === undefined || v === null || v === '') return <span className="unavailable">{t.unavailable}</span>;
  return <>{children ?? String(v)}</>;
}

function StatusBadge({ status }: { status: GraphEdge['status'] }) {
  const { t } = useI18n();
  return (
    <span className={`badge status-${status}`} title={verificationHelp(t, status)}>
      {verificationLabel(t, status)}
    </span>
  );
}

function EdgeLink({ g, e, dir, onSelect }: { g: CitationGraph; e: GraphEdge; dir: 'out' | 'in'; onSelect: Props['onSelect'] }) {
  const { t } = useI18n();
  const other = dir === 'out' ? e.target : e.source;
  return (
    <li>
      <button className="linklike" onClick={() => onSelect({ type: 'node', id: other })}>
        {label(g, other)}
      </button>{' '}
      <button className="linklike small" onClick={() => onSelect({ type: 'edge', id: e.id })} title={t.seeRelationEvidence}>
        <StatusBadge status={e.status} />
      </button>
    </li>
  );
}

function PublicationDetails({ g, pub, props }: { g: CitationGraph; pub: PublicationNode; props: Props }) {
  const { t, locale } = useI18n();
  const { cites, citedBy } = citationLists(g, pub.id);
  const related = Object.values(g.edges).filter((e) => e.kind === 'related_to' && (e.source === pub.id || e.target === pub.id) && e.status !== 'rejected');
  const docEdge = g.edges[`cites:${MAIN_DOCUMENT_ID}->${pub.id}`];
  const markers = docEdge?.provenance.flatMap((p) => p.citationAnchors ?? []) ?? [];
  const claims = Object.values(g.edges).filter((e) => e.kind === 'references' && e.target === pub.id);
  const fileId = pub.fileIds[0];
  const [custom, setCustom] = useState('');
  const categoryOptions = [...new Set([...props.rules.map((r) => r.name), ...(pub.category ? [pub.category.value] : [])])];

  return (
    <>
      <h2 className="pub-title">
        <Value v={pub.title} />
      </h2>
      {props.refRows?.get(pub.id) && (() => {
        const r = props.refRows!.get(pub.id)!;
        return (
          <div className="side-status">
            <span className={`pill rs-${r.status}`}>{refStatusText(t, r.status)}</span>{' '}
            {r.citations > 0 && (
              <span className="small">
                {t.citationsInTextSummary(r.citations, r.counts.localizado, r.counts.ressalva, r.counts.nao_localizado)}
              </span>
            )}
            {r.citations > 0 && (
              <div>
                <button className="primary" onClick={() => props.onShowInDocument(pub.id)}>
                  {t.checkInDocument}
                </button>
              </div>
            )}
          </div>
        );
      })()}
      <dl className="meta">
        <dt>{t.authors}</dt>
        <dd>
          <Value v={pub.authors.length ? 1 : undefined}>{pub.authors.map((a) => a.raw).join('; ')}</Value>
        </dd>
        <dt>{t.year}</dt>
        <dd>
          <Value v={pub.yearLabel ?? pub.year} />
        </dd>
        <dt>DOI</dt>
        <dd>
          <Value v={pub.doi}>
            <a href={`https://doi.org/${pub.doi}`} target="_blank" rel="noreferrer noopener">
              {pub.doi}
            </a>
          </Value>
        </dd>
        <dt>{t.vehicle}</dt>
        <dd>
          <Value v={pub.venue} />
        </dd>
        <dt>{t.abstract}</dt>
        <dd className="abstract">
          <Value v={pub.abstract} />
        </dd>
        <dt>{t.category}</dt>
        <dd>
          <div className="cat-pick">
          <select
            value={pub.category?.value ?? UNCATEGORIZED}
            onChange={(e) => props.onCategory(pub.id, e.target.value === UNCATEGORIZED ? null : e.target.value)}
          >
            <option value={UNCATEGORIZED}>{t.uncategorized}</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(t, c)}
              </option>
            ))}
          </select>
          {pub.category?.source === 'suggested' && (
            <span className="badge suggested" title={t.keywordsTitle(pub.category.matched?.join(', ') ?? '')}>
              {t.suggestedBadge}
            </span>
          )}
          {pub.category?.source === 'user' && (
            <button className="linklike small" onClick={() => props.onCategory(pub.id, undefined)}>
              {t.restoreSuggestion}
            </button>
          )}
          </div>
          <div className="row">
            <input placeholder={t.newCategory} value={custom} onChange={(e) => setCustom(e.target.value)} />
            <button disabled={!custom.trim()} onClick={() => props.onCategory(pub.id, custom.trim()).then(() => setCustom(''))}>
              {t.setCategory}
            </button>
          </div>
        </dd>
        <dt>{t.connections}</dt>
        <dd>
          {t.citesCount(cites.length, citedBy.length)}
        </dd>
        <dt>{t.metadataSources}</dt>
        <dd className="small">{pub.metadataSources.map((s) => `${s.kind}${s.ref ? ` (${s.ref})` : ''}: ${s.fields.join(', ') || '—'}`).join(' · ') || t.unavailable}</dd>
      </dl>

      <div className="actions">
        {fileId ? (
          <button className="primary" onClick={() => props.onOpen({ anchor: { fileId, page: 1 }, title: pub.label })}>
            {t.openPdf}
          </button>
        ) : (
          <span className="muted small">{t.noPdfThisSource}</span>
        )}
      </div>

      <h4>{t.citesHeading(cites.length)}</h4>
      {cites.length ? <ul className="list">{cites.map((e) => <EdgeLink key={e.id} g={g} e={e} dir="out" onSelect={props.onSelect} />)}</ul> : <p className="muted small">{fileId ? t.noRefsFoundInNetwork : t.bibliographyNotAnalyzed}</p>}

      <h4>{t.citedByHeading(citedBy.length)}</h4>
      {citedBy.length ? <ul className="list">{citedBy.map((e) => <EdgeLink key={e.id} g={g} e={e} dir="in" onSelect={props.onSelect} />)}</ul> : <p className="muted small">{t.none}</p>}

      {related.length > 0 && (
        <>
          <h4>{t.thematicRelations(related.length)}</h4>
          <p className="hint">{t.doNotIndicateCitation}</p>
          <ul className="list">
            {related.map((e) => (
              <EdgeLink key={e.id} g={g} e={e} dir={e.source === pub.id ? 'out' : 'in'} onSelect={props.onSelect} />
            ))}
          </ul>
        </>
      )}

      <h4>{t.inMainDocument}</h4>
      {claims.length > 0 && (
        <ul className="list">
          {claims.map((e) => (
            <li key={e.id}>{label(g, e.source)}</li>
          ))}
        </ul>
      )}
      {!props.refRows && (props.docCitations?.get(pub.id) ?? 0) > 0 && (
        <button className="primary" onClick={() => props.onShowInDocument(pub.id)}>
          {t.seeNCitations(props.docCitations!.get(pub.id)!)}
        </button>
      )}
      {markers.length > 0 ? (
        <>
          <p className="small">{t.citedOnPages(new Set(markers.map((m) => m.page)).size)}</p>
          <ul className="chips">
            {markers.map((m, i) => (
              <li key={i}>
                <button
                  className="chip"
                  title={m.text}
                  onClick={() => props.onOpen({ anchor: m, title: label(g, MAIN_DOCUMENT_ID), context: t.citationMarkOf(pub.label, m.text ?? "") })}
                >
                  {t.pageAbbr} {m.page}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : docEdge ? (
        <p className="muted small">{t.noMarkerFound}{g.nodes[MAIN_DOCUMENT_ID]?.kind === 'document' && (g.nodes[MAIN_DOCUMENT_ID] as { fileId?: string }).fileId ? '' : t.mainPdfMissing}.</p>
      ) : null}
    </>
  );
}

function EdgeDetails({ g, edge, props }: { g: CitationGraph; edge: GraphEdge; props: Props }) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const review = async (a: ReviewAction) => {
    setBusy(true);
    try {
      await props.onReview(edge.id, a);
    } finally {
      setBusy(false);
    }
  };
  const isCites = edge.kind === 'cites';
  const docCount = isCites && edge.source === MAIN_DOCUMENT_ID ? (props.docCitations?.get(edge.target) ?? 0) : 0;
  return (
    <>
      <h2>
        {isCites ? t.citation : edge.kind === 'related_to' ? t.thematicRelation : edge.kind}
      </h2>
      {docCount > 0 && (
        <button className="primary" onClick={() => props.onShowInDocument(edge.target)}>
          {t.seeNCitations(docCount)}
        </button>
      )}
      <p className="edge-ends">
        <button className="linklike" onClick={() => props.onSelect({ type: 'node', id: edge.source })}>
          {label(g, edge.source)}
        </button>{' '}
        {edge.kind === 'related_to' ? '↔' : '→'}{' '}
        <button className="linklike" onClick={() => props.onSelect({ type: 'node', id: edge.target })}>
          {label(g, edge.target)}
        </button>
      </p>
      <p>
        <StatusBadge status={edge.status} /> <span className="small muted">{verificationHelp(t, edge.status)}</span>
      </p>

      <h4>{t.provenance}</h4>
      {edge.provenance.map((p, i) => (
        <div key={i} className="prov">
          <div className="prov-method">{methodLabel(t, p.method)}</div>
          {p.matchedBy?.length ? <div className="small">{t.matchingFields(p.matchedBy.join(', '))}</div> : null}
          {p.bibliographicId && <div className="small">{t.identifier}{p.bibliographicId}</div>}
          {p.referenceText && (
            <blockquote>
              {p.referenceText}
              {p.referenceAnchor && (
                <div>
                  <button
                    className="linklike small"
                    onClick={() =>
                      props.onOpen({
                        anchor: p.referenceAnchor!,
                        title: label(g, edge.source),
                        context: t.bibEntryContext(label(g, edge.source), label(g, edge.target)),
                      })
                    }
                  >
                    {t.openInBibliography(p.referenceAnchor.page)}
                  </button>
                </div>
              )}
            </blockquote>
          )}
          {p.citationAnchors?.length ? (
            <div>
              <div className="small">{t.markersInText}</div>
              <ul className="chips">
                {p.citationAnchors.map((a, j) => (
                  <li key={j}>
                    <button className="chip" title={a.text} onClick={() => props.onOpen({ anchor: a, title: label(g, edge.source), context: t.markerContext(a.text ?? "") })}>
                      {t.pageAbbr} {a.page}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {p.method === 'bibliographic_coupling' && p.text && (
            <div className="small">{t.sharedReferences(p.text.split(', ').map((id) => label(g, id)).join('; '))}</div>
          )}
          {p.notes?.map((n, j) => (
            <div key={j} className="small muted">
              {translateRuntime(t, n)}
            </div>
          ))}
        </div>
      ))}

      {edge.reviews?.length ? (
        <>
          <h4>{t.reviews}</h4>
          <ul className="list small">
            {edge.reviews.map((r, i) => (
              <li key={i}>
                {t.reviewLine(formatDateTime(locale, r.at), reviewActionLabel(t, r.action), verificationLabel(t, r.from), verificationLabel(t, r.to))}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <div className="actions">
        {(edge.status === 'unverified' || edge.status === 'suggested' || (edge.status === 'rejected' && isCites)) && (
          <button className="primary" disabled={busy} onClick={() => review('confirm')}>
            {edge.kind === 'related_to' ? t.agreeThematic : t.confirmCitation}
          </button>
        )}
        {edge.status !== 'rejected' && edge.source !== MAIN_DOCUMENT_ID && (
          <button className="danger" disabled={busy} onClick={() => review('reject')}>
            {t.reject}
          </button>
        )}
        {edge.reviews?.length ? (
          <button disabled={busy} onClick={() => review('reset')}>
            {t.undoReviews}
          </button>
        ) : null}
      </div>
    </>
  );
}

function AggregatedEdge({ g, ve, props }: { g: CitationGraph; ve: ViewEdge; props: Props }) {
  const { t } = useI18n();
  return (
    <>
      <h2>{t.aggregatedRelations(ve.count)}</h2>
      <ul className="list">
        {ve.memberIds.map((id) => {
          const e = g.edges[id];
          return e ? (
            <li key={id}>
              <button className="linklike" onClick={() => props.onSelect({ type: 'edge', id })}>
                {label(g, e.source)} → {label(g, e.target)}
              </button>{' '}
              <StatusBadge status={e.status} />
            </li>
          ) : null;
        })}
      </ul>
    </>
  );
}

export function SidePanel(props: Props) {
  const { t } = useI18n();
  const { graph: g, selection } = props;
  if (!selection) return null;
  let body: React.ReactNode = null;
  if (selection.type === 'node') {
    const n: GraphNode | undefined = g.nodes[selection.id];
    if (n?.kind === 'publication') body = <PublicationDetails key={n.id} g={g} pub={n} props={props} />;
    else if (n?.kind === 'document') {
      const { cites } = citationLists(g, n.id);
      body = (
        <>
          <h2>{n.label}</h2>
          <p className="small muted">{t.declaredReferences(cites.length)}</p>
          <div className="actions">
            {n.fileId ? (
              <button className="primary" onClick={() => props.onOpen({ anchor: { fileId: n.fileId!, page: 1 }, title: n.label })}>
                {t.openPdf}
              </button>
            ) : (
              <button disabled>{t.mainPdfUnavailable}</button>
            )}
          </div>
          <h4>Referências</h4>
          <ul className="list">{cites.map((e) => <EdgeLink key={e.id} g={g} e={e} dir="out" onSelect={props.onSelect} />)}</ul>
        </>
      );
    } else if (selection.id.startsWith('group:')) {
      body = <p>{t.collapsedGroup}</p>;
    }
  } else {
    const e = g.edges[selection.id];
    const ve = props.viewEdges.find((x) => x.id === selection.id);
    if (e) body = <EdgeDetails key={e.id + e.status} g={g} edge={e} props={props} />;
    else if (ve) body = <AggregatedEdge g={g} ve={ve} props={props} />;
  }
  return (
    <aside className="sidepanel">
      <button className="close" onClick={props.onClose} aria-label={t.closePanel}>
        ×
      </button>
      {body ?? <p className="muted">{t.notFoundElement}</p>}
    </aside>
  );
}
