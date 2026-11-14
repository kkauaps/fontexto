import type { EvidenceStatus } from '../../core/evidence';
import type { GroupStatus } from '../../core/evidenceView';
import type { DetectionMethod, VerificationStatus } from '../../core/model';
import type { RefStatus } from '../../core/refStatus';
import { EVIDENCE_METHOD } from '../../core/evidence';
import { SEMANTIC_METHOD } from '../../core/semantic';
import type { Messages } from './en';

export function evidenceStatusText(t: Messages, status: GroupStatus | EvidenceStatus): string {
  switch (status) {
    case 'localizado':
      return t.statusLocated;
    case 'ressalva':
      return t.statusCaveat;
    case 'nao_localizado':
      return t.statusNotLocated;
    case 'sem_pdf':
      return t.statusNoPdf;
    default:
      return t.statusUnresolved;
  }
}

export function refStatusText(t: Messages, status: RefStatus): string {
  return {
    ok: t.refOk,
    ressalva: t.refCaveat,
    nao_localizado: t.refNotLocated,
    sem_pdf: t.refNoPdf,
    nao_citada: t.refNotCited,
  }[status];
}

export function reasonText(t: Messages, reason: string): string {
  const map: Record<string, string> = {
    sem_pdf: t.reasonNoPdf,
    sem_texto: t.reasonNoText,
    frase_curta: t.reasonShortSentence,
    sem_passagem: t.reasonNoPassage,
    baixa_similaridade: t.reasonLowSimilarity,
    numero_ausente: t.reasonMissingNumber,
    pagina_citada: t.reasonCitedPage,
    citacao_direta: t.reasonDirectQuote,
    so_resumo: t.reasonAbstractOnly,
    fonte_sem_trecho: t.reasonTableSource,
  };
  return map[reason] ?? reason;
}

export function verificationLabel(t: Messages, status: VerificationStatus): string {
  const map: Record<VerificationStatus, string> = {
    confirmed: t.stConfirmed,
    unverified: t.stUnverified,
    suggested: t.stSuggested,
    candidate: t.stCandidate,
    validated: t.stValidated,
    inconclusive: t.stInconclusive,
    potential_contradiction: t.stContradiction,
    rejected: t.stRejected,
  };
  return map[status];
}

export function verificationHelp(t: Messages, status: VerificationStatus): string {
  const map: Record<VerificationStatus, string> = {
    confirmed: t.helpConfirmed,
    unverified: t.helpUnverified,
    suggested: t.helpSuggested,
    candidate: t.helpCandidate,
    validated: t.helpValidated,
    inconclusive: t.helpInconclusive,
    potential_contradiction: t.helpContradiction,
    rejected: t.helpRejected,
  };
  return map[status];
}

export function methodLabel(t: Messages, method: DetectionMethod): string {
  const map: Record<DetectionMethod, string> = {
    bibtex_declared: t.methodBibtex,
    reference_list_entry: t.methodRefListEntry,
    reference_list_doi: t.methodRefListDoi,
    reference_list_title: t.methodRefListTitle,
    reference_list_author_year: t.methodRefListAuthorYear,
    in_text_marker: t.methodInText,
    pdf_doi: t.methodPdfDoi,
    pdf_title: t.methodPdfTitle,
    pdf_info: t.methodPdfInfo,
    external_metadata: t.methodExternal,
    bibliographic_coupling: t.methodCoupling,
    keyword_rule: t.methodKeyword,
    semantic_similarity: t.methodSemantic,
    manual: t.methodManual,
  };
  return map[method] ?? method;
}

export function identityReason(t: Messages, reason: string): string {
  const map: Record<string, string> = {
    doi: t.identityDoi,
    different_doi: t.identityDifferentDoi,
    same_title: t.identitySameTitle,
    possible_version_or_preprint: t.identityVersion,
    first_author: t.identityFirstAuthor,
    year: t.identityYear,
    title_unavailable: t.identityTitleUnavailable,
    insufficient_metadata: t.identityInsufficient,
    title: t.identityTitle,
  };
  return map[reason] ?? reason;
}

