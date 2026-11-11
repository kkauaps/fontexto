import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useEffect, useRef, useState } from 'react';
import type { ViewerTarget } from '../../core/anchors';
import { api } from '../api';
import type { OpenRequest } from './SidePanel';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface Props {
  projectId: string;
  request: OpenRequest;
  onClose: () => void;
}

type Loaded = Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;

/**
 * Local PDF viewer (pdf.js). Opens the page of the anchor and highlights it
 * only when the server validated the extractor rectangles; otherwise it opens
 * the page and says that an exact highlight is unavailable.
 */
export function PdfViewer({ projectId, request, onClose }: Props) {
  const [target, setTarget] = useState<ViewerTarget | undefined>();
  const [doc, setDoc] = useState<Loaded | undefined>();
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | undefined>();
  const [scale, setScale] = useState(1.3);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pageSize, setPageSize] = useState<{ w: number; h: number; base: { width: number; height: number } }>();

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    setDoc(undefined);
    api
      .resolveAnchor(projectId, request.anchor)
      .then(async (t) => {
        if (cancelled) return;
        setTarget(t);
        if (!t.ok) {
          setError(t.message);
          return;
        }
        setPage(t.page);
        const task = pdfjs.getDocument({ url: api.pdfUrl(projectId, t.fileId), isEvalSupported: false } as Parameters<typeof pdfjs.getDocument>[0]);
        const d = await task.promise;
        if (!cancelled) setDoc(d);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [projectId, request]);

  useEffect(() => {
    if (!doc || !canvasRef.current) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | undefined;
    (async () => {
      const p = await doc.getPage(page);
      if (cancelled) return;
      const base = p.getViewport({ scale: 1 });
      const vp = p.getViewport({ scale });
      const canvas = canvasRef.current!;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(vp.width * ratio);
      canvas.height = Math.floor(vp.height * ratio);
      canvas.style.width = `${vp.width}px`;
      canvas.style.height = `${vp.height}px`;
      setPageSize({ w: vp.width, h: vp.height, base: { width: base.width, height: base.height } });
      task = p.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: vp, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined } as Parameters<typeof p.render>[0]);
      await task.promise.catch(() => undefined);
      if (!cancelled) requestAnimationFrame(() => document.querySelector('.viewer .hl')?.scrollIntoView({ block: 'center' }));
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page, scale]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && doc) setPage((p) => Math.min(doc.numPages, p + 1));
      if (e.key === 'ArrowLeft') setPage((p) => Math.max(1, p - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc, onClose]);

  const ok = target?.ok ? target : undefined;
  const showHighlights = ok && ok.exactHighlight && page === ok.page && pageSize;
  const sx = pageSize && ok?.pageSize ? pageSize.w / ok.pageSize.width : scale;
  const sy = pageSize && ok?.pageSize ? pageSize.h / ok.pageSize.height : scale;

  return (
    <div className="viewer" role="dialog" aria-label="Visualizador de PDF">
      <header className="viewer-bar">
        <button className="primary" onClick={onClose}>
          ← Voltar ao grafo
        </button>
        <div className="viewer-title">
          <strong>{request.title}</strong>
          {request.context && <span className="small muted">{request.context}</span>}
        </div>
        <div className="viewer-nav">
          <button disabled={!doc || page <= 1} onClick={() => setPage((p) => p - 1)}>
            ‹
          </button>
          <span>
            {doc ? (
              <>
                p.{' '}
                <input
                  className="page-input"
                  type="number"
                  min={1}
                  max={doc.numPages}
                  value={page}
                  onChange={(e) => setPage(Math.min(doc.numPages, Math.max(1, Number(e.target.value) || 1)))}
                />{' '}
                / {doc.numPages}
              </>
            ) : (
              '…'
            )}
          </span>
          <button disabled={!doc || page >= doc.numPages} onClick={() => setPage((p) => p + 1)}>
            ›
          </button>
          <button onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}>−</button>
          <button onClick={() => setScale((s) => Math.min(3, s + 0.2))}>+</button>
          {ok && page !== ok.page && <button onClick={() => setPage(ok.page)}>Ir para p. {ok.page}</button>}
        </div>
      </header>
      {ok?.notice && request.anchor.text && <div className="notice">{ok.notice}</div>}
      {ok?.exactHighlight && <div className="notice ok">Trecho destacado a partir das coordenadas extraídas do PDF (nível de linha).</div>}
      {error && <div className="notice error">{error}</div>}
      <div className="viewer-body">
        <div className="page-wrap" style={pageSize ? { width: pageSize.w, height: pageSize.h } : undefined}>
          <canvas ref={canvasRef} />
          {showHighlights &&
            ok.highlights.map((r, i) => (
              <div key={i} className="hl" style={{ left: r.x * sx, top: r.y * sy, width: r.w * sx, height: r.h * sy }} />
            ))}
        </div>
      </div>
    </div>
  );
}
