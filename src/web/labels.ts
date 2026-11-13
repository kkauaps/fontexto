import type { CategoryRule } from '../core/categories';
import { UNCATEGORIZED } from '../core/categories';
import type { DetectionMethod, VerificationStatus } from '../core/model';

export const UNAVAILABLE = 'Indisponível';

export const STATUS_LABEL: Record<VerificationStatus, string> = {
  confirmed: 'Confirmada',
  unverified: 'Não verificada',
  suggested: 'Sugerida (temática)',
  candidate: 'Evidência candidata',
  validated: 'Validada pelo pesquisador',
  inconclusive: 'Inconclusiva',
  potential_contradiction: 'Contradição potencial',
  rejected: 'Rejeitada',
};

export const STATUS_HELP: Record<VerificationStatus, string> = {
  confirmed: 'A referência foi localizada nos documentos ou em metadados bibliográficos confiáveis.',
  unverified: 'Correspondência fraca ou parcial. Precisa da confirmação do pesquisador.',
  suggested: 'Proximidade temática/bibliométrica. NÃO indica que um trabalho cita o outro.',
  candidate: 'Passagem encontrada automaticamente; ainda não revisada.',
  validated: 'O pesquisador confirmou a relação.',
  inconclusive: 'Revisada, mas não foi possível determinar sustentação suficiente.',
  potential_contradiction: 'O conteúdo parece contrariar a afirmação; exige revisão humana.',
  rejected: 'Rejeitada pelo pesquisador (mantida para auditoria).',
};

export const METHOD_LABEL: Record<DetectionMethod, string> = {
  bibtex_declared: 'Declarada no .bib do documento principal',
  reference_list_entry: 'Entrada da lista de referências do documento principal',
  reference_list_doi: 'Bibliografia do PDF — DOI idêntico',
  reference_list_title: 'Bibliografia do PDF — título normalizado',
  reference_list_author_year: 'Bibliografia do PDF — apenas 1º autor e ano (fraco)',
  in_text_marker: 'Marcações de citação no texto',
  pdf_doi: 'DOI impresso no PDF',
  pdf_title: 'Título encontrado no PDF',
  pdf_info: 'Metadados internos do PDF',
  external_metadata: 'Metadados externos (OpenAlex)',
  bibliographic_coupling: 'Acoplamento bibliográfico (referências em comum)',
  keyword_rule: 'Regra de palavras-chave',
  semantic_similarity: 'Similaridade semântica',
  manual: 'Decisão manual',
};

const PALETTE = ['#2f7fa8', '#3d9a8b', '#7a8f3a', '#e9a23b', '#8e6bbf', '#5c946e', '#c9692c', '#4f6d7a', '#b5838d', '#6d597a'];

/** Category colors are presentation only. They never encode a bibliographic relation. */
export function categoryColor(category: string, rules: CategoryRule[]): string {
  if (category === UNCATEGORIZED) return '#8a94a6';
  if (category === 'Documento principal') return '#064e3b';
  const rule = rules.find((r) => r.name === category);
  // The old built-in "Segmentação de feridas" rule was red, which read as "this source does not exist".
  if (rule?.color) return rule.color.toLowerCase() === '#d9485f' ? '#c2569b' : rule.color;
  let h = 0;
  for (let i = 0; i < category.length; i++) h = (h * 31 + category.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
