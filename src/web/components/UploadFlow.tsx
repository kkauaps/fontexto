import { useMemo, useRef, useState, type DragEvent } from 'react';
import type { CitationGraph, PublicationNode } from '../../core/model';
import { api } from '../api';
import { BRAND } from '../brand';
import lockup from '../assets/fontexto-lockup.svg';
import type { FlowMode } from './Landing';
import { fetchOpenAccess, OaCell, type OaState } from './ReferencesView';

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

  const [oa, setOa] = useState<Record<string, OaState>>({});
  const ready = main.length === 1 && (mode === 'doc' || refs.length > 0) && (mode !== 'bib' || bib.length === 1);
  const title = mode === 'bib' ? 'Documento + .bib + referências' : mode === 'doc' ? 'Só o meu documento' : 'Documento + PDFs das referências';
  const readsList = mode !== 'bib';

  const setStep = (i: number, s: Partial<Step>) => setSteps((all) => all.map((x, k) => (k === i ? { ...x, ...s } : x)));

  const start = async () => {
    const labels = [
      'Criando o projeto',
      'Enviando o documento',
      ...(mode === 'bib' ? ['Enviando o .bib'] : []),
      ...(refs.length ? [`Enviando ${refs.length} arquivo(s) de referências`] : []),
      ...(readsList ? ['Lendo a lista de referências do documento'] : []),
      ...(mode === 'doc' ? ['Buscando PDFs gratuitos das referências'] : []),
      'Conferindo as citações',
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
          setStep(i, { detail: `${Math.min(k + BATCH, refs.length)} de ${refs.length}` });
        }
        setStep(i++, { state: 'ok' });
      }
      let g: CitationGraph | undefined;
      if (readsList) {
        setStep(i, { state: 'run' });
        const r = await api.extractReferences(p.id);
        g = r.graph;
        setExtracted({ usable: r.usable, total: r.references.length, numbered: r.numbered });
        setStep(i++, { state: 'ok', detail: `${r.usable} de ${r.references.length} entradas reconhecidas` });
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
          setStep(step, { detail: `${finished} de ${missing.length} consultadas · ${Object.values(states).filter((x) => x.kind === 'got').length} PDF(s) obtidos` });
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
                : mode === 'doc'
                  ? 'Envie só o PDF do seu texto. A lista de referências é lida do documento e os PDFs gratuitos das obras citadas são buscados em bases abertas (OpenAlex, Semantic Scholar, arXiv). As que não forem gratuitas ficam marcadas para você enviar depois, se quiser.'
                  : 'Envie o PDF do seu texto e os PDFs das obras citadas. A lista de referências é lida do próprio documento e cada PDF é ligado à entrada certa pelo DOI, título e autor.'}
            </p>
            <label className="uf-name">
              <span className="small muted">Nome do projeto (opcional)</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: TCC 2026" />
            </label>
            <div className="uf-grid">
              <DropZone id="uf-main" title="1 · Seu documento" hint="PDF, foto ou scan (PNG/JPG). Só um arquivo." accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" files={main} onFiles={(f) => setMain(f.filter(isPdf).slice(0, 1))} />
              {mode === 'bib' && <DropZone id="uf-bib" title="2 · Bibliografia (.bib)" hint="O arquivo BibTeX do artigo." accept=".bib,.bibtex" files={bib} onFiles={(f) => setBib(f.filter(isBib).slice(0, 1))} />}
              <DropZone
                id="uf-refs"
                title={`${mode === 'bib' ? '3' : '2'} · PDFs das referências${mode === 'doc' ? ' (opcional)' : ''}`}
                hint={mode === 'doc' ? 'Já tem alguns PDFs (ex.: os pagos)? Envie aqui; o resto é buscado.' : 'Arraste os PDFs ou uma pasta inteira. Subpastas também valem.'}
                accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                multiple
                folder
                files={refs}
                onFiles={(f) => setRefs((prev) => [...prev, ...f.filter(isPdf)].filter((x, i, a) => a.findIndex((y) => y.name === x.name && y.size === x.size) === i))}
              />
            </div>
            <p className="small muted">
              {BRAND.privacyNote}
              {mode === 'doc' && ' Para a busca, só o DOI, o título, o ano e o 1º autor de cada referência são enviados ao servidor do Fontexto, que não guarda nada.'}
            </p>
            <button className="primary lp-btn" disabled={!ready} onClick={() => void start()}>
              Processar e abrir
            </button>
            {!ready && <p className="small muted">Falta: {[main.length !== 1 && 'o PDF do documento', mode === 'bib' && bib.length !== 1 && 'o arquivo .bib', mode !== 'doc' && refs.length === 0 && 'os PDFs das referências'].filter(Boolean).join(', ')}.</p>}
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

        {phase === 'review' && graph && project && <Review graph={graph} projectId={project.id} extracted={extracted} mode={mode} oa={oa} onGraph={setGraph} onOpen={() => onDone(project.id, project, oa)} />}
      </main>
    </div>
  );
}

function Review({ graph, projectId, extracted, mode, oa, onGraph, onOpen }: { graph: CitationGraph; projectId: string; extracted?: { usable: number; total: number; numbered: boolean }; mode: FlowMode; oa: Record<string, OaState>; onGraph: (g: CitationGraph) => void; onOpen: () => void }) {
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
  const oaVals = Object.values(oa);
  const oaSummary = oaVals.length
    ? `PDFs gratuitos: ${oaVals.filter((x) => x.kind === 'got').length} baixados, ${oaVals.filter((x) => x.kind === 'blocked').length} gratuitos com download manual, ${oaVals.filter((x) => x.kind === 'closed').length} sem versão gratuita, ${oaVals.filter((x) => x.kind === 'not_found' || x.kind === 'error').length} não identificados. `
    : '';
  return (
    <>
      <h1>{mode === 'doc' ? 'Pronto: veja o que foi encontrado' : 'Revise as ligações'}</h1>
      <p className="lp-lead">
        {mode !== 'bib' && extracted ? `Encontrei ${extracted.total} entradas na lista de referências do documento (${extracted.usable} com autor e ano). ` : ''}
        {mode === 'doc' && oaSummary}
        {refFiles.length > 0 && `${refFiles.length - loose.length} de ${refFiles.length} PDFs estão ligados a uma referência.`}
        {loose.length === 0 && withoutPdf.length === 0 ? ' Está tudo ligado.' : ' Ligue à mão o que sobrou, se quiser; dá para fazer isso depois também.'}
      </p>
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
          <p className="small muted">Estas fontes existem, só não temos o PDF. As citações delas ficam como “sem PDF” até você enviar o arquivo (dá para fazer depois, na aba Referências).</p>
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
        Abrir no Fontexto
      </button>
    </>
  );
}
