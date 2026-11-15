import { BackPill } from './HeaderControls';
import { useEffect, useRef, useState } from 'react';
import type { ViewerTarget } from '../../core/anchors';
import { api } from '../api';
import { locatePhraseBoxes, openPdf, renderPage, type BoxRect, type PdfDoc } from '../pdfRender';
import type { OpenRequest } from './SidePanel';
import { translateRuntime, useI18n } from '../i18n';
import { isPhoneWidth, phoneFitScale } from '../fit';

interface Props {
  projectId: string;
  request: OpenRequest;
  /** Where "back" leads, e.g. "Voltar ao documento". */
  backLabel?: string;
  onClose: () => void;
  /** Fills the app main pane (mobile Source tab) instead of a modal layer. */
  embedded?: boolean;
}


/**
 * Local PDF viewer (pdf.js). Opens the page of the anchor and highlights it
 * only when the server validated the extractor rectangles; otherwise it opens
 * the page and says that an exact highlight is unavailable.
 */
export function PdfViewer({ projectId, request: initial, backLabel, onClose, embedded }: Props) {
  const { t } = useI18n();
  const [request, setRequest] = useState<OpenRequest>(initial);
  useEffect(() => setRequest(initial), [initial]);
  const [target, setTarget] = useState<ViewerTarget | undefined>();
  const [doc, setDoc] = useState<PdfDoc | undefined>();
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | undefined>();
  const [scale, setScale] = useState(1.3);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const fitted = useRef(false);

  const scrollToHighlight = () => {
    const host = bodyRef.current;
    const el = host?.querySelector('.hl');
    el?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  };
  const [phraseBoxes, setPhraseBoxes] = useState<{ boxes: BoxRect[]; exact: boolean } | undefined>();
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
        const d = await openPdf(await api.pdfSource(projectId, t.fileId)).promise;
        if (cancelled) return;
        if (!fitted.current) {
          fitted.current = true;
          const fit = phoneFitScale((await d.getPage(t.page)).getViewport({ scale: 1 }).width, bodyRef.current?.clientWidth);
          if (cancelled) return;
          if (fit) setScale(fit);
        }
        setDoc(d);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [projectId, request]);

  useEffect(() => {
    if (!doc || !canvasRef.current || !layerRef.current) return;
    let cancelled = false;
    let cancel: (() => void) | undefined;
    setPhraseBoxes(undefined);
    (async () => {
      const base = (await doc.getPage(page)).getViewport({ scale: 1 });
      const r = await renderPage(doc, page, scale, canvasRef.current!, layerRef.current!);
      cancel = r.cancel;
      if (cancelled) return r.cancel();
      setPageSize({ w: r.width, h: r.height, base: { width: base.width, height: base.height } });
      await r.done;
      if (cancelled) return;
      if (request.phrase && layerRef.current) {
        const hit = locatePhraseBoxes(layerRef.current, request.phrase);
        setPhraseBoxes(hit ? { boxes: hit.boxes, exact: hit.exact } : { boxes: [], exact: false });
        requestAnimationFrame(scrollToHighlight);
      } else {
        requestAnimationFrame(scrollToHighlight);
      }
    })();
    return () => {
      cancelled = true;
      cancel?.();
    };
  }, [doc, page, scale, request.phrase]);

  const ok = target?.ok ? target : undefined;
  const showHighlights = ok && ok.exactHighlight && page === ok.page && pageSize;

  useEffect(() => {
    if (!pageSize || !bodyRef.current) return;
    const hasPhrase = (phraseBoxes?.boxes.length ?? 0) > 0;
    const hasAnchor = Boolean(showHighlights && ok?.highlights.length);
    if (!hasPhrase && !hasAnchor) return;
    let frames = 0;
    let raf = 0;
    const tick = () => {
      if (bodyRef.current?.querySelector('.hl')) scrollToHighlight();
      else if (frames++ < 90) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pageSize, phraseBoxes, showHighlights, ok?.highlights, page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && doc) setPage((p) => Math.min(doc.numPages, p + 1));
      if (e.key === 'ArrowLeft') setPage((p) => Math.max(1, p - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc, onClose]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !doc) return;
    const refit = () => {
      if (!isPhoneWidth() || !target?.ok) return;
      void doc.getPage(page).then((p) => {
        const fit = phoneFitScale(p.getViewport({ scale: 1 }).width, el.clientWidth);
        if (fit) setScale(fit);
      });
    };
    refit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(refit) : undefined;
    ro?.observe(el);
    window.addEventListener('orientationchange', refit);
    return () => {
      ro?.disconnect();
      window.removeEventListener('orientationchange', refit);
    };
  }, [doc, page, target?.ok]);

  const sx = pageSize && ok?.pageSize ? pageSize.w / ok.pageSize.width : scale;
  const sy = pageSize && ok?.pageSize ? pageSize.h / ok.pageSize.height : scale;

  return (
    <div className={`viewer${embedded ? ' viewer-embedded' : ''}`} role={embedded ? undefined : 'dialog'} aria-label={embedded ? undefined : t.pdfViewer}>
      {!embedded && (
        <header className="viewer-bar">
          <BackPill onClick={onClose} label={backLabel ?? t.back} />
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
                  {t.pageAbbr}{' '}
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
            <button onClick={() => setScale((s) => Math.max(0.4, +(s - 0.2).toFixed(2)))}>−</button>
            <button onClick={() => setScale((s) => Math.min(3, +(s + 0.2).toFixed(2)))}>+</button>
            {ok && page !== ok.page && <button onClick={() => setPage(ok.page)}>{t.goToPage(ok.page)}</button>}
          </div>
        </header>
      )}
      {embedded && (
        <div className="viewer-float" role="toolbar" aria-label={t.pdfViewer}>
          <span className="viewer-float-title" title={request.title}>
            {request.title}
          </span>
          <div className="viewer-nav viewer-nav-float">
            <button disabled={!doc || page <= 1} onClick={() => setPage((p) => p - 1)} title={t.goToPage(Math.max(1, page - 1))}>
              ‹
            </button>
            <span className="small muted">
              {doc ? `${t.pageAbbr} ${page} / ${doc.numPages}` : '…'}
            </span>
            <button disabled={!doc || page >= doc.numPages} onClick={() => setPage((p) => p + 1)} title={t.goToPage(Math.min(doc?.numPages ?? page + 1, page + 1))}>
              ›
            </button>
            <button type="button" onClick={() => setScale((s) => Math.max(0.4, +(s - 0.2).toFixed(2)))} title={t.zoomOut}>
              −
            </button>
            <button type="button" onClick={() => setScale((s) => Math.min(3, +(s + 0.2).toFixed(2)))} title={t.zoomIn}>
              +
            </button>
          </div>
        </div>
      )}
      {!embedded && request.citing && (
        <div className="cite-ctx">
          <span className="small muted">{t.citingSentence}</span>
          <div>{request.citing}</div>
        </div>
      )}
      {!embedded && request.alternatives && request.alternatives.length > 1 && (
        <div className="alt-bar">
          <span className="small muted">{t.passagesFound}</span>
          {request.alternatives.map((a, i) => (
            <button key={i} className={i === (request.altIndex ?? 0) ? 'chip-filter on' : 'chip-filter'} onClick={() => setRequest({ ...a.request, alternatives: request.alternatives, altIndex: i })}>
              {a.label}
            </button>
          ))}
        </div>
      )}
      {!embedded && ok?.notice && request.anchor.text && !request.phrase && <div className="notice">{translateRuntime(t, ok.notice)}</div>}
      {!embedded && request.phrase && phraseBoxes && phraseBoxes.boxes.length > 0 && (
        <div className="notice ok">{phraseBoxes.exact ? t.passageHighlighted : t.passageStartHighlighted}</div>
      )}
      {!embedded && request.phrase && phraseBoxes && phraseBoxes.boxes.length === 0 && (
        <div className="notice">{t.couldNotMarkPassage(request.phrase)}</div>
      )}
      {!embedded && ok?.exactHighlight && <div className="notice ok">{t.lineLevelHighlight}</div>}
      {error && !embedded && <div className="notice error">{translateRuntime(t, error)}</div>}
      {error && embedded && <div className="notice error viewer-toast">{translateRuntime(t, error)}</div>}
      <div className="viewer-body" ref={bodyRef}>
        <div className="page-wrap" style={pageSize ? { width: pageSize.w, height: pageSize.h } : undefined}>
          <canvas ref={canvasRef} />
          <div ref={layerRef} className="ct-textlayer" />
          {phraseBoxes?.boxes.map((b, i) => (
            <div key={`p${i}`} className="hl" style={{ left: b.left - 1, top: b.top - 1, width: b.width + 2, height: b.height + 2 }} />
          ))}
          {showHighlights &&
            ok.highlights.map((r, i) => (
              <div key={i} className="hl" style={{ left: r.x * sx, top: r.y * sy, width: r.w * sx, height: r.h * sy }} />
            ))}
        </div>
      </div>
    </div>
  );
}
