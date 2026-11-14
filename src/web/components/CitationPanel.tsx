import type { CitationOccurrence, EvidenceStatus } from '../../core/evidence';
import type { CitationGraph, PublicationNode } from '../../core/model';
import { passageParts, occurrenceStatus, type CitationGroup } from '../../core/evidenceView';
import type { OpenRequest } from './SidePanel';
import { evidenceStatusText, reasonText, translateRuntime, useI18n, type Messages } from '../i18n';

function StatusPill({ o }: { o: CitationOccurrence }) {
  const { t } = useI18n();
  const s = occurrenceStatus(o);
  return (
    <>
      <span className={`pill st-${s}`}>{evidenceStatusText(t, s)}</span>
      {o.override && (
        <span className="tag tag-manual" title={t.labeledByYouTitle(o.override.auto ? evidenceStatusText(t, o.override.auto) : '—')}>
          {t.labeledByYou}
        </span>
      )}
      {o.curated && (
        <span className="tag tag-curated" title={t.curatedTitle(o.curated.source, o.curated.autoStatus ? evidenceStatusText(t, o.curated.autoStatus) : undefined)}>
          {t.curated}
        </span>
      )}
    </>
  );
}

/** The sentence with its citation marker emphasised. */
function Sentence({ text, marker }: { text: string; marker: string }) {
  const i = text.indexOf(marker);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{marker}</mark>
      {text.slice(i + marker.length)}
    </>
  );
}

interface PanelProps {
  projectId: string;
  graph: CitationGraph;
  group: CitationGroup;
  method: string;
  onBack: () => void;
  onOpenReference: (r: OpenRequest) => void;
  onShowInGraph: (pubId: string) => void;
  onOpenFiles: () => void;
  onLabel: (occId: string, status: EvidenceStatus | null) => void;
}

function labelButtons(t: Messages): { status: EvidenceStatus; text: string }[] {
  return [
    { status: 'localizado', text: t.labelOk },
    { status: 'ressalva', text: t.labelCaveat },
    { status: 'nao_localizado', text: t.labelNotLocated },
  ];
}

/** The researcher's own verdict: overrides the automatic label, is saved in the project and can be undone. */
function LabelControl({ o, onLabel }: { o: CitationOccurrence; onLabel: PanelProps['onLabel'] }) {
  const { t } = useI18n();
  if (o.resolution !== 'resolved') return null;
  return (
    <div className="label-control" role="group" aria-label={t.yourAssessmentAria}>
      <span className="small muted">{t.yourAssessment}</span>
      {labelButtons(t).map((b) => (
        <button
          key={b.status}
          className={`small st-btn st-${b.status}${o.override?.status === b.status ? ' on' : ''}`}
          aria-pressed={o.override?.status === b.status}
          onClick={() => onLabel(o.id, o.override?.status === b.status ? null : b.status)}
        >
          {b.text}
        </button>
      ))}
      {o.override && (
        <button className="linklike small" onClick={() => onLabel(o.id, null)} title={t.undoAutoTitle}>
          {t.undoAuto(o.override.auto ? evidenceStatusText(t, o.override.auto) : '—')}
        </button>
      )}
    </div>
  );
}

