import { useRef, useState } from 'react';
import type { CitationGraph } from '../../core/model';
import { api } from '../api';
import { translateRuntime, useI18n } from '../i18n';

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
  const { t } = useI18n();
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
      onError?.(translateRuntime(t, (e as Error).message));
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  };
  return (
    <>
      <button className={primary ? 'primary' : undefined} disabled={busy} onClick={() => input.current?.click()}>
        {busy ? t.processingShort : children}
      </button>
      <input ref={input} type="file" hidden accept={accept} multiple={multiple} onChange={(e) => void pick(e.target.files)} />
    </>
  );
}

/** The three inputs the app needs, with their state, and a button for each one. */
export function SetupChecklist({ projectId, graph, onGraph }: { projectId: string; graph: CitationGraph; onGraph: (g: CitationGraph) => void }) {
  const { t } = useI18n();
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
          <strong>{t.mainDocumentPdf}</strong>
          <span className="small muted">{main ? main.originalName : t.mainDocumentHint}</span>
        </div>
        <UploadButton {...common} role="main" accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" primary={!main}>
          {main ? t.swapPdf : t.choosePdf}
        </UploadButton>
      </li>
      <li className={bib.length ? 'done' : ''}>
        <span className="step-no">{bib.length ? '✓' : '2'}</span>
        <div className="step-body">
          <strong>{t.bibliographyBib}</strong>
          <span className="small muted">{bib.length ? bib.map((b) => b.originalName).join(', ') : t.bibliographyHint}</span>
        </div>
        <UploadButton {...common} role="reference" accept=".bib,text/plain" primary={Boolean(main) && !bib.length}>
          {bib.length ? t.swapBib : t.chooseBib}
        </UploadButton>
      </li>
      <li className={refs.length ? 'done' : ''}>
        <span className="step-no">{refs.length ? '✓' : '3'}</span>
        <div className="step-body">
          <strong>{t.referencePdfs}</strong>
          <span className="small muted">{refs.length ? t.pdfsSent(refs.length) : t.referencePdfsHint}</span>
        </div>
        <UploadButton {...common} role="reference" accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" multiple>
          {refs.length ? t.sendMorePdfs : t.choosePdfs}
        </UploadButton>
      </li>
      {busy && (
        <li className="setup-busy">
          <span className="spinner" /> {t.sendingAndProcessing}
        </li>
      )}
      {error && <li className="notice error">{error}</li>}
    </ol>
  );
}
