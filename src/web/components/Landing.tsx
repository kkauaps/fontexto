import type { ProjectSummary } from '../api';
import { BRAND } from '../brand';
import { HeaderControls } from './HeaderControls';
import { BrandMark } from './BrandMark';
import { HeroPreview } from './HeroPreview';
import { formatDate, privacyNote, useI18n } from '../i18n';

export type FlowMode = 'doc' | 'bib' | 'nobib';

interface Props {
  projects: ProjectSummary[];
  error?: string;
  onStart: (mode: FlowMode) => void;
  onOpen: (projectId: string) => void;
}

export function Landing({ projects, error, onStart, onOpen }: Props) {
  const { t, locale } = useI18n();
  const steps = [
    { n: '1', title: t.step1Title, text: t.step1Text },
    { n: '2', title: t.step2Title, text: t.step2Text },
    { n: '3', title: t.step3Title, text: t.step3Text },
  ];
  return (
    <div className="landing">
      <header className="lp-nav">
        <BrandMark />
        <div className="lp-nav-right">
          <nav aria-label={t.navSections}>
            <a href="#como-funciona">{t.navHowItWorks}</a>
            <a href="#privacidade">{t.navPrivacy}</a>
            {projects.length > 0 && <a href="#projetos">{t.navOpenProject}</a>}
          </nav>
          <HeaderControls />
        </div>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-hero-text">
            <div className="lp-kicker">{BRAND.name}</div>
            <h1>{t.tagline}</h1>
            <p className="lp-lead">{t.heroLead}</p>
            <div className="lp-cta">
              <button className="primary lp-btn" onClick={() => onStart('doc')}>
                {t.ctaJustDoc}
              </button>
              <button className="lp-btn lp-btn-soft" onClick={() => onStart('nobib')}>
                {t.ctaDocAndPdfs}
              </button>
            </div>
            <p className="lp-hint small">
              {t.heroHint}{' '}
              <button className="linklike" onClick={() => onStart('bib')}>
                {t.ctaWithBib}
              </button>
            </p>
          </div>
          <HeroPreview />
        </section>

        <section id="como-funciona" className="lp-steps">
          <h2>{t.howItWorks}</h2>
          <ol>
            {steps.map((s) => (
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


        <section id="privacidade" className="lp-privacy">
          <BrandMark wordmark={false} />
          <div>
            <h2>{t.privacyTitle}</h2>
            <p>
              {privacyNote(t)} {t.privacyBody}
            </p>
          </div>
        </section>

        {(projects.length > 0 || error) && (
          <section id="projetos" className="lp-projects">
            <h2>{t.openProject}</h2>
            {error && (
              <div className="notice error">
                {error === '__browser__' ? t.errorBrowser : error === '__api__' ? t.errorApiDown : error}
              </div>
            )}
            <ul>
              {projects.map((p) => (
                <li key={p.id}>
                  <button className="lp-project" onClick={() => onOpen(p.id)}>
                    <strong>{p.name}</strong>
                    <span className="small muted">{t.createdOn(formatDate(locale, p.createdAt))}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <footer className="lp-footer small">
        <BrandMark wordmark={false} />
        <span>
          {BRAND.name} · {t.footerNote}
        </span>
      </footer>
    </div>
  );
}