export function reviewActionLabel(t: Messages, action: string): string {
  if (action === 'confirm') return t.actionConfirm;
  if (action === 'reject') return t.actionReject;
  if (action === 'reset') return t.actionReset;
  return action;
}

/** Set by the free-PDF lookup when the catalogues answered with rate limits or timeouts (not a real "not found"). */
export const OA_CATALOGS_BUSY = 'Os catálogos de acesso aberto estão limitando as consultas agora; tente de novo em alguns minutos.';

function exactMap(t: Messages): Record<string, string> {
  return {
    [EVIDENCE_METHOD]: t.evidenceMethod,
    [SEMANTIC_METHOD]: t.semanticMethod,
    'Mais de uma referência da lista combina com esta citação; escolha a certa.':
      t.localeListAmbiguous,
    'Nenhuma referência da lista tem este autor e ano.': t.localeListNone,
    'Não encontrei a seção "Referências" no PDF do artigo.': t.localeNoRefSection,
    [OA_CATALOGS_BUSY]: t.oaCatalogsBusy,
    'O PDF desta referência não foi enviado. Envie-o em "PDFs das referências" para localizar o trecho.':
      t.localePdfNotSentNote,
    'O PDF da referência não tem texto extraível.': t.localePdfNoText,
    'A frase que cita tem pouco conteúdo pesquisável (por exemplo, só o nome do autor); não há como buscar a passagem.':
      t.localeShortClaim,
    'Nenhuma passagem do PDF tem sobreposição suficiente com a frase.': t.localeNoOverlap,
    'A melhor passagem cobre só parte dos termos da frase.': t.localePartialOverlap,
    'A passagem mais próxima está no resumo/início do artigo; confira o corpo do texto.': t.localeInAbstract,
    'O trecho entre aspas não aparece literalmente no PDF da fonte.': t.localeQuoteMissing,
    'Nenhum trecho do PDF tem termos em comum com a frase.': t.localeNoSharedTerms,
    'O PDF desta fonte não está disponível.': t.localePdfUnavailable,
    'A âncora não pertence a este arquivo.': t.localeAnchorMismatch,
    'Destaque exato indisponível: abrindo apenas a página.': t.localeExactHighlightUnavailable,
    'A busca de artigos gratuitos não está disponível nesta instalação.': t.oaUnavailable,
    'OffscreenCanvas indisponível para OCR': t.localeNoOffscreenOcr,
    'OffscreenCanvas indisponível': t.localeNoOffscreen,
    'IndexedDB indisponível': t.localeNoIdb,
    'Não foi possível ler o texto do PDF do artigo.': t.localeArticleNoText,
    'Erro desconhecido': t.localeUnknownError,
    'A consulta de metadados públicos não existe na versão web: nada sai do seu navegador.': t.localeNoEnrichWeb,
    'Modelo semântico não incluído nesta versão.': t.localeModelMissing,
    'Worker bloqueado: origem diferente': t.localeWorkerBlocked,
    'No files received': t.localeNoFiles,
    'Invalid file': t.localeInvalidFile,
    'Not a PDF': t.localeNotPdf,
    'Invalid identity decision': t.localeInvalidIdentity,
    'Invalid file link': t.localeInvalidFileLink,
    'Invalid edge review': t.localeInvalidEdgeReview,
    'Edge not found': t.localeEdgeNotFound,
    'Invalid category': t.localeInvalidCategory,
    'Invalid label': t.localeInvalidLabel,
    'Invalid category rules': t.localeInvalidRules,
    'No extractable text (scanned PDF? OCR is not available offline).': t.localeNoExtractableOffline,
    'No .bib provided: main-document references were taken from its PDF reference list (title/authors unavailable).':
      t.localeNoBibFromPdf,
  };
}

