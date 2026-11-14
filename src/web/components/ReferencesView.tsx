import { useMemo, useRef, useState } from 'react';
import type { EvidenceReport } from '../../core/evidence';
import type { CitationGraph, PublicationNode } from '../../core/model';
import { REF_STATUS_ORDER, REF_STATUS_TEXT, refRows, type RefRow, type RefStatus } from '../../core/refStatus';
import { api, type OaResult } from '../api';
import type { OpenRequest } from './SidePanel';

/** Outcome of the free-PDF search for one reference (kept for the session only). */
export type OaState =
  | { kind: 'busy' }
  | { kind: 'got'; source: string }
  | { kind: 'blocked'; result: OaResult }
  | { kind: 'closed'; result: OaResult }
  | { kind: 'not_found' }
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
          onState(pub.id, { kind: 'got', source: r.source });
        } else if (r.result.status === 'oa') onState(pub.id, { kind: 'blocked', result: r.result });
        else if (r.result.status === 'closed') onState(pub.id, { kind: 'closed', result: r.result });
        else onState(pub.id, { kind: 'not_found' });
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

export function OaCell({ state, pub }: { state?: OaState; pub: PublicationNode }) {
  if (!state) return null;
  const link = (r: OaResult) => r.pdfUrls[0]?.url ?? r.landingUrl ?? doiUrl(r.doi ?? pub.doi);
  switch (state.kind) {
    case 'busy':
      return (
        <span className="muted small">
          <span className="spinner" /> buscando…
        </span>
      );
    case 'got':
      return <span className="oa-tag ok">PDF gratuito obtido ({state.source})</span>;
    case 'blocked':
      return (
        <span className="oa-tag">
          Gratuito, mas o site não permite download automático:{' '}
          <a href={link(state.result)} target="_blank" rel="noreferrer noopener">
            baixar
          </a>{' '}
          e enviar aqui
        </span>
      );
    case 'closed':
      return (
        <span className="oa-tag">
          Sem PDF gratuito
          {link(state.result) && (
            <>
              {' · '}
              <a href={link(state.result)} target="_blank" rel="noreferrer noopener">
                página da editora
              </a>
            </>
          )}
        </span>
      );
    case 'not_found':
      return <span className="oa-tag">Não identificado nas bases abertas</span>;
    case 'error':
      return <span className="oa-tag">Falha na busca: {state.message}</span>;
  }
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
      setMessage(got ? `${got} PDF(s) gratuito(s) adicionados e verificados.` : 'Nenhum PDF gratuito pôde ser baixado automaticamente. Veja os links em cada linha.');
    } catch (e) {
      setMessage((e as Error).message);
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
      setMessage((e as Error).message);
    } finally {
      setBusy(undefined);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  if (!rows.length) {
    return (
      <div className="refs-view">
        <div className="empty-card">
          <h2>Nenhuma referência ainda</h2>
          <p className="muted">Envie o PDF do seu documento: as referências da bibliografia aparecem aqui, com a situação de cada uma.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="refs-view">
      <div className="refs-head">
        <div className="chip-row" role="group" aria-label="Filtrar por situação">
          <button className={`chip-filter${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>
            Todas <b>{rows.length}</b>
          </button>
          {REF_STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => (
            <button key={s} className={`chip-filter rs-${s}${filter === s ? ' on' : ''}`} onClick={() => setFilter(s)}>
              <i className={`dot rs-${s}`} /> {REF_STATUS_TEXT[s]} <b>{counts[s]}</b>
            </button>
          ))}
        </div>
        {withoutPdf.length > 0 && (
          <div className="refs-oa">
            <button className="primary" disabled={Boolean(busy)} onClick={runOa}>
              {busy === 'oa' ? 'Buscando PDFs gratuitos…' : `Buscar PDFs gratuitos (${withoutPdf.length} sem PDF)`}
            </button>
            <span className="muted small">Envia só DOI, título, ano e 1º autor para consultar OpenAlex, Semantic Scholar e arXiv. Seus arquivos não saem do navegador.</span>
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
            <th>Referência</th>
            <th>Situação</th>
            <th title="Localizadas · com ressalva · não localizadas">Citações no texto</th>
            <th>PDF da fonte</th>
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
        <span className={`pill rs-${row.status}`}>{REF_STATUS_TEXT[row.status]}</span>
        {row.manual > 0 && <span className="tag-manual" title="Você marcou à mão pelo menos uma citação desta fonte"> ✎ {row.manual}</span>}
      </td>
      <td className="ref-counts">
        {row.citations === 0 ? (
          <span className="muted small">—</span>
        ) : (
          <button className="link-btn" onClick={onShowInDocument} title="Ver estas citações no documento">
            <span className="cnt ok">{counts.localizado}</span> · <span className="cnt warn">{counts.ressalva}</span> · <span className="cnt nl">{counts.nao_localizado}</span>
            {row.citations > counts.localizado + counts.ressalva + counts.nao_localizado && <span className="muted"> (+{row.citations - counts.localizado - counts.ressalva - counts.nao_localizado} sem PDF)</span>}
          </button>
        )}
        <button className="link-btn small" onClick={onShowInGraph}>
          grafo
        </button>
      </td>
      <td>
        {row.hasPdf ? (
          <button onClick={onOpenPdf}>Abrir PDF</button>
        ) : (
          <div className="ref-pdf">
            <button disabled={busy} onClick={onUpload}>
              {busy ? 'Enviando…' : 'Enviar PDF'}
            </button>
            <OaCell state={oa} pub={pub} />
          </div>
        )}
      </td>
    </tr>
  );
}
