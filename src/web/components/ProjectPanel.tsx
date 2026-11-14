import { useEffect, useMemo, useState } from 'react';
import type { CategoryRule } from '../../core/categories';
import type { CitationGraph } from '../../core/model';
import { api, type FileView } from '../api';
import type { OpenRequest } from './SidePanel';
import { identityReason, translateRuntime, useI18n } from '../i18n';

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
  const { t } = useI18n();
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
    void run(t.sendingFiles(arr.length), async () => (await api.upload(projectId, arr, role, shareable ? 'shareable' : 'private')).graph);
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
    <div className="drawer" role="dialog" aria-label={t.filesAndReview}>
      <header className="drawer-head">
        <h2>{t.filesAndReview}</h2>
        <button className="close" onClick={onClose} aria-label={t.close}>
          ×
        </button>
      </header>
      {busy && <div className="notice">{busy}</div>}
      {error && <div className="notice error">{translateRuntime(t, error)}</div>}

      <section>
        <h3>{t.sendFiles}</h3>
        <p className="hint">
          {t.sendFilesHint}
        </p>
        <label className="check">
          <input type="checkbox" checked={shareable} onChange={(e) => setShareable(e.target.checked)} />
          <span>{t.markShareable}</span>
        </label>
        <div className="upload-grid">
          <label className="upload">
            <span>{t.mainDocumentPdf}</span>
            <input type="file" accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" onChange={(e) => upload(e.target.files, 'main')} disabled={Boolean(busy)} />
          </label>
          <label className="upload">
            <span>{t.bibliographyBib}</span>
            <input type="file" accept=".bib,.bibtex" multiple onChange={(e) => upload(e.target.files, 'reference')} disabled={Boolean(busy)} />
          </label>
          <label className="upload">
            <span>{t.referencePdfs}</span>
            <input type="file" accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" multiple onChange={(e) => upload(e.target.files, 'reference')} disabled={Boolean(busy)} />
          </label>
        </div>
        <div className="row">
          <button disabled={Boolean(busy)} onClick={() => run(t.reprocessing, () => api.rebuild(projectId))}>
            {t.reprocessGraph}
          </button>
          {externalAvailable && (
            <button
              disabled={Boolean(busy)}
              onClick={() => {
                if (confirm(t.confirmEnrich)) {
                  void run(t.queryingMetadata, async () => (await api.enrich(projectId)).graph);
                }
              }}
            >
              {t.completeMetadata}
            </button>
          )}
        </div>
      </section>

      <section>
        <h3>{t.curatedTitleSection}</h3>
        <p className="small muted">{t.curatedHint}</p>
        {curated && (
          <p className="small">
            {t.curatedActive(curated.source, curated.items)}{' '}
            <button
              className="linklike small"
              disabled={Boolean(busy)}
              onClick={() =>
                void run(t.removingCurated, async () => {
                  const g = await api.removeCurated(projectId);
                  setCurated(null);
                  setCuratedMsg(undefined);
                  return g;
                })
              }
            >
              {t.removeCurated}
            </button>
          </p>
        )}
        <label className="upload">
          <span>{curated ? t.replaceCurated : t.importCurated}</span>
          <input
            type="file"
            accept=".html,.htm,.json,text/html,application/json"
            disabled={Boolean(busy)}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              void run(t.importingCurated, async () => {
                const r = await api.importCurated(projectId, f);
                setCurated(await api.curated(projectId));
                setCuratedMsg(t.curatedApplied(r.applied, r.items));
                return r.graph;
              });
            }}
          />
        </label>
        {curatedMsg && <div className="notice ok">{curatedMsg}</div>}
      </section>

      <section>
        <h3>{t.filesHeading(files.length)}</h3>
        <table className="files">
          <thead>
            <tr>
              <th>{t.colFile}</th>
              <th>{t.colType}</th>
              <th>{t.colFileStatus}</th>
              <th>{t.colPublication}</th>
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
                      {f.visibility === 'private' ? t.visibilityPrivate : t.visibilityShareable}
                      {f.storage === 'external' ? t.referencedByPath : ''}
                    </div>
                  </td>
                  <td>{{ main: t.roleMain, reference: t.roleReference, bibtex: t.roleBib }[f.role]}</td>
                  <td>
                    {f.role === 'bibtex' ? 'ok' : f.extraction.status === 'ok' ? t.pagesShort(String(f.pageCount ?? '?')) : translateRuntime(t, f.extraction.status)}
                    {f.extraction.error && <div className="small error-text">{translateRuntime(t, f.extraction.error)}</div>}
                  </td>
                  <td>
                    {f.role === 'reference' ? (
                      <>
                        <select
                          value={link?.publicationId ?? ''}
                          onChange={(e) => run(t.associating, () => api.fileLink(projectId, f.id, e.target.value || null))}
                        >
                          <option value="">{t.notLinked}</option>
                          {pubs.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                        <div className="small muted">
                          {link?.status === 'matched' && (link.method === 'pdf_doi' ? t.autoDoi : t.autoTitle)}
                          {link?.status === 'manual' && t.manual}
                          {link?.status === 'ambiguous' && <span className="error-text">{t.ambiguousAmong(link.candidates?.map((c) => label(graph, c)).join(' / ') ?? '')}</span>}
                          {link?.status === 'unmatched' && t.noBibMatch}
                          {(link?.status === 'manual' || link?.method === 'manual') && (
                            <button className="linklike small" onClick={() => run(t.associating, () => api.fileLink(projectId, f.id, undefined))}>
                              {' '}
                              {t.backToAutomatic}
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
                            ? t.confirmRemoveExternal(f.originalName)
                            : t.confirmDeleteFile(f.originalName);
                        if (confirm(msg)) void run(t.deleting, () => api.deleteFile(projectId, f.id));
                      }}
                    >
                      {t.delete}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section>
        <h3>{t.ambiguousIdentities(pendingIdentity.length)}</h3>
        {graph.identityReviews.length === 0 && <p className="muted small">{t.none}</p>}
        <ul className="list">
          {graph.identityReviews.map((r) => (
            <li key={r.id} className="review">
              <div>
                <strong>{label(graph, r.a)}</strong> × <strong>{label(graph, r.b)}</strong>
              </div>
              <div className="small muted">{t.reasons(r.reasons.map((x) => identityReason(t, x)).join(', '))}</div>
              <div className="row">
                <button className={r.decision === 'same' ? 'primary' : ''} onClick={() => run(t.saving, () => api.identityDecision(projectId, r.id, 'same'))}>
                  {t.sameWork}
                </button>
                <button className={r.decision === 'distinct' ? 'primary' : ''} onClick={() => run(t.saving, () => api.identityDecision(projectId, r.id, 'distinct'))}>
                  {t.distinctWorks}
                </button>
                {r.decision && (
                  <button className="linklike small" onClick={() => run(t.saving, () => api.identityDecision(projectId, r.id, null))}>
                    {t.undo}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>{t.unresolvedCitations(graph.citationIssues.length)}</h3>
        <p className="hint">{t.unresolvedCitationsHint}</p>
        <ul className="list">
          {graph.citationIssues.slice(0, 200).map((c) => (
            <li key={c.id}>
              <button
                className="linklike"
                onClick={() => onOpen({ anchor: { fileId: c.fileId, page: c.page, text: c.marker }, title: t.mainDocument, context: c.status === 'ambiguous' ? t.markAmbiguous(c.marker) : t.markUnmatched(c.marker) })}
              >
                {t.pageAbbr} {c.page}: {c.marker}
              </button>{' '}
              <span className="small muted">
                {c.status === 'ambiguous' ? t.ambiguousBetween(c.candidates.map((x) => label(graph, x)).join(', ')) : t.noMatchingEntry}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>{t.refsOutsideNetwork(graph.unresolvedReferences.length)}</h3>
        <p className="hint">{t.refsOutsideHint}</p>
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
          <h3>{t.warnings(graph.warnings.length)}</h3>
          <ul className="list small">
            {graph.warnings.map((w, i) => (
              <li key={i}>{translateRuntime(t, w)}</li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3>{t.categoryRules}</h3>
        <p className="hint">{t.categoryRulesHint}</p>
        <textarea className="code" rows={8} value={rulesText} onChange={(e) => setRulesText(e.target.value)} />
        <button
          onClick={() => {
            let rules: CategoryRule[];
            try {
              rules = JSON.parse(rulesText);
            } catch {
              setError(t.invalidJsonRules);
              return;
            }
            void run(t.savingRules, () => api.setCategories(projectId, rules));
          }}
        >
          {t.saveRules}
        </button>
      </section>

      <section>
        <h3>{t.export}</h3>
        <div className="row">
          <button onClick={() => void api.download(projectId, 'graphml')}>
            GraphML
          </button>
          <button onClick={() => void api.download(projectId, 'json')}>
            {t.exportJson}
          </button>
          <button onClick={() => void api.download(projectId, 'csv')}>
            {t.exportCsv}
          </button>
          <button onClick={() => void api.download(projectId, 'evidence')}>
            {t.exportEvidence}
          </button>
        </div>
      </section>

      <section className="danger-zone">
        <h3>{t.deleteProject}</h3>
        <button
          className="danger"
          onClick={() => {
            if (confirm(t.confirmDeleteProject)) {
              void api.deleteProject(projectId).then(onDeleted, (e: Error) => setError(e.message));
            }
          }}
        >
          {t.deleteProject}
        </button>
      </section>
    </div>
  );
}
