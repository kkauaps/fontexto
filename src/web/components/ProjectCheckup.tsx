import { useMemo, type ReactNode } from 'react';
import type { EvidenceReport } from '../../core/evidence';
import { projectCheckup, type GroupStatus } from '../../core/evidenceView';
import type { CitationGraph } from '../../core/model';
import { evidenceStatusText, useI18n } from '../i18n';

const ORDER: GroupStatus[] = ['localizado', 'ressalva', 'nao_localizado', 'sem_pdf', 'unresolved'];
const SHOWN = 12;

interface Props {
  graph: CitationGraph;
  evidence: EvidenceReport;
  /** Optional action next to "References without the source PDF" (look up free copies). */
  onFindPdfs?: () => void;
  /** Filters the citations by status when a legend entry is clicked (document view). */
  onStatus?: (status: GroupStatus) => void;
  className?: string;
}

/**
 * "Checkup": how the citations stand, and what the writer should fix before submitting: citations missing from the
 * reference list, year or name typos between text and list, references without their PDF, references never cited.
 */
export function ProjectCheckup({ graph, evidence, onFindPdfs, onStatus, className }: Props) {
  const { t } = useI18n();
  const c = useMemo(() => projectCheckup(graph, evidence), [graph, evidence]);
  const label = (id: string) => graph.nodes[id]?.label ?? id;
  const total = c.counts.all;

  const issue = (key: string, tone: 'bad' | 'warn' | 'info', title: string, count: number, items: ReactNode[], action?: ReactNode) =>
    count > 0 ? (
      <details key={key} className={`checkup-issue tone-${tone}`}>
        <summary>
          <span className="checkup-issue-dot" aria-hidden="true" />
          <span className="checkup-issue-title">{title}</span>
          <span className="checkup-issue-count">{count}</span>
        </summary>
        <ul>
          {items.slice(0, SHOWN)}
          {items.length > SHOWN && <li className="muted">+{items.length - SHOWN}</li>}
        </ul>
        {action}
      </details>
    ) : null;

  const issues = [
    issue(
      'unresolved',
      'bad',
      t.issueUnresolved,
      c.counts.unresolved,
      c.unresolved.map((u) => (
        <li key={u.marker}>
          <b>{u.marker}</b> <span className="muted">· {t.pageAbbr} {u.page}{u.count > 1 ? ` · ×${u.count}` : ''}</span>
        </li>
      )),
    ),
    issue(
      'year',
      'warn',
      t.issueYear,
      c.yearMismatch.reduce((s, x) => s + x.count, 0),
      c.yearMismatch.map((y) => (
        <li key={`${y.publicationId}${y.cited}`}>
          <b>{label(y.publicationId)}</b> <span className="muted">· {t.checkupTextVsList(y.cited, y.listed)}{y.count > 1 ? ` · ×${y.count}` : ''}</span>
        </li>
      )),
    ),
    issue(
      'name',
      'warn',
      t.issueName,
      c.nameMismatch.reduce((s, x) => s + x.count, 0),
      c.nameMismatch.map((y) => (
        <li key={`${y.publicationId}${y.cited}`}>
          <b>{label(y.publicationId)}</b> <span className="muted">· {t.checkupTextVsList(y.cited, y.listed)}{y.count > 1 ? ` · ×${y.count}` : ''}</span>
        </li>
      )),
    ),
    issue(
      'nopdf',
      'info',
      t.issueNoPdf,
      c.noPdf.length,
      c.noPdf.map((id) => <li key={id}>{label(id)}</li>),
      onFindPdfs ? (
        <button type="button" className="primary small checkup-action" onClick={onFindPdfs}>
          {t.checkupFindPdfs}
        </button>
      ) : undefined,
    ),
    issue('uncited', 'info', t.issueUncited, c.uncited.length, c.uncited.map((id) => <li key={id}>{label(id)}</li>)),
  ].filter(Boolean);

  return (
    <section className={`checkup${className ? ` ${className}` : ''}`} aria-label={t.checkupTitle}>
      <header className="checkup-head">
        <div>
          <h3>{t.checkupTitle}</h3>
          <p className="small muted">{t.checkupLead}</p>
        </div>
        {total > 0 && <span className="checkup-total">{t.tabCitations(total)}</span>}
      </header>
      {total > 0 && (
        <>
          <div className="checkup-bar" role="img" aria-label={ORDER.map((s) => `${evidenceStatusText(t, s)}: ${c.counts[s]}`).join(', ')}>
            {ORDER.map((s) => (c.counts[s] > 0 ? <span key={s} className={`seg st-${s}`} style={{ flexGrow: c.counts[s] }} /> : null))}
          </div>
          <ul className="checkup-legend">
            {ORDER.filter((s) => c.counts[s] > 0).map((s) => (
              <li key={s}>
                <button type="button" disabled={!onStatus} onClick={() => onStatus?.(s)}>
                  <span className={`dot st-${s}`} aria-hidden="true" />
                  {evidenceStatusText(t, s)} <b>{c.counts[s]}</b>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {issues.length ? <div className="checkup-issues">{issues}</div> : <p className="checkup-ok">✓ {t.checkupAllGood}</p>}
    </section>
  );
}
