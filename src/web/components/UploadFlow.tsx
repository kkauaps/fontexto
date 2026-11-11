import { useMemo, useRef, useState, type DragEvent } from 'react';
import type { CitationGraph, PublicationNode } from '../../core/model';
import { api } from '../api';
import { BRAND } from '../brand';
import lockup from '../assets/fontexto-lockup.svg';
import type { FlowMode } from './Landing';

interface Props {
  mode: FlowMode;
  onBack: () => void;
  /** Called when the project is ready; the app opens it. */
  onDone: (projectId: string, project: { id: string; name: string; createdAt: string }) => void;
}

type Phase = 'form' | 'working' | 'review' | 'error';
interface Step {
  label: string;
  state: 'wait' | 'run' | 'ok';
  detail?: string;
}

const isPdf = (f: File) => /\.pdf$/i.test(f.name);
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
          Escolher {multiple ? 'arquivos' : 'arquivo'}
        </button>
        {folder && (
          <button type="button" onClick={() => folderInput.current?.click()}>
            Escolher pasta
          </button>
        )}
      </div>
      <input id={id} ref={input} type="file" accept={accept} multiple={multiple} hidden onChange={(e) => onFiles([...(e.target.files ?? [])])} />
      {folder && <input ref={folderInput} type="file" hidden multiple {...({ webkitdirectory: '' } as object)} onChange={(e) => onFiles([...(e.target.files ?? [])])} />}
      {files.length > 0 && (
        <p className="uf-picked small" aria-live="polite">
          {files.length === 1 ? files[0].name : `${files.length} arquivos selecionados`}
        </p>
      )}
    </div>
  );
}

export function UploadFlow({ mode, onBack, onDone }: Props) {
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

  const ready = main.length === 1 && refs.length > 0 && (mode === 'nobib' || bib.length === 1);
  const title = mode === 'bib' ? 'Artigo + .bib + referências' : 'Só artigo + referências';

  const setStep = (i: number, s: Partial<Step>) => setSteps((all) => all.map((x, k) => (k === i ? { ...x, ...s } : x)));

  const start = async () => {
    const labels = ['Criando o projeto', 'Enviando o artigo', ...(mode === 'bib' ? ['Enviando o .bib'] : []), `Enviando ${refs.length} PDF(s) de referências`, ...(mode === 'nobib' ? ['Lendo a lista de referências do artigo'] : []), 'Ligando citações e fontes'];
    setSteps(labels.map((label) => ({ label, state: 'wait' })));
    setPhase('working');
    setError(undefined);
    let i = 0;
    try {
      setStep(i, { state: 'run' });
      const p = await api.createProject(name.trim() || main[0].name.replace(/\.pdf$/i, ''));
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
      setStep(i, { state: 'run' });
      const BATCH = 6;
      for (let k = 0; k < refs.length; k += BATCH) {
        await api.upload(p.id, refs.slice(k, k + BATCH), 'reference', 'private');
        setStep(i, { detail: `${Math.min(k + BATCH, refs.length)} de ${refs.length}` });
      }
      setStep(i++, { state: 'ok' });
      let g: CitationGraph | undefined;
      if (mode === 'nobib') {
        setStep(i, { state: 'run' });
        const r = await api.extractReferences(p.id);
        g = r.graph;
        setExtracted({ usable: r.usable, total: r.references.length, numbered: r.numbered });
        setStep(i++, { state: 'ok', detail: `${r.usable} de ${r.references.length} entradas reconhecidas` });
      }
      setStep(i, { state: 'run' });
      g = g ?? (await api.rebuild(p.id));
      setStep(i, { state: 'ok' });
      setGraph(g);
      const pending = g.fileLinks.some((l) => l.status !== 'matched' && l.status !== 'manual') || g.fileLinks.length === 0;
      if (mode === 'nobib' || pending) setPhase('review');
      else onDone(p.id, p);
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
    }
  };

  return (
    <div className="uf">
      <header className="lp-nav">
        <button className="linklike" onClick={onBack}>
          <img className="lp-logo" src={lockup} alt={BRAND.name} height={30} />
        </button>
        <button className="linklike" onClick={onBack}>
          ← Voltar
        </button>
      </header>
      <main className="uf-main">
        {phase === 'form' && (
          <>
            <h1>{title}</h1>
            <p className="lp-lead">
              {mode === 'bib'
                ? 'Envie o PDF do seu texto, o arquivo .bib e os PDFs das obras citadas.'
                : 'Envie o PDF do seu texto e os PDFs das obras citadas. A lista de referências é lida do próprio artigo e cada PDF é ligado à entrada certa pelo DOI, título e autor.'}
            </p>
            <label className="uf-name">
              <span className="small muted">Nome do projeto (opcional)</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: TCC 2026" />
            </label>
            <div className="uf-grid">
              <DropZone id="uf-main" title="1 · Artigo (PDF)" hint="O texto que cita as fontes. Só um arquivo." accept="application/pdf,.pdf" files={main} onFiles={(f) => setMain(f.filter(isPdf).slice(0, 1))} />
              {mode === 'bib' && <DropZone id="uf-bib" title="2 · Bibliografia (.bib)" hint="O arquivo BibTeX do artigo." accept=".bib,.bibtex" files={bib} onFiles={(f) => setBib(f.filter(isBib).slice(0, 1))} />}
              <DropZone
                id="uf-refs"
                title={`${mode === 'bib' ? '3' : '2'} · PDFs das referências`}
                hint="Arraste os PDFs ou uma pasta inteira. Subpastas também valem."
                accept="application/pdf,.pdf"
                multiple
                folder
                files={refs}
                onFiles={(f) => setRefs((prev) => [...prev, ...f.filter(isPdf)].filter((x, i, a) => a.findIndex((y) => y.name === x.name && y.size === x.size) === i))}
              />
            </div>
            <p className="small muted">{BRAND.privacyNote}</p>
            <button className="primary lp-btn" disabled={!ready} onClick={() => void start()}>
              Processar e abrir
            </button>
            {!ready && <p className="small muted">Falta: {[main.length !== 1 && 'o PDF do artigo', mode === 'bib' && bib.length !== 1 && 'o arquivo .bib', refs.length === 0 && 'os PDFs das referências'].filter(Boolean).join(', ')}.</p>}
          </>
        )}

        {(phase === 'working' || phase === 'error') && (
          <>
            <h1>{phase === 'working' ? 'Processando…' : 'Algo deu errado'}</h1>
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
                      Abrir o projeto assim mesmo
                    </button>
                  )}
                  <button onClick={onBack}>Voltar ao início</button>
                </div>
              </>
            )}
          </>
        )}

        {phase === 'review' && graph && project && <Review graph={graph} projectId={project.id} extracted={extracted} mode={mode} onGraph={setGraph} onOpen={() => onDone(project.id, project)} />}
      </main>
    </div>
  );
}

