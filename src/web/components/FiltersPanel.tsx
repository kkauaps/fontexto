import type { CategoryRule } from '../../core/categories';
import type { EdgeKind, VerificationStatus } from '../../core/model';
import { REF_STATUS_COLOR, REF_STATUS_ORDER, type RefStatus } from '../../core/refStatus';
import type { ViewFilters } from '../../core/view';
import { categoryColor } from '../labels';
import { categoryLabel, refStatusText, useI18n, verificationHelp, verificationLabel } from '../i18n';
import { edgeStyleFor } from './GraphCanvas';

interface Props {
  filters: ViewFilters;
  onChange: (f: ViewFilters) => void;
  categories: string[];
  rules: CategoryRule[];
  collapsed: Set<string>;
  onToggleGroup: (c: string) => void;
  years: { min?: number; max?: number };
  hiddenCount: number;
  refCounts: Record<RefStatus, number>;
}

const BIB_STATUSES: VerificationStatus[] = ['confirmed', 'unverified', 'suggested', 'rejected'];

function EdgeSwatch({ kind, status }: { kind: EdgeKind; status: VerificationStatus }) {
  const st = edgeStyleFor({ kind, status });
  return (
    <svg width="34" height="10" aria-hidden>
      <line x1="1" y1="5" x2={st.arrow ? 26 : 33} y2="5" stroke={st.stroke} strokeWidth={st.width + 0.4} strokeDasharray={st.dash} />
      {st.arrow && <path d="M26 1 L33 5 L26 9 z" fill={st.stroke} />}
    </svg>
  );
}

