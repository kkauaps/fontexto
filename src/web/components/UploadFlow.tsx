import { useMemo, useRef, useState, type DragEvent } from 'react';
import type { CitationGraph, PublicationNode } from '../../core/model';
import { api } from '../api';
import { BRAND } from '../brand';
import lockup from '../assets/fontexto-lockup.svg';
import type { FlowMode } from './Landing';
import { fetchOpenAccess, OaCell, type OaState } from './ReferencesView';
import { LanguageSwitcher, privacyNote, translateRuntime, useI18n } from '../i18n';

interface Props {
  mode: FlowMode;
  onBack: () => void;
  /** Called when the project is ready; the app opens it. */
  onDone: (projectId: string, project: { id: string; name: string; createdAt: string }, oa?: Record<string, OaState>) => void;
}

type Phase = 'form' | 'working' | 'review' | 'error';
interface Step {
  label: string;
  state: 'wait' | 'run' | 'ok';
  detail?: string;
}

const isPdf = (f: File) => /\.(pdf|png|jpe?g|webp)$/i.test(f.name);
const isBib = (f: File) => /\.(bib|bibtex)$/i.test(f.name);

/** Files from a drop, walking dropped folders. */
async function filesFromDrop(e: DragEvent): Promise<File[]> {
  const items = [...e.dataTransfer.items].map((i) => (i as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.() ?? null);
  if (items.some(Boolean)) {
    const out: File[] = [];
    const walk = async (entry: FileSystemEntry): Promise<void> => {
      if (entry.isFile) out.push(await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej)));
      else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        for (;;) {
          const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
          if (!batch.length) break;
          for (const c of batch) await walk(c);
        }
      }
    };
    for (const it of items) if (it) await walk(it);
    return out;
  }
  return [...e.dataTransfer.files];
}

