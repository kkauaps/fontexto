import type { CitationOccurrence, EvidenceStatus } from '../../core/evidence';
import type { CitationGraph, PublicationNode } from '../../core/model';
import { formatPassage, occurrenceStatus, REASON_TEXT, STATUS_TEXT, type CitationGroup } from '../../core/evidenceView';
import type { OpenRequest } from './SidePanel';

function StatusPill({ o }: { o: CitationOccurrence }) {
  const s = occurrenceStatus(o);
  return (
    <>
      <span className={`pill st-${s}`}>{STATUS_TEXT[s]}</span>
      {o.override && (
        <span className="tag tag-manual" title={`Rótulo definido por você. O automático era: ${o.override.auto ? STATUS_TEXT[o.override.auto] : '—'}.`}>
          marcado por você
        </span>
      )}
      {o.curated && (
        <span className="tag tag-curated" title={`Veredito e passagens da curadoria importada (${o.curated.source}).${o.curated.autoStatus ? ` O rótulo automático era: ${STATUS_TEXT[o.curated.autoStatus]}.` : ''}`}>
          curadoria
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

const LABEL_BUTTONS: { status: EvidenceStatus; text: string }[] = [
  { status: 'localizado', text: 'OK' },
  { status: 'ressalva', text: 'Ressalva' },
  { status: 'nao_localizado', text: 'Não localizada' },
];

/** The researcher's own verdict: overrides the automatic label, is saved in the project and can be undone. */
function LabelControl({ o, onLabel }: { o: CitationOccurrence; onLabel: PanelProps['onLabel'] }) {
  if (o.resolution !== 'resolved') return null;
  return (
    <div className="label-control" role="group" aria-label="Sua avaliação desta citação">
      <span className="small muted">Sua avaliação:</span>
      {LABEL_BUTTONS.map((b) => (
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
        <button className="linklike small" onClick={() => onLabel(o.id, null)} title="Volta ao rótulo calculado automaticamente">
          desfazer (automático: {o.override.auto ? STATUS_TEXT[o.override.auto] : '—'})
        </button>
      )}
    </div>
  );
}

function OccurrenceCard({ o, graph, props }: { o: CitationOccurrence; graph: CitationGraph; props: PanelProps }) {
  const pub = o.publicationId ? (graph.nodes[o.publicationId] as PublicationNode | undefined) : undefined;
  const label = pub?.label ?? 'Referência não identificada';
  const alternatives = o.passages.map((p, i) => ({
    label: p.curated ? `${i + 1} · p. ${p.page} · curadoria` : `${i + 1} · p. ${p.page} · ${Math.round(p.score * 100)}%`,
    request: {
      anchor: { fileId: p.fileId, page: p.page, text: p.text },
      phrase: p.text,
      title: label,
      context: p.curated ? `Passagem ${i + 1} de ${o.passages.length}, na página ${p.page}, vinda da curadoria importada (${o.curated?.source ?? ''}).` : `Passagem ${i + 1} de ${o.passages.length}, na página ${p.page}. Candidata a sustentar a frase citada; confira no texto.`,
      citing: o.sentence,
    } as OpenRequest,
  }));
  const requests: OpenRequest[] = alternatives.map((a, i) => ({ ...a.request, alternatives: alternatives.map((x) => ({ label: x.label, request: x.request })), altIndex: i }));
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
            ? `O marcador corresponde a mais de uma referência: ${o.candidates.map((c) => graph.nodes[c]?.label ?? c).join('; ')}.`
            : 'Nenhuma entrada da bibliografia (.bib) corresponde a este marcador (autor e ano). Verifique o texto ou a bibliografia.'}
        </p>
      )}
      <blockquote className="sentence">
        <Sentence text={o.sentence} marker={o.marker} />
      </blockquote>
      {(o.override ? o.override.autoWhy : o.why) && (
        <p className={`why small st-${o.override ? (o.override.auto ?? 'nao_localizado') : occurrenceStatus(o)}`}>
          <b>{o.override ? 'Automático: ' : 'Por quê: '}</b>
          {o.override ? o.override.autoWhy : o.why}
        </p>
      )}
      {!o.why && o.reason && o.status !== 'localizado' && <p className="small reason">{REASON_TEXT[o.reason] ?? o.reason}</p>}
      <LabelControl o={o} onLabel={props.onLabel} />
      {o.notes.filter((n) => n !== o.why && n !== o.override?.autoWhy).map((n, i) => (
        <p key={i} className="small muted">
          {n}
        </p>
      ))}
      {o.resolution === 'resolved' && o.reason === 'sem_pdf' && (
        <button className="primary" onClick={props.onOpenFiles}>
          Buscar ou enviar PDFs das referências
        </button>
      )}
      {o.passages.length > 0 && (
        <>
          <h5>{o.passages.some((p) => p.curated) ? (o.passages.length > 1 ? 'Passagens revisadas' : 'Passagem revisada') : o.passages.length > 1 ? 'Passagens mais próximas' : 'Passagem mais próxima'} na referência</h5>
          {o.passages.map((p, i) => (
            <div key={i} className="passage">
              <div className="passage-meta small">
                <span className="chip-page">p. {p.page}</span>
                {p.curated ? (
                  <span className="tag tag-curated" title="Passagem escolhida na revisão importada, não calculada.">curadoria</span>
                ) : (
                  <span title="Sobreposição ponderada entre a frase e a passagem (0–100%). Não é prova de que a passagem sustenta a frase.">similaridade {Math.round(p.score * 100)}%</span>
                )}
                {p.region === 'resumo' && <span className="tag">resumo/início</span>}
              </div>
              <blockquote>{formatPassage(p.text)}</blockquote>
              <button className="primary small" onClick={() => props.onOpenReference(requests[i])}>
                Abrir no artigo · p. {p.page}
              </button>
            </div>
          ))}
        </>
      )}
      {o.publicationId && (
        <button className="linklike small" onClick={() => props.onShowInGraph(o.publicationId!)}>
          Ver no grafo
        </button>
      )}
    </section>
  );
}

export function CitationPanel(props: PanelProps) {
  const { group, graph } = props;
  return (
    <div className="cit-panel">
      <button className="linklike" onClick={props.onBack}>
        ← Todas as citações
      </button>
      <h3>
        {group.marker} <span className="small muted">· p. {group.page}</span>
      </h3>
      {group.occurrences.map((o) => (
        <OccurrenceCard key={o.id} o={o} graph={graph} props={props} />
      ))}
      <p className="small muted method">{props.method}</p>
    </div>
  );
}

export function CitationList({ groups, graph, onSelect, method }: { groups: CitationGroup[]; graph: CitationGraph; onSelect: (spanId: string) => void; method: string }) {
  return (
    <div className="cit-panel">
      <h3>Citações do documento</h3>
      <p className="small muted">Clique numa marcação destacada no texto, ou numa linha abaixo, para ver a frase, a referência e a passagem encontrada.</p>
      {groups.length === 0 && <p className="muted">Nenhuma citação para os filtros atuais.</p>}
      <ul className="cit-list">
        {groups.map((g) => (
          <li key={g.spanId}>
            <button onClick={() => onSelect(g.spanId)}>
              <span className={`dot st-${g.status}`} title={STATUS_TEXT[g.status]} />
              {g.occurrences.some((o) => o.override) && <span className="manual-mark" title="Você marcou esta citação à mão">✎</span>}
              <span className="cit-main">
                <b>{g.occurrences.map((o) => (o.publicationId ? graph.nodes[o.publicationId]?.label : undefined) ?? g.marker).join(' · ')}</b>
                {g.status !== 'localizado' && g.occurrences.find((o) => occurrenceStatus(o) === g.status)?.why && (
                  <span className={`small why-inline st-${g.status}`}>{g.occurrences.find((o) => occurrenceStatus(o) === g.status)!.why}</span>
                )}
                <span className="small muted">
                  p. {g.page} — {g.occurrences[0].sentence.slice(0, 110)}
                  {g.occurrences[0].sentence.length > 110 ? '…' : ''}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="small muted method">{method}</p>
    </div>
  );
}