function OccurrenceCard({ o, graph, props }: { o: CitationOccurrence; graph: CitationGraph; props: PanelProps }) {
  const { t } = useI18n();
  const pub = o.publicationId ? (graph.nodes[o.publicationId] as PublicationNode | undefined) : undefined;
  const label = pub?.label ?? t.unidentifiedReference;
  const alternatives = o.passages.map((p, i) => ({
    label: p.curated ? t.passageCurated(i + 1, p.page) : t.passageScored(i + 1, p.page, Math.round(p.score * 100)),
    request: {
      anchor: { fileId: p.fileId, page: p.page, text: p.focus ?? p.text },
      phrase: p.focus ?? p.text,
      title: label,
      context: p.curated
        ? t.passageContextCurated(i + 1, o.passages.length, p.page, o.curated?.source ?? '')
        : t.passageContext(i + 1, o.passages.length, p.page),
      citing: o.sentence,
    } as OpenRequest,
  }));
  const requests: OpenRequest[] = alternatives.map((a, i) => ({ ...a.request, alternatives: alternatives.map((x) => ({ label: x.label, request: x.request })), altIndex: i }));
  const why = o.override ? o.override.autoWhy : o.why;
  const passagesTitle = o.passages.some((p) => p.curated)
    ? o.passages.length > 1
      ? t.reviewedPassages
      : t.reviewedPassage
    : o.passages.length > 1
      ? t.closestPassages
      : t.closestPassage;
  return (
    <section className="occ">
      <header>
        <h4>{label}</h4>
        <StatusPill o={o} />
      </header>
      {pub?.title && <div className="small muted">{pub.title}</div>}
      {o.resolution !== 'resolved' && (
        <p className="small">
          {o.resolution === 'ambiguous'
            ? t.markerMatchesSeveral(o.candidates.map((c) => graph.nodes[c]?.label ?? c).join('; '))
            : t.markerMatchesNone}
        </p>
      )}
      <blockquote className="sentence">
        <Sentence text={o.sentence} marker={o.marker} />
      </blockquote>
      {why && (
        <p className={`why small st-${o.override ? (o.override.auto ?? 'nao_localizado') : occurrenceStatus(o)}`}>
          <b>{o.override ? t.automatic : t.because}</b>
          {translateRuntime(t, why)}
        </p>
      )}
      {!o.why && o.reason && o.status !== 'localizado' && <p className="small reason">{reasonText(t, o.reason)}</p>}
      <LabelControl o={o} onLabel={props.onLabel} />
      {o.notes.filter((n) => n !== o.why && n !== o.override?.autoWhy).map((n, i) => (
        <p key={i} className="small muted">
          {translateRuntime(t, n)}
        </p>
      ))}
      {o.resolution === 'resolved' && o.reason === 'sem_pdf' && (
        <button className="primary" onClick={props.onOpenFiles}>
          {t.findOrSendPdfs}
        </button>
      )}
      {o.passages.length > 0 && (
        <>
          <h5>{passagesTitle}</h5>
          {o.passages.map((p, i) => (
            <div key={i} className="passage">
              <div className="passage-meta small">
                <span className="chip-page">{t.pageAbbr} {p.page}</span>
                {p.curated ? (
                  <span className="tag tag-curated" title={t.curatedPassageTagTitle}>{t.curated}</span>
                ) : (
                  <span title={t.similarityTitle}>{t.similarity(Math.round(p.score * 100))}</span>
                )}
                {p.region === 'resumo' && <span className="tag">{t.abstractStart}</span>}
              </div>
              <blockquote>
                {passageParts(p.text, p.focus).map((part, k) => (part.highlight ? <strong key={k} className="passage-focus">{part.text}</strong> : <span key={k}>{part.text}</span>))}
              </blockquote>
              {p.focusApproximate && (
                <p className="small muted" title={t.approxHighlightTitle}>
                  {t.approxHighlight}
                </p>
              )}
              <button className="primary small" onClick={() => props.onOpenReference(requests[i])}>
                {t.openInArticle(p.page)}
              </button>
            </div>
          ))}
        </>
      )}
      {o.publicationId && (
        <button className="linklike small" onClick={() => props.onShowInGraph(o.publicationId!)}>
          {t.seeInGraph}
        </button>
      )}
    </section>
  );
}

export function CitationPanel(props: PanelProps) {
  const { t } = useI18n();
  const { group, graph } = props;
  return (
    <div className="cit-panel">
      <button className="linklike" onClick={props.onBack}>
        ← {t.allCitations}
      </button>
      <h3>
        {group.marker} <span className="small muted">· {t.pageAbbr} {group.page}</span>
      </h3>
      {group.occurrences.map((o) => (
        <OccurrenceCard key={o.id} o={o} graph={graph} props={props} />
      ))}
      <p className="small muted method">{translateRuntime(t, props.method)}</p>
    </div>
  );
}

export function CitationList({ groups, graph, onSelect, method }: { groups: CitationGroup[]; graph: CitationGraph; onSelect: (spanId: string) => void; method: string }) {
  const { t } = useI18n();
  return (
    <div className="cit-panel">
      <h3>{t.citationsInDocument}</h3>
      <p className="small muted">{t.citationListHint}</p>
      {groups.length === 0 && <p className="muted">{t.noCitationsForFilters}</p>}
      <ul className="cit-list">
        {groups.map((g) => (
          <li key={g.spanId}>
            <button onClick={() => onSelect(g.spanId)}>
              <span className={`dot st-${g.status}`} title={evidenceStatusText(t, g.status)} />
              {g.occurrences.some((o) => o.override) && <span className="manual-mark" title={t.youLabeledThis}>✎</span>}
              <span className="cit-main">
                <b>{g.occurrences.map((o) => (o.publicationId ? graph.nodes[o.publicationId]?.label : undefined) ?? g.marker).join(' · ')}</b>
                {g.status !== 'localizado' && g.occurrences.find((o) => occurrenceStatus(o) === g.status)?.why && (
                  <span className={`small why-inline st-${g.status}`}>{translateRuntime(t, g.occurrences.find((o) => occurrenceStatus(o) === g.status)!.why)}</span>
                )}
                <span className="small muted">
                  {t.pageAbbr} {g.page} — {g.occurrences[0].sentence.slice(0, 110)}
                  {g.occurrences[0].sentence.length > 110 ? '…' : ''}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="small muted method">{translateRuntime(t, method)}</p>
    </div>
  );
}
