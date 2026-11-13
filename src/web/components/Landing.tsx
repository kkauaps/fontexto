import type { ProjectSummary } from '../api';
import { BRAND } from '../brand';
import lockup from '../assets/fontexto-lockup.svg';
import mark from '../assets/fontexto-mark.svg';

export type FlowMode = 'doc' | 'bib' | 'nobib';

interface Props {
  projects: ProjectSummary[];
  error?: string;
  onStart: (mode: FlowMode) => void;
  onOpen: (projectId: string) => void;
}

const STEPS = [
  { n: '1', title: 'Envie seu documento', text: 'Só o PDF do seu texto já basta: o Fontexto lê a bibliografia e busca os PDFs gratuitos das referências. Tem os PDFs ou o .bib? Envie junto.' },
  { n: '2', title: 'Ele cruza tudo', text: 'Cada citação é ligada à referência certa, e a frase que cita é procurada no PDF dessa referência.' },
  { n: '3', title: 'Você confere', text: 'Abra a fonte já na página do trecho, compare com outras passagens candidatas e decida você mesmo. Nada vira “comprovado” sem a sua revisão.' },
];

export function Landing({ projects, error, onStart, onOpen }: Props) {
  return (
    <div className="landing">
      <header className="lp-nav">
        <img className="lp-logo" src={lockup} alt={BRAND.name} height={34} />
        <nav aria-label="Seções">
          <a href="#como-funciona">Como funciona</a>
          <a href="#privacidade">Privacidade</a>
          {projects.length > 0 && <a href="#projetos">Abrir projeto</a>}
        </nav>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-hero-text">
            <h1>Cada citação ligada ao trecho exato da fonte</h1>
            <p className="lp-lead">
              Envie seu documento. O Fontexto encontra as referências, busca os artigos gratuitos e mostra, para cada citação, a página onde a fonte diz aquilo, pronta para você conferir.
            </p>
            <div className="lp-cta">
              <button className="primary lp-btn" onClick={() => onStart('doc')}>
                Só o meu documento
              </button>
              <button className="lp-btn lp-btn-soft" onClick={() => onStart('nobib')}>
                Documento + PDFs das referências
              </button>
            </div>
            <p className="lp-hint small">
              “Só o meu documento” busca os PDFs gratuitos das referências (OpenAlex, Semantic Scholar, arXiv). Tem um .bib?{' '}
              <button className="linklike" onClick={() => onStart('bib')}>
                Envie com o .bib
              </button>
            </p>
          </div>
          <figure className="lp-preview">
            <img src="/preview-documento.png" alt="Tela do Fontexto: o texto do artigo com as citações marcadas e, ao lado, a passagem encontrada na fonte" width={1280} height={800} />
          </figure>
        </section>

        <section id="como-funciona" className="lp-steps">
          <h2>Como funciona</h2>
          <ol>
            {STEPS.map((s) => (
              <li key={s.n}>
                <span className="lp-step-n" aria-hidden="true">
                  {s.n}
                </span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="lp-preview2">
          <figure>
            <img src="/preview-grafo.png" alt="Grafo de citações do projeto: o documento principal e as publicações citadas, ligadas por setas" width={1280} height={800} loading="lazy" />
            <figcaption className="small muted">O grafo mostra quem cita quem; a aba Documento mostra cada citação no texto.</figcaption>
          </figure>
        </section>

        <section id="privacidade" className="lp-privacy">
          <img src={mark} alt="" width={44} height={39} />
          <div>
            <h2>Seus arquivos ficam com você</h2>
            <p>
              {BRAND.privacyNote} Seus PDFs nunca são enviados. Só quando você pede a busca de PDFs gratuitos, o DOI, o título, o ano e o 1º autor de cada referência
              vão ao nosso servidor, que consulta bases abertas e devolve o PDF sem guardar nada. Não há anúncios nem rastreadores.
            </p>
          </div>
        </section>

        {(projects.length > 0 || error) && (
          <section id="projetos" className="lp-projects">
            <h2>Abrir projeto</h2>
            {error && <div className="notice error">{error}</div>}
            <ul>
              {projects.map((p) => (
                <li key={p.id}>
                  <button className="lp-project" onClick={() => onOpen(p.id)}>
                    <strong>{p.name}</strong>
                    <span className="small muted">criado em {new Date(p.createdAt).toLocaleDateString('pt-BR')}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <footer className="lp-footer small">
        <img src={mark} alt="" width={22} height={20} />
        <span>
          {BRAND.name} · O rótulo de cada citação é um apoio à leitura, não uma prova. Confira sempre o trecho na fonte.
        </span>
      </footer>
    </div>
  );
}