function DropZone({ id, title, hint, accept, multiple, folder, files, onFiles }: { id: string; title: string; hint: string; accept: string; multiple?: boolean; folder?: boolean; files: File[]; onFiles: (f: File[]) => void }) {
  const { t } = useI18n();
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  return (
    <div
      className={`uf-drop${over ? ' over' : ''}${files.length ? ' filled' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setOver(false);
        onFiles(await filesFromDrop(e));
      }}
    >
      <label htmlFor={id} className="uf-drop-title">
        {title}
      </label>
      <p className="small muted">{hint}</p>
      <div className="row">
        <button type="button" onClick={() => input.current?.click()}>
          {multiple ? t.chooseFiles : t.chooseFile}
        </button>
        {folder && (
          <button type="button" onClick={() => folderInput.current?.click()}>
            {t.chooseFolder}
          </button>
        )}
      </div>
      <input id={id} ref={input} type="file" accept={accept} multiple={multiple} hidden onChange={(e) => onFiles([...(e.target.files ?? [])])} />
      {folder && <input ref={folderInput} type="file" hidden multiple {...({ webkitdirectory: '' } as object)} onChange={(e) => onFiles([...(e.target.files ?? [])])} />}
      {files.length > 0 && (
        <p className="uf-picked small" aria-live="polite">
          {t.filesSelected(files.length, files[0].name)}
        </p>
      )}
    </div>
  );
}

export function UploadFlow({ mode, onBack, onDone }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [main, setMain] = useState<File[]>([]);
  const [bib, setBib] = useState<File[]>([]);
  const [refs, setRefs] = useState<File[]>([]);
  const [phase, setPhase] = useState<Phase>('form');
  const [steps, setSteps] = useState<Step[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [project, setProject] = useState<{ id: string; name: string; createdAt: string } | undefined>();
  const [graph, setGraph] = useState<CitationGraph | undefined>();
  const [extracted, setExtracted] = useState<{ usable: number; total: number; numbered: boolean } | undefined>();

  const [oa, setOa] = useState<Record<string, OaState>>({});
  const ready = main.length === 1 && (mode === 'doc' || refs.length > 0) && (mode !== 'bib' || bib.length === 1);
  const title = mode === 'bib' ? t.uploadTitleBib : mode === 'doc' ? t.uploadTitleDoc : t.uploadTitlePdfs;
  const readsList = mode !== 'bib';

  const setStep = (i: number, s: Partial<Step>) => setSteps((all) => all.map((x, k) => (k === i ? { ...x, ...s } : x)));

  const start = async () => {
    const labels = [
      t.stepCreateProject,
      t.stepUploadDocument,
      ...(mode === 'bib' ? [t.stepUploadBib] : []),
      ...(refs.length ? [t.stepUploadRefs(refs.length)] : []),
      ...(readsList ? [t.stepReadList] : []),
      ...(mode === 'doc' ? [t.stepSearchFreePdfs] : []),
      t.stepCheckCitations,
    ];
    setSteps(labels.map((label) => ({ label, state: 'wait' })));
    setPhase('working');
    setError(undefined);
    let i = 0;
    try {
      setStep(i, { state: 'run' });
      const p = await api.createProject(name.trim() || main[0].name.replace(/\.(pdf|png|jpe?g|webp)$/i, ''));
      setProject(p);
      setStep(i++, { state: 'ok' });
      setStep(i, { state: 'run' });
      await api.upload(p.id, main, 'main', 'private');
      setStep(i++, { state: 'ok' });
      if (mode === 'bib') {
        setStep(i, { state: 'run' });
        await api.upload(p.id, bib, 'reference', 'private');
        setStep(i++, { state: 'ok' });
      }
      if (refs.length) {
        setStep(i, { state: 'run' });
        const BATCH = 6;
        for (let k = 0; k < refs.length; k += BATCH) {
          await api.upload(p.id, refs.slice(k, k + BATCH), 'reference', 'private');
          setStep(i, { detail: t.stepProgress(Math.min(k + BATCH, refs.length), refs.length) });
        }
        setStep(i++, { state: 'ok' });
      }
      let g: CitationGraph | undefined;
      if (readsList) {
        setStep(i, { state: 'run' });
        const r = await api.extractReferences(p.id);
        g = r.graph;
        setExtracted({ usable: r.usable, total: r.references.length, numbered: r.numbered });
        setStep(i++, { state: 'ok', detail: t.entriesRecognized(r.usable, r.references.length) });
      }
      if (mode === 'doc' && g) {
        setStep(i, { state: 'run' });
        const missing = Object.values(g.nodes).filter((n): n is PublicationNode => n.kind === 'publication' && n.inMainBibliography && n.fileIds.length === 0);
        const states: Record<string, OaState> = {};
        let finished = 0;
        const step = i;
        const out = await fetchOpenAccess(p.id, missing, (id, st) => {
          states[id] = st;
          if (st.kind !== 'busy') finished++;
          setOa({ ...states });
          setStep(step, { detail: t.oaProgress(finished, missing.length, Object.values(states).filter((x) => x.kind === 'got').length) });
        });
        if (out.graph) g = out.graph;
        setStep(i++, { state: 'ok' });
      }
      setStep(i, { state: 'run' });
      g = g ?? (await api.rebuild(p.id));
      setStep(i, { state: 'ok' });
      setGraph(g);
      const pending = g.fileLinks.some((l) => l.status !== 'matched' && l.status !== 'manual') || g.fileLinks.length === 0;
      if (readsList || pending) setPhase('review');
      else onDone(p.id, p);
    } catch (e) {
      setError(translateRuntime(t, (e as Error).message));
      setPhase('error');
    }
  };

  const missing = [main.length !== 1 && t.missingMain, mode === 'bib' && bib.length !== 1 && t.missingBib, mode !== 'doc' && refs.length === 0 && t.missingRefs].filter(Boolean);

  return (
    <div className="uf">
      <header className="lp-nav">
        <button className="linklike" onClick={onBack}>
          <img className="lp-logo" src={lockup} alt={BRAND.name} height={30} />
        </button>
        <div className="lp-nav-right">
          <button className="linklike" onClick={onBack}>
            ← {t.back}
          </button>
          <LanguageSwitcher />
        </div>
      </header>
      <main className="uf-main">
        {phase === 'form' && (
          <>
            <h1>{title}</h1>
            <p className="lp-lead">
              {mode === 'bib' ? t.uploadLeadBib : mode === 'doc' ? t.uploadLeadDoc : t.uploadLeadPdfs}
            </p>
            <label className="uf-name">
              <span className="small muted">{t.projectNameOptional}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.projectNamePlaceholder} />
            </label>
            <div className="uf-grid">
              <DropZone id="uf-main" title={t.dropYourDocument} hint={t.dropYourDocumentHint} accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" files={main} onFiles={(f) => setMain(f.filter(isPdf).slice(0, 1))} />
              {mode === 'bib' && <DropZone id="uf-bib" title={t.dropBib} hint={t.dropBibHint} accept=".bib,.bibtex" files={bib} onFiles={(f) => setBib(f.filter(isBib).slice(0, 1))} />}
              <DropZone
                id="uf-refs"
                title={t.dropRefs(mode === 'bib' ? '3' : '2', mode === 'doc')}
                hint={mode === 'doc' ? t.dropRefsHintDoc : t.dropRefsHint}
                accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                multiple
                folder
                files={refs}
                onFiles={(f) => setRefs((prev) => [...prev, ...f.filter(isPdf)].filter((x, i, a) => a.findIndex((y) => y.name === x.name && y.size === x.size) === i))}
              />
            </div>
            <p className="small muted">
              {privacyNote(t)}
              {mode === 'doc' && t.privacyOaNote}
            </p>
            <button className="primary lp-btn" disabled={!ready} onClick={() => void start()}>
              {t.processAndOpen}
            </button>
            {!ready && <p className="small muted">{t.missingPrefix}{missing.join(', ')}.</p>}
          </>
        )}

        {(phase === 'working' || phase === 'error') && (
          <>
            <h1>{phase === 'working' ? t.processing : t.somethingWentWrong}</h1>
            <ol className="uf-steps" aria-live="polite">
              {steps.map((s, i) => (
                <li key={i} className={s.state}>
                  <span className="uf-dot" aria-hidden="true">{s.state === 'ok' ? '✓' : s.state === 'run' ? <span className="spinner" /> : ''}</span>
                  <span>
                    {s.label}
                    {s.detail && <span className="small muted"> · {s.detail}</span>}
                  </span>
                </li>
              ))}
            </ol>
            {phase === 'error' && (
              <>
                <div className="notice error">{error}</div>
                <div className="row">
                  {project && (
                    <button className="primary" onClick={() => onDone(project.id, project)}>
                      {t.openProjectAnyway}
                    </button>
                  )}
                  <button onClick={onBack}>{t.backToStart}</button>
                </div>
              </>
            )}
          </>
        )}

        {phase === 'review' && graph && project && <Review graph={graph} projectId={project.id} extracted={extracted} mode={mode} oa={oa} onGraph={setGraph} onOpen={() => onDone(project.id, project, oa)} />}
      </main>
    </div>
  );
}

function Review({ graph, projectId, extracted, mode, oa, onGraph, onOpen }: { graph: CitationGraph; projectId: string; extracted?: { usable: number; total: number; numbered: boolean }; mode: FlowMode; oa: Record<string, OaState>; onGraph: (g: CitationGraph) => void; onOpen: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();
  const bibPubs = useMemo(() => Object.values(graph.nodes).filter((n): n is PublicationNode => n.kind === 'publication' && n.inMainBibliography).sort((a, b) => a.label.localeCompare(b.label)), [graph]);
  const linkOf = (fileId: string) => graph.fileLinks.find((l) => l.fileId === fileId);
  const linkedPubIds = new Set(graph.fileLinks.filter((l) => l.status === 'matched' || l.status === 'manual').map((l) => l.publicationId));
  const refFiles = Object.values(graph.files).filter((f) => f.role === 'reference');
  const loose = refFiles.filter((f) => {
    const l = linkOf(f.id);
    return !l || (l.status !== 'matched' && l.status !== 'manual');
  });
  const withoutPdf = bibPubs.filter((p) => !linkedPubIds.has(p.id) && !p.fileIds.length);
  const pair = async (fileId: string, pubId: string) => {
    setBusy(true);
    setErr(undefined);
    try {
      onGraph(await api.fileLink(projectId, fileId, pubId || null));
    } catch (e) {
      setErr(translateRuntime(t, (e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  const oaVals = Object.values(oa);
  const oaSummary = oaVals.length
    ? t.oaSummary(oaVals.filter((x) => x.kind === 'got').length, oaVals.filter((x) => x.kind === 'blocked').length, oaVals.filter((x) => x.kind === 'closed').length, oaVals.filter((x) => x.kind === 'not_found' || x.kind === 'error').length)
    : '';
  return (
    <>
      <h1>{mode === 'doc' ? t.reviewTitleDoc : t.reviewTitle}</h1>
      <p className="lp-lead">
        {mode !== 'bib' && extracted ? t.foundEntries(extracted.total, extracted.usable) : ''}
        {mode === 'doc' && oaSummary}
        {refFiles.length > 0 && t.pdfsLinked(refFiles.length - loose.length, refFiles.length)}
        {loose.length === 0 && withoutPdf.length === 0 ? t.allLinked : t.linkLeftovers}
      </p>
      {err && <div className="notice error">{err}</div>}
      {loose.length > 0 && (
        <section>
          <h3>{t.pdfsWithoutRef(loose.length)}</h3>
          <ul className="uf-review">
            {loose.map((f) => (
              <li key={f.id}>
                <span>{f.originalName}</span>
                <select disabled={busy} defaultValue="" onChange={(e) => void pair(f.id, e.target.value)} aria-label={t.referenceOf(f.originalName)}>
                  <option value="">{t.chooseReference}</option>
                  {bibPubs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </section>
      )}
      {withoutPdf.length > 0 && (
        <section>
          <h3>{t.refsWithoutPdf(withoutPdf.length)}</h3>
          <p className="small muted">{t.refsWithoutPdfHint}</p>
          <ul className="uf-review">
            {withoutPdf.map((p) => (
              <li key={p.id}>
                <span>
                  {p.label} <span className="small muted">{p.title}</span>
                </span>
                <OaCell state={oa[p.id]} pub={p} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <button className="primary lp-btn" onClick={onOpen}>
        {t.openInFontexto}
      </button>
    </>
  );
}
