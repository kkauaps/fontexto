import type { CategoryRule } from '../../core/categories';
import type { EdgeKind, VerificationStatus } from '../../core/model';
import type { ViewFilters } from '../../core/view';
import { STATUS_HELP, STATUS_LABEL, categoryColor } from '../labels';
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

export function FiltersPanel({ filters, onChange, categories, rules, collapsed, onToggleGroup, years, hiddenCount }: Props) {
  const set = (patch: Partial<ViewFilters>) => onChange({ ...filters, ...patch });
  const toggleStatus = (s: VerificationStatus) =>
    set({ statuses: filters.statuses.includes(s) ? filters.statuses.filter((x) => x !== s) : [...filters.statuses, s] });
  const toggleCategory = (c: string) =>
    set({ categories: filters.categories.includes(c) ? filters.categories.filter((x) => x !== c) : [...filters.categories, c] });
  const relatedOn = filters.edgeKinds.includes('related_to') && filters.statuses.includes('suggested');

  return (
    <aside className="sidebar">
      <section>
        <h3>Relações</h3>
        {BIB_STATUSES.map((s) => {
          const kind: EdgeKind = s === 'suggested' ? 'related_to' : 'cites';
          const checked = s === 'suggested' ? relatedOn : filters.statuses.includes(s);
          return (
            <label key={s} className="check" title={STATUS_HELP[s]}>
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
              <span>{s === 'suggested' ? 'Relação temática sugerida' : `Citação ${STATUS_LABEL[s].toLowerCase()}`}</span>
            </label>
          );
        })}
        <p className="hint">Cores e relações temáticas nunca são evidência de citação.</p>
      </section>

      <section>
        <h3>Ano</h3>
        <div className="row">
          <input
            type="number"
            placeholder={years.min ? String(years.min) : 'de'}
            value={filters.yearMin ?? ''}
            onChange={(e) => set({ yearMin: e.target.value ? Number(e.target.value) : undefined })}
          />
          <span>–</span>
          <input
            type="number"
            placeholder={years.max ? String(years.max) : 'até'}
            value={filters.yearMax ?? ''}
            onChange={(e) => set({ yearMax: e.target.value ? Number(e.target.value) : undefined })}
          />
        </div>
        <h3>Autor</h3>
        <input type="search" placeholder="Sobrenome" value={filters.author ?? ''} onChange={(e) => set({ author: e.target.value || undefined })} />
        <label className="check">
          <input type="checkbox" checked={Boolean(filters.onlyWithPdf)} onChange={(e) => set({ onlyWithPdf: e.target.checked })} />
          <span>Somente com PDF</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={Boolean(filters.hideIsolated)} onChange={(e) => set({ hideIsolated: e.target.checked })} />
          <span>Ocultar nós sem conexões</span>
        </label>
      </section>

      <section>
        <h3>Categorias</h3>
        <p className="hint">Clique para filtrar; use ▸ para recolher o grupo em um único nó.</p>
        <ul className="legend">
          {categories.map((c) => (
            <li key={c} className={filters.categories.length && !filters.categories.includes(c) ? 'off' : ''}>
              <button className="linklike" onClick={() => toggleCategory(c)}>
                <span className="swatch" style={{ background: categoryColor(c, rules) }} />
                {c}
              </button>
              {c !== 'Documento principal' && (
                <button className="mini" title={collapsed.has(c) ? 'Expandir grupo' : 'Recolher grupo'} onClick={() => onToggleGroup(c)}>
                  {collapsed.has(c) ? '▾' : '▸'}
                </button>
              )}
            </li>
          ))}
        </ul>
        {filters.categories.length > 0 && (
          <button className="linklike small" onClick={() => set({ categories: [] })}>
            Limpar filtro de categoria
          </button>
        )}
      </section>

      <section>
        <h3>Legenda</h3>
        <ul className="legend static">
          <li>
            <span className="legend-node doc" /> Documento principal
          </li>
          <li>
            <span className="legend-node" /> Publicação (tamanho ∝ citações recebidas na rede)
          </li>
          <li>
            <span className="legend-node no-pdf" /> Publicação sem PDF disponível
          </li>
          <li>
            <span className="legend-node match" /> Resultado da pesquisa
          </li>
          <li>Seta A → B: A cita B</li>
        </ul>
        {hiddenCount > 0 && <p className="hint">{hiddenCount} nó(s) ocultos pelos filtros.</p>}
      </section>
    </aside>
  );
}
