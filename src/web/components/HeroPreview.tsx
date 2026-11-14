import { useI18n } from '../i18n';

/** Themed HTML stand-in for the document view; follows data-theme. */
export function HeroPreview() {
  const { t } = useI18n();
  return (
    <figure className="lp-preview" aria-label={t.previewDocAlt}>
      <div className="mini-app">
        <div className="mini-paper">
          <div className="mini-sheet">
            <div className="mini-kicker">Universidade Estadual de Montes Claros</div>
            <div className="ttl">Segmentação de feridas em imagens clínicas</div>
            <p>
              A identificação dos tecidos presentes no leito e nas bordas de feridas crônicas integra a avaliação clínica{' '}
              <span className="hl-warn hl-sel">(Velloran et al., 2025)</span>. Essa avaliação baseia-se, em geral, no exame visual.
            </p>
            <p>
              A segmentação e a quantificação manuais são descritas como demoradas <span className="hl-ok">(Velloran et al., 2025)</span>, e
              produzir máscaras em nível de pixel exige tempo especializado <span className="hl-ok">(Kettavainen et al., 2026)</span>.
            </p>
            <p>
              Métodos de segmentação por aprendizado profundo têm sido investigados para delimitar a ferida{' '}
              <span className="hl-ok">(Ravikandar et al., 2022; Brevald et al., 2026)</span>.
            </p>
          </div>
        </div>
        <div className="mini-side">
          <div className="k">{t.allCitations}</div>
          <div className="mini-card">
            <b>Velloran (2025)</b>
            <p>p. 7 — A identificação dos tecidos presentes no leito e nas bordas…</p>
          </div>
          <div className="mini-card">
            <b>Kettavainen (2026)</b>
            <p>p. 7 — A segmentação e a quantificação manuais…</p>
          </div>
          <div className="mini-card">
            <b>Ravikandar (2022)</b>
            <p>p. 7 — Nesse contexto, métodos de segmentação…</p>
          </div>
        </div>
      </div>
    </figure>
  );
}
