import { useMemo, useRef, useState, type DragEvent } from 'react';
import type { CitationGraph, PublicationNode } from '../../core/model';
import { api } from '../api';
import type { FlowMode } from './Landing';
import { fetchOpenAccess, LibraryAccess, OaCell, type OaState } from './ReferencesView';
import { BackPill, HeaderControls } from './HeaderControls';
import { BrandMark } from './BrandMark';
import { privacyNote, translateRuntime, useI18n } from '../i18n';

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
const DOC_TYPES = ['PDF', 'PNG', 'JPG', 'WEBP'];
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

const fmtSize = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function UploadIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 15V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

const MAX_CHIPS = 6;

/**
 * One drop zone. Every zone has the same structure: the whole card is the click target (file picker) and the drop
 * target; dropped folders are walked (filesFromDrop), so the reference zone takes files and folders alike.
 */
function DropZone({ id, title, hint, accept, types, multiple, files, onFiles, onRemove }: { id: string; title: string; hint: string; accept: string; types: string[]; multiple?: boolean; files: File[]; onFiles: (f: File[]) => void; onRemove: (index: number) => void }) {
  const { t } = useI18n();
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const shown = files.slice(0, MAX_CHIPS);
  return (
    <div
      className={`uf-drop${over ? ' over' : ''}${files.length ? ' filled' : ''}`}
      role="group"
      aria-labelledby={`${id}-title`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={async (e) => {
        e.preventDefault();
        setOver(false);
        onFiles(await filesFromDrop(e));
      }}
    >
      <button type="button" className="uf-drop-hit" onClick={() => input.current?.click()} aria-describedby={`${id}-hint`}>
        <span className="uf-drop-icon">
          <UploadIcon />
        </span>
        <span id={`${id}-title`} className="uf-drop-title">
          {title}
        </span>
        <span id={`${id}-hint`} className="uf-drop-hint">
          {hint}
        </span>
        <span className="uf-drop-cta">{multiple ? t.dropHereMany : t.dropHereOne}</span>
        <span className="uf-drop-types" aria-hidden="true">
          {types.map((ty) => (
            <span key={ty}>{ty}</span>
          ))}
        </span>
      </button>
      <input id={id} ref={input} type="file" accept={accept} multiple={multiple} hidden aria-label={title} onChange={(e) => {
        onFiles([...(e.target.files ?? [])]);
        e.target.value = '';
      }} />
      {files.length > 0 && (
        <ul className="uf-chips" aria-live="polite" aria-label={t.filesSelected(files.length, files[0].name)}>
          {shown.map((f, i) => (
            <li key={`${f.name}-${f.size}-${i}`} className="uf-chip">
              <FileIcon />
              <span className="uf-chip-name" title={f.name}>
                {f.name}
              </span>
              <span className="uf-chip-size">{fmtSize(f.size)}</span>
              <button type="button" className="uf-chip-x" aria-label={t.removeFile(f.name)} title={t.removeFile(f.name)} onClick={() => onRemove(i)}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </li>
          ))}
          {files.length > MAX_CHIPS && <li className="uf-chip uf-chip-more">+{files.length - MAX_CHIPS}</li>}
        </ul>
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
        <button className="linklike brand-btn" onClick={onBack} aria-label={t.backToStart}>
          <BrandMark />
        </button>
        <div className="lp-nav-right">
          <HeaderControls />
        </div>
      </header>
      <div className="uf-backbar">
        <BackPill className="uf-back" onClick={onBack} label={t.back} />
      </div>
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
            <div className={`uf-grid${mode === 'bib' ? ' three' : ''}`}>
              <DropZone id="uf-main" title={t.dropYourDocument} hint={t.dropYourDocumentHint} accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" types={DOC_TYPES} files={main} onFiles={(f) => setMain(f.filter(isPdf).slice(0, 1))} onRemove={() => setMain([])} />
              {mode === 'bib' && <DropZone id="uf-bib" title={t.dropBib} hint={t.dropBibHint} accept=".bib,.bibtex" types={['.bib']} files={bib} onFiles={(f) => setBib(f.filter(isBib).slice(0, 1))} onRemove={() => setBib([])} />}
              <DropZone
                id="uf-refs"
                title={t.dropRefs(mode === 'bib' ? '3' : '2', mode === 'doc')}
                hint={mode === 'doc' ? t.dropRefsHintDoc : t.dropRefsHint}
                accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                types={DOC_TYPES}
                multiple
                files={refs}
                onRemove={(i) => setRefs((prev) => prev.filter((_, j) => j !== i))}
                onFiles={(f) => setRefs((prev) => [...prev, ...f.filter(isPdf)].filter((x, i, a) => a.findIndex((y) => y.name === x.name && y.size === x.size) === i))}
              />
            </div>
            <p className="small muted">
              {privacyNote(t)}
              {mode === 'doc' && t.privacyOaNote}
            </p>
            <button className="primary lp-btn uf-cta" disabled={!ready} onClick={() => void start()}>
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
                  <span className="uf-dot" aria-hidden="true">{s.state === 'ok' ? '✓' : ''}</span>
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
    ? t.oaSummary(oaVals.filter((x) => x.kind === 'got').length, oaVals.filter((x) => x.kind === 'blocked').length, oaVals.filter((x) => x.kind === 'closed').length, oaVals.filter((x) => x.kind === 'not_found').length) +
      (oaVals.some((x) => x.kind === 'error') ? t.oaLookupsBusy(oaVals.filter((x) => x.kind === 'error').length) : '')
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
          <LibraryAccess />
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
