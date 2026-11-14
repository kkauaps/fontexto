import { useI18n } from '../i18n';

/** Themed HTML stand-in for the document view; follows data-theme. Generic placeholder copy only. */
export function HeroPreview() {
  const { t } = useI18n();
  return (
    <figure className="lp-preview" aria-label={t.previewDocAlt}>
      <div className="mini-app">
        <div className="mini-paper">
          <div className="mini-sheet">
            <div className="mini-kicker">Sample University</div>
            <div className="ttl">An example paper on climate data</div>
            <p>
              Recent assessments of regional temperature records show a consistent warming trend over the last fifty years{' '}
              <span className="hl-warn hl-sel">(Silva et al., 2024)</span>. These records are typically compiled from weather stations and satellite observations.
            </p>
            <p>
              Manual review of station metadata is described as time-consuming <span className="hl-ok">(Silva et al., 2024)</span>, and
              producing quality-controlled series requires specialized work <span className="hl-ok">(Doe &amp; Lee, 2023)</span>.
            </p>
            <p>
              Automated methods have been investigated to flag outliers in climate series{' '}
              <span className="hl-ok">(Chen et al., 2022; Park, 2021)</span>.
            </p>
          </div>
        </div>
        <div className="mini-side">
          <div className="k">{t.allCitations}</div>
          <div className="mini-card">
            <b>Silva et al. (2024)</b>
            <p>p. 7 — Recent assessments of regional temperature…</p>
          </div>
          <div className="mini-card">
            <b>Doe &amp; Lee (2023)</b>
            <p>p. 7 — Manual review of station metadata…</p>
          </div>
          <div className="mini-card">
            <b>Chen et al. (2022)</b>
            <p>p. 7 — Automated methods have been investigated…</p>
          </div>
        </div>
      </div>
    </figure>
  );
}
