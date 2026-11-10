import { useState } from 'react';
import { UNCATEGORIZED, type CategoryRule } from '../../core/categories';
import type { Anchor, CitationGraph, GraphEdge, GraphNode, PublicationNode, ReviewAction } from '../../core/model';
import { MAIN_DOCUMENT_ID } from '../../core/pipeline';
import { citationLists, type ViewEdge } from '../../core/view';
import { METHOD_LABEL, STATUS_HELP, STATUS_LABEL, UNAVAILABLE } from '../labels';
import type { Selection } from './GraphCanvas';

export interface OpenRequest {
  anchor: Anchor;
  title: string;
  context?: string;
}

interface Props {
  graph: CitationGraph;
  selection: Selection;
  viewEdges: ViewEdge[];
  rules: CategoryRule[];
  onClose: () => void;
  onSelect: (s: Selection) => void;
  onOpen: (r: OpenRequest) => void;
  onReview: (edgeId: string, action: ReviewAction) => Promise<void>;
  onCategory: (pubId: string, value: string | null | undefined) => Promise<void>;
}

const label = (g: CitationGraph, id: string) => g.nodes[id]?.label ?? id;

function Value({ v, children }: { v: unknown; children?: React.ReactNode }) {
  if (v === undefined || v === null || v === '') return <span className="unavailable">{UNAVAILABLE}</span>;
  return <>{children ?? String(v)}</>;
}