export function translateRuntime(t: Messages, text: string | undefined | null): string {
  if (!text) return '';
  const exact = exactMap(t)[text];
  if (exact) return exact;

  let m: RegExpMatchArray | null;

  m = text.match(/^O PDF "(.+)" não tem texto extraível \((.+)\)\.$/);
  if (m) return t.localePdfNoTextNamed(m[1], m[2]);

  m = text.match(/^Número\(s\) da frase ausente\(s\) da passagem: (.+)\.$/);
  if (m) return t.localeMissingNumbersInPassage(m[1]);

  m = text.match(/^Há um trecho parecido na página citada \((.+)\)\.$/);
  if (m) return t.localeSimilarOnCitedPage(m[1]);

  m = text.match(/^Não foi possível conferir a página citada \((.+)\): o PDF não traz a numeração impressa\.$/);
  if (m) return t.localeCannotCheckCitedPage(m[1]);

  m = text.match(/^A página citada \((.+)\) não existe no PDF da fonte \(numeração (.+)–(.+)\)\.$/);
  if (m) return t.localeCitedPageMissing(m[1], m[2], m[3]);

  m = text.match(
    /^Na página citada \((.+)\) não há trecho parecido; o mais parecido está na p\. (\d+) do PDF \(similaridade (.+)\)\.$/,
  );
  if (m) return t.localeCitedPageNoMatch(m[1], m[2], m[3]);

  m = text.match(/^Nenhum trecho parecido no PDF \(melhor similaridade (.+), mínimo (.+)\)\.$/);
  if (m) return t.localeBestBelowMin(m[1], m[2]);

  m = text.match(/^O número (.+) da frase não aparece em nenhum lugar do PDF da fonte\.$/);
  if (m) return t.localeNumberAbsent(m[1], false);

  m = text.match(/^Os números (.+) da frase não aparecem em nenhum lugar do PDF da fonte\.$/);
  if (m) return t.localeNumberAbsent(m[1], true);

  m = text.match(/^Citação direta encontrada literalmente na p\. (\d+)\.$/);
  if (m) return t.localeQuoteFound(Number(m[1]));

  m = text.match(/^Trecho com (.+) de similaridade na p\. (\d+) \(similaridade baixa: confira o trecho\)\.$/);
  if (m) return t.localePassageLowSim(m[1], Number(m[2]));

  m = text.match(/^Trecho com (.+) de similaridade na p\. (\d+)\.$/);
  if (m) return t.localePassageSim(m[1], Number(m[2]));

  m = text.match(/^Número\(s\) da frase que estão no PDF, mas não neste trecho: (.+)\.$/);
  if (m) return t.localeNumbersElsewhere(m[1]);

  m = text.match(/^Falha no processador local: (.+)$/);
  if (m) return t.localeLocalProcessorFailed(m[1]);

  m = text.match(/^Falha ao baixar (.+) \((\d+)\)$/);
  if (m) return t.localeDownloadFailed(m[1], m[2]);

  m = text.match(/^Método desconhecido: (.+)$/);
  if (m) return t.localeUnknownMethod(m[1]);

  m = text.match(/^Erro interno: (.+)$/);
  if (m) return t.localeInternalError(m[1]);

  m = text.match(/^Text unavailable for "(.+)" \((.+)\)\.$/);
  if (m) return t.localeTextUnavailable(m[1], m[2]);

  m = text.match(/^Manual link of "(.+)" points to an unknown publication; ignored\.$/);
  if (m) return t.localeManualLinkUnknown(m[1]);

  m = text.match(/^"(.+)" matches several bibliography entries; choose the right one\.$/);
  if (m) return t.localeMatchesSeveral(m[1]);

  m = text.match(/^No reference list detected in "(.+)"\.$/);
  if (m) return t.localeNoRefList(m[1]);

  m = text.match(/^Review for edge (.+) no longer applies \(edge not produced by this build\)\.$/);
  if (m) return t.localeReviewStale(m[1]);

  m = text.match(/^Review (.+) on (.+) ignored: (.+)$/);
  if (m) return t.localeReviewIgnored(m[1], m[2], m[3]);

  m = text.match(/^Could not read (.+): (.+)$/);
  if (m) return t.localeCouldNotRead(m[1], m[2]);

  return text;
}

