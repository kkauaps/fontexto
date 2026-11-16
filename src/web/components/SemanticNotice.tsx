import { useEffect, useState } from 'react';
import { api, edition } from '../api';
import type { CitationGraph } from '../../core/model';
import { translateRuntime, useI18n } from '../i18n';

interface Props {
  projectId: string;
  /** Evidence method text: tells whether the semantic re-rank is already in use. */
  method: string;
  onGraph: (g: CitationGraph) => void;
  /** When set (phone), the notice gets its own close button. */
  onDismiss?: () => void;
  /** Reports whether the notice is on screen (the phone notice strip counts it). */
  onVisible?: (visible: boolean) => void;
}

type State = { kind: 'idle' } | { kind: 'running'; label: string; fraction: number } | { kind: 'error'; message: string };

/** Browser edition only: opt-in language-model re-ranking of the citation matches, run locally. */
export function SemanticNotice({ projectId, method, onGraph, onDismiss, onVisible }: Props) {
  const { t } = useI18n();
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const active = method.includes('modelo de linguagem multilíngue');
  const phaseOf = (phase: string) =>
    phase === 'download' ? t.phaseDownload : phase === 'init' ? t.phaseInit : phase === 'analyze' ? t.phaseAnalyze : phase === 'apply' ? t.phaseApply : phase;

  useEffect(() => {
    if (edition !== 'web') return;
    void import('../local/semanticClient').then((m) => m.modelAvailable()).then(setAvailable);
  }, []);

  const visible = edition === 'web' && available && !active;
  useEffect(() => {
    onVisible?.(visible);
    return () => onVisible?.(false);
  }, [visible, onVisible]);

  if (!visible) return null;

  const run = async () => {
    setState({ kind: 'running', label: t.phaseDownload, fraction: 0 });
    try {
      const { runSemantic } = await import('../local/semanticClient');
      await runSemantic(projectId, (p) => setState({ kind: 'running', label: `${phaseOf(p.phase)}${p.detail ? ` · ${p.detail}` : ''}`, fraction: p.fraction }));
      onGraph(await api.graph(projectId));
      setState({ kind: 'idle' });
    } catch (e) {
      setState({ kind: 'error', message: translateRuntime(t, (e as Error).message) });
    }
  };

  return (
    <div className={onDismiss ? 'notice notice-dismiss' : 'notice'}>
      {onDismiss && state.kind !== 'running' && (
        <button type="button" className="notice-x" aria-label={t.close} onClick={onDismiss}>
          ×
        </button>
      )}
      {state.kind === 'running' ? (
        <>
          <span className="spinner" /> {state.label}
          <progress value={Math.max(0.02, state.fraction)} max={1} style={{ marginLeft: 8, verticalAlign: 'middle' }} />
        </>
      ) : (
        <>
          {t.semanticPitch}{' '}
          <button className="primary" onClick={() => void run()}>
            {t.enableSemantic}
          </button>
          {state.kind === 'error' && <span className="error"> {state.message}</span>}
        </>
      )}
    </div>
  );
}
