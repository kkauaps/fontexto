import { useRef, useState } from 'react';
import type { CitationGraph } from '../../core/model';
import { api } from '../api';

type Role = 'main' | 'reference';

/** File picker button that uploads to the project (private by default) and hands back the rebuilt graph. */
export function UploadButton({
  projectId,
  role,
  accept,
  multiple,
  children,
  primary,
  onGraph,
  onBusy,
  onError,
}: {
  projectId: string;
  role: Role;
  accept: string;
  multiple?: boolean;
  children: React.ReactNode;
  primary?: boolean;
  onGraph: (g: CitationGraph) => void;
  onBusy?: (busy: boolean) => void;
  onError?: (message: string | undefined) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (list: FileList | null) => {
    if (!list?.length) return;
    const files = [...list];
    if (input.current) input.current.value = '';
    setBusy(true);
    onBusy?.(true);
    onError?.(undefined);
    try {
      onGraph((await api.upload(projectId, files, role, 'private')).graph);
    } catch (e) {
      onError?.((e as Error).message);
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  };
  return (
    <>
      <button className={primary ? 'primary' : undefined} disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'Processando…' : children}
      </button>
      <input ref={input} type="file" hidden accept={accept} multiple={multiple} onChange={(e) => void pick(e.target.files)} />
    </>
  );
}

/** The three inputs the app needs, with their state, and a button for each one. */
export function SetupChecklist({ projectId, graph, onGraph }: { projectId: string; graph: CitationGraph; onGraph: (g: CitationGraph) => void }) {
  const files = Object.values(graph.files);
  const main = files.find((f) => f.role === 'main');
  const bib = files.filter((f) => f.role === 'bibtex');
  const refs = files.filter((f) => f.role === 'reference');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const common = { projectId, onGraph, onBusy: setBusy, onError: setError };
  return (
    <ol className="setup">
      <li className={main ? 'done' : ''}>
        <span className="step-no">{main ? '✓' : '1'}</span>
        <div className="step-body">
          <strong>Documento principal (PDF)</strong>
          <span className="small muted">{main ? main.originalName : 'O trabalho cujas citações você quer conferir (TCC, dissertação, artigo).'}</span>
        </div>
        <UploadButton {...common} role="main" accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" primary={!main}>
          {main ? 'Trocar PDF' : 'Escolher PDF'}
        </UploadButton>
      </li>
      <li className={bib.length ? 'done' : ''}>
        <span className="step-no">{bib.length ? '✓' : '2'}</span>
        <div className="step-body">
          <strong>Bibliografia (.bib)</strong>
          <span className="small muted">{bib.length ? bib.map((b) => b.originalName).join(', ') : 'Liga cada citação do texto à sua referência (autor e ano).'}</span>
        </div>
        <UploadButton {...common} role="reference" accept=".bib,text/plain" primary={Boolean(main) && !bib.length}>
          {bib.length ? 'Trocar .bib' : 'Escolher .bib'}
        </UploadButton>
      </li>
      <li className={refs.length ? 'done' : ''}>
        <span className="step-no">{refs.length ? '✓' : '3'}</span>
        <div className="step-body">
          <strong>PDFs das referências</strong>
          <span className="small muted">{refs.length ? `${refs.length} PDF(s) enviados` : 'Opcional, mas necessário para localizar o trecho citado em cada artigo.'}</span>
        </div>
        <UploadButton {...common} role="reference" accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" multiple>
          {refs.length ? 'Enviar mais PDFs' : 'Escolher PDFs'}
        </UploadButton>
      </li>
      {busy && (
        <li className="setup-busy">
          <span className="spinner" /> Enviando e processando… PDFs grandes podem levar alguns segundos.
        </li>
      )}
      {error && <li className="notice error">{error}</li>}
    </ol>
  );
}
