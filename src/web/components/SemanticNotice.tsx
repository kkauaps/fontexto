import { useEffect, useState } from 'react';
import { api, edition } from '../api';
import type { CitationGraph } from '../../core/model';

interface Props {
  projectId: string;
  /** Evidence method text: tells whether the semantic re-rank is already in use. */
  method: string;
  onGraph: (g: CitationGraph) => void;
}

type State = { kind: 'idle' } | { kind: 'running'; label: string; fraction: number } | { kind: 'error'; message: string };

const PHASE: Record<string, string> = {
  download: 'Baixando o modelo (só na primeira vez)',
  init: 'Preparando o modelo',
  analyze: 'Comparando as frases com os trechos',
  apply: 'Aplicando',
};

/** Browser edition only: opt-in language-model re-ranking of the citation matches, run locally. */
export function SemanticNotice({ projectId, method, onGraph }: Props) {
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const active = method.includes('modelo de linguagem multilíngue');

  useEffect(() => {
    if (edition !== 'web') return;
    void import('../local/semanticClient').then((m) => m.modelAvailable()).then(setAvailable);
  }, []);

  if (edition !== 'web' || !available || active) return null;

  const run = async () => {
    setState({ kind: 'running', label: PHASE.download, fraction: 0 });
    try {
      const { runSemantic } = await import('../local/semanticClient');
      await runSemantic(projectId, (p) => setState({ kind: 'running', label: `${PHASE[p.phase]}${p.detail ? ` · ${p.detail}` : ''}`, fraction: p.fraction }));
      onGraph(await api.graph(projectId));
      setState({ kind: 'idle' });
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message });
    }
  };

  return (
    <div className="notice">
      {state.kind === 'running' ? (
        <>
          <span className="spinner" /> {state.label}
          <progress value={Math.max(0.02, state.fraction)} max={1} style={{ marginLeft: 8, verticalAlign: 'middle' }} />
        </>
      ) : (
        <>
          Quer achar mais trechos? A busca semântica compara o <i>sentido</i> das frases (PT↔EN) com o texto das fontes. Roda só no seu computador: baixa um modelo de ~135&nbsp;MB uma vez e depois funciona offline.{' '}
          <button className="primary" onClick={() => void run()}>
            Ativar busca semântica
          </button>
          {state.kind === 'error' && <span className="error"> {state.message}</span>}
        </>
      )}
    </div>
  );
}
