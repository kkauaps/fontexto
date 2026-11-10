import type { CitationOccurrence } from '../../core/evidence';
import type { CitationGraph, PublicationNode } from '../../core/model';
import { occurrenceStatus, REASON_TEXT, STATUS_TEXT, type CitationGroup } from '../../core/evidenceView';
import type { OpenRequest } from './SidePanel';

function StatusPill({ o }: { o: CitationOccurrence }) {
  const s = occurrenceStatus(o);
  return <span className={`pill st-${s}`}>{STATUS_TEXT[s]}</span>;
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
}

function OccurrenceCard({ o, graph, props }: { o: CitationOccurrence; graph: CitationGraph; props: PanelProps }) {
  const pub = o.publicationId ? (graph.nodes[o.publicationId] as PublicationNode | undefined) : undefined;
  const label = pub?.label ?? 'Referência não identificada';
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
      {o.reason && o.status !== 'localizado' && <p className="small reason">{REASON_TEXT[o.reason] ?? o.reason}</p>}
      {o.notes.map((n, i) => (
        <p key={i} className="small muted">
          {n}
        </p>
      ))}
      {o.resolution === 'resolved' && o.reason === 'sem_pdf' && (
        <button className="primary" onClick={props.onOpenFiles}>
          Enviar PDFs das referências
        </button>
      )}
      {o.passages.length > 0 && (
        <>
          <h5>{o.passages.length > 1 ? 'Passagens mais próximas' : 'Passagem mais próxima'} na referência</h5>
          {o.passages.map((p, i) => (
            <div key={i} className="passage">
              <div className="passage-meta small">
                <span className="chip-page">p. {p.page}</span>
                <span title="Sobreposição ponderada entre a frase e a passagem (0–100%). Não é prova de que a passagem sustenta a frase.">similaridade {Math.round(p.score * 100)}%</span>
                {p.region === 'resumo' && <span className="tag">resumo/início</span>}
              </div>
              <blockquote>{p.text}</blockquote>
              <button
                className="primary small"
                onClick={() =>
                  props.onOpenReference({
                    anchor: { fileId: p.fileId, page: p.page, text: p.text },
                    phrase: p.text,
                    title: label,
                    context: `Passagem da página ${p.page} possivelmente relacionada à frase citada.`,
                  })
                }
              >
                Abrir PDF na p. {p.page} com a passagem destacada
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
        ← Lista de citações
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
              <span className="cit-main">
                <b>{g.occurrences.map((o) => (o.publicationId ? graph.nodes[o.publicationId]?.label : undefined) ?? g.marker).join(' · ')}</b>
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