export function FiltersPanel({ filters, onChange, categories, rules, collapsed, onToggleGroup, years, hiddenCount, refCounts }: Props) {
  const { t } = useI18n();
  const set = (patch: Partial<ViewFilters>) => onChange({ ...filters, ...patch });
  const toggleStatus = (s: VerificationStatus) =>
    set({ statuses: filters.statuses.includes(s) ? filters.statuses.filter((x) => x !== s) : [...filters.statuses, s] });
  const toggleCategory = (c: string) =>
    set({ categories: filters.categories.includes(c) ? filters.categories.filter((x) => x !== c) : [...filters.categories, c] });
  const relatedOn = filters.edgeKinds.includes('related_to') && filters.statuses.includes('suggested');
  const byStatus = filters.colorBy !== 'category';
  const refOn = (s: RefStatus) => !filters.refStatuses?.length || filters.refStatuses.includes(s);
  const toggleRef = (s: RefStatus) => {
    const cur = filters.refStatuses?.length ? filters.refStatuses : REF_STATUS_ORDER;
    const next = cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s];
    set({ refStatuses: next.length === REF_STATUS_ORDER.length ? [] : next });
  };

  return (
    <aside className="sidebar">
      <section>
        <h3>{t.colors}</h3>
        <div className="seg" role="radiogroup" aria-label={t.colorBy}>
          <button role="radio" aria-checked={byStatus} className={byStatus ? 'on' : ''} onClick={() => set({ colorBy: 'status' })}>
            {t.situation}
          </button>
          <button role="radio" aria-checked={!byStatus} className={!byStatus ? 'on' : ''} onClick={() => set({ colorBy: 'category' })}>
            {t.theme}
          </button>
        </div>
      </section>

      <section>
        <h3>{t.sourceStatus}</h3>
        <p className="hint">{t.sourceStatusHint}</p>
        {REF_STATUS_ORDER.filter((s) => refCounts[s] > 0).map((s) => (
          <label key={s} className="check">
            <input type="checkbox" checked={refOn(s)} onChange={() => toggleRef(s)} />
            <span className="swatch" style={{ background: REF_STATUS_COLOR[s] }} />
            <span>
              {refStatusText(t, s)} ({refCounts[s]})
            </span>
          </label>
        ))}
      </section>

      <section>
        <h3>{t.links}</h3>
        <label className="check" title={t.showInterSourceTitle}>
          <input type="checkbox" checked={filters.interSource !== false} onChange={(e) => set({ interSource: e.target.checked })} />
          <span>{t.showInterSource}</span>
        </label>
        {BIB_STATUSES.map((s) => {
          const kind: EdgeKind = s === 'suggested' ? 'related_to' : 'cites';
          const checked = s === 'suggested' ? relatedOn : filters.statuses.includes(s);
          return (
            <label key={s} className="check" title={verificationHelp(t, s)}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {
                  if (s === 'suggested') {
                    const on = !relatedOn;
                    set({
                      edgeKinds: on ? [...new Set([...filters.edgeKinds, 'related_to' as EdgeKind])] : filters.edgeKinds.filter((k) => k !== 'related_to'),
                      statuses: on ? [...new Set([...filters.statuses, 'suggested' as VerificationStatus])] : filters.statuses.filter((x) => x !== 'suggested'),
                    });
                  } else toggleStatus(s);
                }}
              />
              <EdgeSwatch kind={kind} status={s} />
              <span>{s === 'suggested' ? t.suggestedThematic : s === 'confirmed' ? t.citationConfirmed : s === 'unverified' ? t.citationUnverified : t.citationRejected}</span>
            </label>
          );
        })}
        <p className="hint">{t.thematicNeverEvidence}</p>
      </section>

      <section>
        <h3>{t.year}</h3>
        <div className="row">
          <input
            type="number"
            placeholder={years.min ? String(years.min) : t.yearFrom}
            value={filters.yearMin ?? ''}
            onChange={(e) => set({ yearMin: e.target.value ? Number(e.target.value) : undefined })}
          />
          <span>–</span>
          <input
            type="number"
            placeholder={years.max ? String(years.max) : t.yearTo}
            value={filters.yearMax ?? ''}
            onChange={(e) => set({ yearMax: e.target.value ? Number(e.target.value) : undefined })}
          />
        </div>
        <h3>{t.author}</h3>
        <input type="search" placeholder={t.surname} value={filters.author ?? ''} onChange={(e) => set({ author: e.target.value || undefined })} />
        <label className="check">
          <input type="checkbox" checked={Boolean(filters.onlyWithPdf)} onChange={(e) => set({ onlyWithPdf: e.target.checked })} />
          <span>{t.onlyWithPdf}</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={Boolean(filters.hideIsolated)} onChange={(e) => set({ hideIsolated: e.target.checked })} />
          <span>{t.hideIsolated}</span>
        </label>
      </section>

      {!byStatus && (
      <section>
        <h3>{t.topics}</h3>
        <p className="hint">{t.topicsHint}</p>
        <ul className="legend">
          {categories.map((c) => (
            <li key={c} className={filters.categories.length && !filters.categories.includes(c) ? 'off' : ''}>
              <button className="linklike" onClick={() => toggleCategory(c)}>
                <span className="swatch" style={{ background: categoryColor(c, rules) }} />
                {categoryLabel(t, c)}
              </button>
              {c !== 'Documento principal' && (
                <button className="mini" title={collapsed.has(c) ? t.expandGroup : t.collapseGroup} onClick={() => onToggleGroup(c)}>
                  {collapsed.has(c) ? '▾' : '▸'}
                </button>
              )}
            </li>
          ))}
        </ul>
        {filters.categories.length > 0 && (
          <button className="linklike small" onClick={() => set({ categories: [] })}>
            {t.clearTopicFilter}
          </button>
        )}
      </section>
      )}

      <section>
        <h3>{t.legend}</h3>
        <ul className="legend static">
          <li>
            <span className="legend-node doc" /> {t.mainDocument}
          </li>
          <li>
            <span className="legend-node" /> {t.citedSource}
          </li>
          <li>
            <span className="legend-node no-pdf" /> {t.sourceWithoutPdf}
          </li>
          <li>
            <span className="legend-node match" /> {t.searchResult}
          </li>
          <li>{t.arrowMeans}</li>
        </ul>
        {hiddenCount > 0 && <p className="hint">{t.hiddenNodes(hiddenCount)}</p>}
      </section>
    </aside>
  );
}
