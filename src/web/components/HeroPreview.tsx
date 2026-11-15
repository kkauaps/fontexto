import { useI18n } from '../i18n';

/** Themed HTML stand-in for the document view; follows data-theme. Generic, fictional sample copy in the UI language. */
export function HeroPreview() {
  const { t } = useI18n();
  const h = t.heroSample;
  return (
    <figure className="lp-preview" aria-label={t.previewDocAlt}>
      <div className="mini-app">
        <div className="mini-paper">
          <div className="mini-sheet">
            <div className="mini-kicker">{h.kicker}</div>
            <div className="ttl">{h.title}</div>
            <p>
              {h.p1} <span className="hl-warn hl-sel">(Silva et al., 2024)</span>. {h.p1b}
            </p>
            <p>
              {h.p2} <span className="hl-ok">(Silva et al., 2024)</span>, {h.p2b} <span className="hl-ok">(Doe &amp; Lee, 2023)</span>.
            </p>
            <p>
              {h.p3} <span className="hl-ok">(Chen et al., 2022; Park, 2021)</span>.
            </p>
          </div>
        </div>
        <div className="mini-side">
          <div className="k">{t.allCitations}</div>
          <div className="mini-card">
            <div className="mini-card-h">
              <b>Silva et al. (2024)</b>
              <span className="mini-pill warn">{t.statusCaveat}</span>
            </div>
            <p>“{h.q1}” · p. 3</p>
          </div>
          <div className="mini-card">
            <div className="mini-card-h">
              <b>Doe &amp; Lee (2023)</b>
              <span className="mini-pill ok">{t.statusLocated}</span>
            </div>
            <p>“{h.q2}” · p. 5</p>
          </div>
          <div className="mini-card">
            <div className="mini-card-h">
              <b>Chen et al. (2022)</b>
              <span className="mini-pill ok">{t.statusLocated}</span>
            </div>
            <p>“{h.q3}” · p. 2</p>
          </div>
        </div>
      </div>
    </figure>
  );
}