function StatusBadge({ status }: { status: GraphEdge['status'] }) {
  return (
    <span className={`badge status-${status}`} title={STATUS_HELP[status]}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function EdgeLink({ g, e, dir, onSelect }: { g: CitationGraph; e: GraphEdge; dir: 'out' | 'in'; onSelect: Props['onSelect'] }) {
  const other = dir === 'out' ? e.target : e.source;
  return (
    <li>
      <button className="linklike" onClick={() => onSelect({ type: 'node', id: other })}>
        {label(g, other)}
      </button>{' '}
      <button className="linklike small" onClick={() => onSelect({ type: 'edge', id: e.id })} title="Ver evidência da relação">
        <StatusBadge status={e.status} />
      </button>
    </li>
  );
}

function PublicationDetails({ g, pub, props }: { g: CitationGraph; pub: PublicationNode; props: Props }) {
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
      <dl className="meta">
        <dt>Autores</dt>
        <dd>
          <Value v={pub.authors.length ? 1 : undefined}>{pub.authors.map((a) => a.raw).join('; ')}</Value>
        </dd>
        <dt>Ano</dt>
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
        <dt>Veículo</dt>
        <dd>
          <Value v={pub.venue} />
        </dd>
        <dt>Resumo</dt>
        <dd className="abstract">
          <Value v={pub.abstract} />
        </dd>
        <dt>Categoria</dt>
        <dd>
          <select
            value={pub.category?.value ?? UNCATEGORIZED}
            onChange={(e) => props.onCategory(pub.id, e.target.value === UNCATEGORIZED ? null : e.target.value)}
          >
            <option value={UNCATEGORIZED}>{UNCATEGORIZED}</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {pub.category?.source === 'suggested' && (
            <span className="badge suggested" title={`Palavras-chave: ${pub.category.matched?.join(', ')}`}>
              sugerida
            </span>
          )}
          {pub.category?.source === 'user' && (
            <button className="linklike small" onClick={() => props.onCategory(pub.id, undefined)}>
              restaurar sugestão
            </button>
          )}
          <div className="row">
            <input placeholder="Nova categoria" value={custom} onChange={(e) => setCustom(e.target.value)} />
            <button disabled={!custom.trim()} onClick={() => props.onCategory(pub.id, custom.trim()).then(() => setCustom(''))}>
              Definir
            </button>
          </div>
        </dd>
        <dt>Conexões</dt>
        <dd>
          cita {cites.length} · citado por {citedBy.length} (na rede disponível)
        </dd>
        <dt>Fontes dos metadados</dt>
        <dd className="small">{pub.metadataSources.map((s) => `${s.kind}${s.ref ? ` (${s.ref})` : ''}: ${s.fields.join(', ') || '—'}`).join(' · ') || UNAVAILABLE}</dd>
      </dl>

      <div className="actions">
        {fileId ? (
          <button className="primary" onClick={() => props.onOpen({ anchor: { fileId, page: 1 }, title: pub.label })}>
            Abrir PDF
          </button>
        ) : (
          <button disabled title="Nenhum PDF associado a esta publicação">
            PDF indisponível
          </button>
        )}
      </div>

      <h4>Cita ({cites.length})</h4>
      {cites.length ? <ul className="list">{cites.map((e) => <EdgeLink key={e.id} g={g} e={e} dir="out" onSelect={props.onSelect} />)}</ul> : <p className="muted small">{fileId ? 'Nenhuma referência desta publicação foi localizada na rede.' : 'Bibliografia não analisada: PDF ausente.'}</p>}

      <h4>Citado por ({citedBy.length})</h4>
      {citedBy.length ? <ul className="list">{citedBy.map((e) => <EdgeLink key={e.id} g={g} e={e} dir="in" onSelect={props.onSelect} />)}</ul> : <p className="muted small">Nenhum.</p>}

      {related.length > 0 && (
        <>
          <h4>Relações temáticas sugeridas ({related.length})</h4>
          <p className="hint">Não indicam citação.</p>
          <ul className="list">
            {related.map((e) => (
              <EdgeLink key={e.id} g={g} e={e} dir={e.source === pub.id ? 'out' : 'in'} onSelect={props.onSelect} />
            ))}
          </ul>
        </>
      )}

      <h4>No documento principal</h4>
      {claims.length > 0 ? (
        <ul className="list">
          {claims.map((e) => (
            <li key={e.id}>{label(g, e.source)}</li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Afirmações ainda não extraídas (Fase 2: grafo de evidências).</p>
      )}
      {markers.length > 0 ? (
        <>
          <p className="small">Citado no texto em {new Set(markers.map((m) => m.page)).size} página(s):</p>
          <ul className="chips">
            {markers.map((m, i) => (
              <li key={i}>
                <button
                  className="chip"
                  title={m.text}
                  onClick={() => props.onOpen({ anchor: m, title: label(g, MAIN_DOCUMENT_ID), context: `Marcação de citação de ${pub.label}: ${m.text}` })}
                >
                  p. {m.page}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : docEdge ? (
        <p className="muted small">Nenhuma marcação no texto localizada {g.nodes[MAIN_DOCUMENT_ID]?.kind === 'document' && (g.nodes[MAIN_DOCUMENT_ID] as { fileId?: string }).fileId ? '' : '(PDF do documento principal ausente)'}.</p>
      ) : null}
    </>
  );
}

function EdgeDetails({ g, edge, props }: { g: CitationGraph; edge: GraphEdge; props: Props }) {
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
  return (
    <>
      <h2>
        {isCites ? 'Citação' : edge.kind === 'related_to' ? 'Relação temática' : edge.kind}
      </h2>
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
        <StatusBadge status={edge.status} /> <span className="small muted">{STATUS_HELP[edge.status]}</span>
      </p>

      <h4>Proveniência</h4>
      {edge.provenance.map((p, i) => (
        <div key={i} className="prov">
          <div className="prov-method">{METHOD_LABEL[p.method]}</div>
          {p.matchedBy?.length ? <div className="small">Campos coincidentes: {p.matchedBy.join(', ')}</div> : null}
          {p.bibliographicId && <div className="small">Identificador: {p.bibliographicId}</div>}
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
                        context: `Entrada na bibliografia de ${label(g, edge.source)} que corresponde a ${label(g, edge.target)}.`,
                      })
                    }
                  >
                    Abrir na bibliografia (p. {p.referenceAnchor.page})
                  </button>
                </div>
              )}
            </blockquote>
          )}
          {p.citationAnchors?.length ? (
            <div>
              <div className="small">Marcações no texto:</div>
              <ul className="chips">
                {p.citationAnchors.map((a, j) => (
                  <li key={j}>
                    <button className="chip" title={a.text} onClick={() => props.onOpen({ anchor: a, title: label(g, edge.source), context: `Marcação: ${a.text}` })}>
                      p. {a.page}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {p.method === 'bibliographic_coupling' && p.text && (
            <div className="small">Referências em comum: {p.text.split(', ').map((id) => label(g, id)).join('; ')}</div>
          )}
          {p.notes?.map((n, j) => (
            <div key={j} className="small muted">
              {n}
            </div>
          ))}
        </div>
      ))}

      {edge.reviews?.length ? (
        <>
          <h4>Revisões</h4>
          <ul className="list small">
            {edge.reviews.map((r, i) => (
              <li key={i}>
                {new Date(r.at).toLocaleString()} — {r.action}: {STATUS_LABEL[r.from]} → {STATUS_LABEL[r.to]}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <div className="actions">
        {(edge.status === 'unverified' || edge.status === 'suggested' || (edge.status === 'rejected' && isCites)) && (
          <button className="primary" disabled={busy} onClick={() => review('confirm')}>
            {edge.kind === 'related_to' ? 'Concordo (temática)' : 'Confirmar citação'}
          </button>
        )}
        {edge.status !== 'rejected' && edge.source !== MAIN_DOCUMENT_ID && (
          <button className="danger" disabled={busy} onClick={() => review('reject')}>
            Rejeitar
          </button>
        )}
        {edge.reviews?.length ? (
          <button disabled={busy} onClick={() => review('reset')}>
            Desfazer revisões
          </button>
        ) : null}
      </div>
    </>
  );
}

function AggregatedEdge({ g, ve, props }: { g: CitationGraph; ve: ViewEdge; props: Props }) {
  return (
    <>
      <h2>{ve.count} relações agregadas</h2>
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
          <p className="small muted">Documento principal · {cites.length} referências declaradas</p>
          <div className="actions">
            {n.fileId ? (
              <button className="primary" onClick={() => props.onOpen({ anchor: { fileId: n.fileId!, page: 1 }, title: n.label })}>
                Abrir PDF
              </button>
            ) : (
              <button disabled>PDF do documento principal indisponível</button>
            )}
          </div>
          <h4>Referências</h4>
          <ul className="list">{cites.map((e) => <EdgeLink key={e.id} g={g} e={e} dir="out" onSelect={props.onSelect} />)}</ul>
        </>
      );
    } else if (selection.id.startsWith('group:')) {
      body = <p>Grupo recolhido. Use o botão “+” no nó ou a legenda para expandir.</p>;
    }
  } else {
    const e = g.edges[selection.id];
    const ve = props.viewEdges.find((x) => x.id === selection.id);
    if (e) body = <EdgeDetails key={e.id + e.status} g={g} edge={e} props={props} />;
    else if (ve) body = <AggregatedEdge g={g} ve={ve} props={props} />;
  }
  return (
    <aside className="sidepanel">
      <button className="close" onClick={props.onClose} aria-label="Fechar painel">
        ×
      </button>
      {body ?? <p className="muted">Elemento não encontrado.</p>}
    </aside>
  );
}