function Review({ graph, projectId, extracted, mode, onGraph, onOpen }: { graph: CitationGraph; projectId: string; extracted?: { usable: number; total: number; numbered: boolean }; mode: FlowMode; onGraph: (g: CitationGraph) => void; onOpen: () => void }) {
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
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h1>Revise as ligações</h1>
      <p className="lp-lead">
        {mode === 'nobib' && extracted ? `Encontrei ${extracted.total} entradas na lista de referências do artigo (${extracted.usable} com autor e ano). ` : ''}
        {refFiles.length - loose.length} de {refFiles.length} PDFs foram ligados a uma referência automaticamente.
        {loose.length === 0 && withoutPdf.length === 0 ? ' Está tudo ligado.' : ' Ligue à mão o que sobrou, se quiser; dá para fazer isso depois também.'}
      </p>
      {extracted?.numbered && <div className="notice">A lista de referências é numerada. Citações como “[3]” ainda não são reconhecidas; só as do tipo autor-data (“Silva, 2020”).</div>}
      {err && <div className="notice error">{err}</div>}
      {loose.length > 0 && (
        <section>
          <h3>PDFs sem referência ({loose.length})</h3>
          <ul className="uf-review">
            {loose.map((f) => (
              <li key={f.id}>
                <span>{f.originalName}</span>
                <select disabled={busy} defaultValue="" onChange={(e) => void pair(f.id, e.target.value)} aria-label={`Referência de ${f.originalName}`}>
                  <option value="">Escolher referência…</option>
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
          <h3>Referências sem PDF ({withoutPdf.length})</h3>
          <p className="small muted">Estas entradas não têm PDF enviado; as citações delas aparecem como “Não localizado” até você enviar o arquivo.</p>
          <ul className="uf-review">
            {withoutPdf.map((p) => (
              <li key={p.id}>
                <span>
                  {p.label} <span className="small muted">{p.title}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <button className="primary lp-btn" onClick={onOpen}>
        Abrir no Fontexto
      </button>
    </>
  );
}
