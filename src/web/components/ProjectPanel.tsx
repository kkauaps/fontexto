import { useEffect, useMemo, useState } from 'react';
import type { CategoryRule } from '../../core/categories';
import type { CitationGraph } from '../../core/model';
import { api, type FileView } from '../api';
import type { OpenRequest } from './SidePanel';

interface Props {
  projectId: string;
  graph: CitationGraph;
  externalAvailable: boolean;
  onGraph: (g: CitationGraph) => void;
  onOpen: (r: OpenRequest) => void;
  onClose: () => void;
  onDeleted: () => void;
}

const label = (g: CitationGraph, id: string | undefined) => (id ? (g.nodes[id]?.label ?? id) : '—');

export function ProjectPanel({ projectId, graph, externalAvailable, onGraph, onOpen, onClose, onDeleted }: Props) {
  const [files, setFiles] = useState<FileView[]>([]);
  const [busy, setBusy] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [shareable, setShareable] = useState(false);
  const [rulesText, setRulesText] = useState('');
  const [curated, setCurated] = useState<{ source: string; importedAt: string; items: number } | null>(null);
  const [curatedMsg, setCuratedMsg] = useState<string | undefined>();

  const refresh = () => api.project(projectId).then((p) => setFiles(p.files));
  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message));
    api.categories(projectId).then((r) => setRulesText(JSON.stringify(r, null, 2)));
    api.curated(projectId).then(setCurated).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, graph.builtAt]);

  const run = async (what: string, fn: () => Promise<CitationGraph | void>) => {
    setBusy(what);
    setError(undefined);
    try {
      const g = await fn();
      if (g) onGraph(g);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const upload = (list: FileList | null, role: 'main' | 'reference') => {
    if (!list?.length) return;
    const arr = [...list];
    void run(`Enviando e processando ${arr.length} arquivo(s)…`, async () => (await api.upload(projectId, arr, role, shareable ? 'shareable' : 'private')).graph);
  };

  const pubs = useMemo(
    () => Object.values(graph.nodes).filter((n) => n.kind === 'publication').sort((a, b) => a.label.localeCompare(b.label)),
    [graph],
  );
  const linkOf = (fileId: string) => graph.fileLinks.find((l) => l.fileId === fileId);
  const pendingIdentity = graph.identityReviews.filter((r) => !r.decision);
  const unresolvedBySource = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of graph.unresolvedReferences) m.set(u.sourceNodeId, (m.get(u.sourceNodeId) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [graph]);

  return (
    <div className="drawer" role="dialog" aria-label="Arquivos e revisão">
      <header className="drawer-head">
        <h2>Arquivos e revisão</h2>
        <button className="close" onClick={onClose} aria-label="Fechar">
          ×
        </button>
      </header>
      {busy && <div className="notice">{busy}</div>}
      {error && <div className="notice error">{error}</div>}

      <section>
        <h3>Enviar arquivos</h3>
        <p className="hint">
          Tudo é processado localmente. Os arquivos ficam privados por padrão e nunca são enviados a serviços externos.
        </p>
        <label className="check">
          <input type="checkbox" checked={shareable} onChange={(e) => setShareable(e.target.checked)} />
          <span>Marcar novos arquivos como compartilháveis (texto pode aparecer em exportações)</span>
        </label>
        <div className="upload-grid">
          <label className="upload">
            <span>Documento principal (PDF)</span>
            <input type="file" accept="application/pdf,.pdf" onChange={(e) => upload(e.target.files, 'main')} disabled={Boolean(busy)} />
          </label>
          <label className="upload">
            <span>Bibliografia (.bib)</span>
            <input type="file" accept=".bib,.bibtex" multiple onChange={(e) => upload(e.target.files, 'reference')} disabled={Boolean(busy)} />
          </label>
          <label className="upload">
            <span>PDFs das referências</span>
            <input type="file" accept="application/pdf,.pdf" multiple onChange={(e) => upload(e.target.files, 'reference')} disabled={Boolean(busy)} />
          </label>
        </div>
        <div className="row">
          <button disabled={Boolean(busy)} onClick={() => run('Reprocessando…', () => api.rebuild(projectId))}>
            Reprocessar grafo
          </button>
          {externalAvailable && (
            <button
              disabled={Boolean(busy)}
              onClick={() => {
                if (confirm('Consultar o OpenAlex enviando SOMENTE os DOIs das publicações (nenhum texto ou arquivo)? Os resultados apenas preenchem campos ausentes.')) {
                  void run('Consultando metadados públicos…', async () => (await api.enrich(projectId)).graph);
                }
              }}
            >
              Completar metadados (OpenAlex, só DOI)
            </button>
          )}
        </div>
      </section>

      <section>
        <h3>Curadoria (evidência já revisada)</h3>
        <p className="small muted">
          Se você já revisou as citações à mão (por exemplo, no <code>index.html</code> de uma rodada anterior), importe o arquivo: as páginas e trechos
          revisados passam a valer no lugar do rótulo automático, marcados como “curadoria”. O rótulo automático continua visível para comparação.
        </p>
        {curated && (
          <p className="small">
            Curadoria ativa: <strong>{curated.source}</strong> · {curated.items} itens.{' '}
            <button
              className="linklike small"
              disabled={Boolean(busy)}
              onClick={() =>
                void run('Removendo curadoria…', async () => {
                  const g = await api.removeCurated(projectId);
                  setCurated(null);
                  setCuratedMsg(undefined);
                  return g;
                })
              }
            >
              Remover curadoria
            </button>
          </p>
        )}
        <label className="upload">
          <span>{curated ? 'Substituir curadoria' : 'Importar curadoria (.html ou .json)'}</span>
          <input
            type="file"
            accept=".html,.htm,.json,text/html,application/json"
            disabled={Boolean(busy)}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              void run('Importando curadoria…', async () => {
                const r = await api.importCurated(projectId, f);
                setCurated(await api.curated(projectId));
                setCuratedMsg(`${r.applied} de ${r.items} citações receberam a evidência revisada.`);
                return r.graph;
              });
            }}
          />
        </label>
        {curatedMsg && <div className="notice ok">{curatedMsg}</div>}
      </section>

      <section>
        <h3>Arquivos ({files.length})</h3>
        <table className="files">
          <thead>
            <tr>
              <th>Arquivo</th>
              <th>Tipo</th>
              <th>Status</th>
              <th>Publicação</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {files.map((f) => {
              const link = linkOf(f.id);
              return (
                <tr key={f.id}>
                  <td title={f.originalName}>
                    {f.originalName}
                    <div className="small muted">
                      {f.visibility === 'private' ? 'privado' : 'compartilhável'}
                      {f.storage === 'external' ? ' · referenciado por caminho' : ''}
                    </div>
                  </td>
                  <td>{{ main: 'principal', reference: 'referência', bibtex: '.bib' }[f.role]}</td>
                  <td>
                    {f.role === 'bibtex' ? 'ok' : f.extraction.status === 'ok' ? `${f.pageCount ?? '?'} p.` : f.extraction.status}
                    {f.extraction.error && <div className="small error-text">{f.extraction.error}</div>}
                  </td>
                  <td>
                    {f.role === 'reference' ? (
                      <>
                        <select
                          value={link?.publicationId ?? ''}
                          onChange={(e) => run('Associando…', () => api.fileLink(projectId, f.id, e.target.value || null))}
                        >
                          <option value="">— não associado —</option>
                          {pubs.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                        <div className="small muted">
                          {link?.status === 'matched' && `automático (${link.method === 'pdf_doi' ? 'DOI' : 'título'})`}
                          {link?.status === 'manual' && 'manual'}
                          {link?.status === 'ambiguous' && <span className="error-text">ambíguo: {link.candidates?.map((c) => label(graph, c)).join(' / ')}</span>}
                          {link?.status === 'unmatched' && 'sem correspondência na bibliografia'}
                          {(link?.status === 'manual' || link?.method === 'manual') && (
                            <button className="linklike small" onClick={() => run('Associando…', () => api.fileLink(projectId, f.id, undefined))}>
                              {' '}
                              voltar ao automático
                            </button>
                          )}
                        </div>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <button
                      className="danger small"
                      disabled={Boolean(busy)}
                      onClick={() => {
                        const msg =
                          f.storage === 'external'
                            ? `Remover "${f.originalName}" do projeto? O arquivo original NÃO será apagado; somente dados derivados.`
                            : `Excluir "${f.originalName}" e todos os dados derivados?`;
                        if (confirm(msg)) void run('Excluindo…', () => api.deleteFile(projectId, f.id));
                      }}
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section>
        <h3>Identidades ambíguas ({pendingIdentity.length} pendentes)</h3>
        {graph.identityReviews.length === 0 && <p className="muted small">Nenhuma.</p>}
        <ul className="list">
          {graph.identityReviews.map((r) => (
            <li key={r.id} className="review">
              <div>
                <strong>{label(graph, r.a)}</strong> × <strong>{label(graph, r.b)}</strong>
              </div>
              <div className="small muted">Motivos: {r.reasons.join(', ')}</div>
              <div className="row">
                <button className={r.decision === 'same' ? 'primary' : ''} onClick={() => run('Salvando…', () => api.identityDecision(projectId, r.id, 'same'))}>
                  Mesma obra
                </button>
                <button className={r.decision === 'distinct' ? 'primary' : ''} onClick={() => run('Salvando…', () => api.identityDecision(projectId, r.id, 'distinct'))}>
                  Obras distintas
                </button>
                {r.decision && (
                  <button className="linklike small" onClick={() => run('Salvando…', () => api.identityDecision(projectId, r.id, null))}>
                    desfazer
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Citações no texto não resolvidas ({graph.citationIssues.length})</h3>
        <p className="hint">Marcações que não correspondem a exatamente uma entrada da bibliografia. Nada foi associado automaticamente.</p>
        <ul className="list">
          {graph.citationIssues.slice(0, 200).map((c) => (
            <li key={c.id}>
              <button
                className="linklike"
                onClick={() => onOpen({ anchor: { fileId: c.fileId, page: c.page, text: c.marker }, title: 'Documento principal', context: `Marcação ${c.status === 'ambiguous' ? 'ambígua' : 'sem correspondência'}: ${c.marker}` })}
              >
                p. {c.page}: {c.marker}
              </button>{' '}
              <span className="small muted">
                {c.status === 'ambiguous' ? `ambígua entre ${c.candidates.map((x) => label(graph, x)).join(', ')}` : 'sem entrada correspondente'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Referências fora da rede ({graph.unresolvedReferences.length})</h3>
        <p className="hint">Entradas das bibliografias dos PDFs que não correspondem a nenhuma publicação do projeto (ou correspondem a várias).</p>
        <ul className="list small">
          {unresolvedBySource.map(([src, n]) => (
            <li key={src}>
              {label(graph, src)}: {n}
            </li>
          ))}
        </ul>
      </section>

      {graph.warnings.length > 0 && (
        <section>
          <h3>Avisos ({graph.warnings.length})</h3>
          <ul className="list small">
            {graph.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3>Regras de categorias (sugestões)</h3>
        <p className="hint">Palavras-chave procuradas no título/resumo. Servem apenas para sugerir categorias e cores.</p>
        <textarea className="code" rows={8} value={rulesText} onChange={(e) => setRulesText(e.target.value)} />
        <button
          onClick={() => {
            let rules: CategoryRule[];
            try {
              rules = JSON.parse(rulesText);
            } catch {
              setError('JSON inválido nas regras de categorias.');
              return;
            }
            void run('Salvando regras…', () => api.setCategories(projectId, rules));
          }}
        >
          Salvar regras
        </button>
      </section>

      <section>
        <h3>Exportar</h3>
        <div className="row">
          <a className="button" href={api.exportUrl(projectId, 'graphml')}>
            GraphML
          </a>
          <a className="button" href={api.exportUrl(projectId, 'json')}>
            JSON (compartilhável, sem texto privado)
          </a>
          <a className="button" href={api.exportUrl(projectId, 'evidence')}>
            Citações e evidências (JSON, sem texto privado)
          </a>
        </div>
      </section>

      <section className="danger-zone">
        <h3>Excluir projeto</h3>
        <button
          className="danger"
          onClick={() => {
            if (confirm('Excluir o projeto e todos os arquivos enviados e dados derivados? Arquivos referenciados por caminho não são apagados.')) {
              void api.deleteProject(projectId).then(onDeleted, (e: Error) => setError(e.message));
            }
          }}
        >
          Excluir projeto
        </button>
      </section>
    </div>
  );
}
