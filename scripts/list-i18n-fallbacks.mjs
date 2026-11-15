import { en } from '../src/web/i18n/en.ts';
import { zhCN } from '../src/web/i18n/zh-CN.ts';
import { ja } from '../src/web/i18n/ja.ts';

const ALLOW = new Set([
  'Fontexto',
  'OpenAlex',
  'Semantic Scholar',
  'CORE',
  'Unpaywall',
  'arXiv',
  'DOI',
  'PDF',
  '.bib',
  'ISSN',
]);

function isAllowed(s) {
  if (!s || typeof s !== 'string') return true;
  let rest = s;
  for (const t of ALLOW) rest = rest.split(t).join('');
  rest = rest.replace(/[\s\d.,;:!?·—–\-+()%\/\[\]{}'"“”…\u2013\u2014]/g, '');
  return rest.length === 0;
}

function sampleFn(key, fn) {
  const arity = fn.length;
  const byKey = {
    pageTitle: () => fn('Test'),
    tabCitations: () => fn(3),
    createdOn: () => fn('2020-01-01'),
    dropRefs: () => fn('2', true),
    stepUploadRefs: () => fn(2),
    stepProgress: () => fn(1, 5),
    entriesRecognized: () => fn(8, 10),
    oaProgress: () => fn(1, 5, 2),
    foundEntries: () => fn(10, 8),
    oaSummary: () => fn(1, 2, 3, 4),
    pdfsLinked: () => fn(5, 10),
    pdfsWithoutRef: () => fn(2),
    removeFile: () => fn('x.pdf'),
    filesSelected: () => fn(2, 'a.pdf'),
    labeledByYouTitle: () => fn('Located'),
    curatedTitle: () => fn('src', 'auto'),
    passageCurated: () => fn(1, 12),
    passageScored: () => fn(1, 12, 85),
    passageContextCurated: () => fn(1, 3, 12, 'src'),
    passageContext: () => fn(1, 3, 12),
    undoAuto: () => fn('Located'),
    markerMatchesSeveral: () => fn('A, B'),
    similarity: () => fn(85),
    openInArticle: () => fn(12),
    citationsWithoutPdf: () => fn(3),
    refsCount: () => fn(2),
    withoutPdf: () => fn(2),
    pending: () => fn(2),
    marksInText: () => fn(2),
    searchFreePdfs: () => fn(5),
    extraNoPdf: () => fn(3),
    freePdfGot: () => fn('arXiv'),
    oaAdded: () => fn(2),
    oaOtherCopies: () => fn(2),
    lookupFailed: () => fn('err'),
    askAuthorSubject: () => fn('Title'),
    askAuthorBody: () => fn({ title: 'T', year: 2020 }),
    goToPage: () => fn(12),
    couldNotMarkPassage: () => fn('phrase'),
    citationsInTextSummary: () => fn(10, 5, 2, 3),
    keywordsTitle: () => fn('kw'),
    citesCount: () => fn(2, 3),
    citesHeading: () => fn(2),
    citedByHeading: () => fn(2),
    thematicRelations: () => fn(2),
    seeNCitations: () => fn(3),
    citedOnPages: () => fn(3),
    citationMarkOf: () => fn('Smith 2020', 'text'),
    matchingFields: () => fn('doi'),
    openInBibliography: () => fn(5),
    bibEntryContext: () => fn('A', 'B'),
    markerContext: () => fn('text'),
    sharedReferences: () => fn('A, B'),
    reviewLine: () => fn('when', 'act', 'from', 'to'),
    aggregatedRelations: () => fn(2),
    declaredReferences: () => fn(2),
    confirmRemoveExternal: () => fn('file.pdf'),
    confirmDeleteFile: () => fn('file.pdf'),
    ambiguousIdentities: () => fn(2),
    reasons: () => fn('r'),
    markAmbiguous: () => fn('(Smith, 2020)'),
    markUnmatched: () => fn('(Smith, 2020)'),
    ambiguousBetween: () => fn('A, B'),
    ambiguousAmong: () => fn('A, B'),
    filesHeading: () => fn(3),
    pagesShort: () => fn('10'),
    sendingFiles: () => fn(2),
    curatedActive: () => fn('src', 5),
    curatedApplied: () => fn(5, 10),
    localePdfNoTextNamed: () => fn('n.pdf', 'no_text'),
    localeTextUnavailable: () => fn('n.pdf', 'no_text'),
    localeMissingNumbersInPassage: () => fn('1, 2'),
    localeSimilarOnCitedPage: () => fn('p. 5'),
    localeCannotCheckCitedPage: () => fn('p. 5'),
    localeCitedPageMissing: () => fn('p. 5', '1', '10'),
    localeCitedPageNoMatch: () => fn('p. 5', '3', '45%'),
    localeBestBelowMin: () => fn('12%', '30%'),
    localeNumberAbsent: () => fn('393', false),
    localeQuoteFound: () => fn(12),
    localePassageLowSim: () => fn('45%', 12),
    localePassageSim: () => fn('45%', 12),
    localeNumbersElsewhere: () => fn('1'),
    localeLocalProcessorFailed: () => fn('x'),
    localeDownloadFailed: () => fn('https://x', '404'),
    localeUnknownMethod: () => fn('x'),
    localeInternalError: () => fn('x'),
    localeManualLinkUnknown: () => fn('n'),
    localeMatchesSeveral: () => fn('n'),
    localeNoRefList: () => fn('n'),
    localeCouldNotRead: () => fn('n', 'msg'),
    localeReviewStale: () => fn('id'),
    localeReviewIgnored: () => fn('act', 'id', 'msg'),
    citedByVisible: () => fn(2),
    collapsedPublications: () => fn(2),
    netFinding: () => fn(5, 10),
    netFoundSummary: () => fn(5, 10),
    netBusy: () => fn(5),
    netCitedBy: () => fn(5),
    netInText: () => fn(5),
    netLinks: () => fn(5),
    netStats: () => fn(10, 5, 3),
    hiddenNodes: () => fn(2),
    referenceOf: () => fn('file.pdf'),
    refsWithoutPdf: () => fn(2),
    oaLookupsBusy: () => fn(2),
    oaFoundVia: () => fn('arXiv'),
    pdfsSent: () => fn(2),
    unresolvedCitations: () => fn(2),
    refsOutsideNetwork: () => fn(2),
    warnings: () => fn(2),
  };
  if (byKey[key]) return byKey[key]();
  const defaults = ['a', 'b', 'c', 'd', 'e'];
  return fn(...defaults.slice(0, arity));
}

function collectEqual(msg, label) {
  const bad = [];
  for (const key of Object.keys(en)) {
    const ev = en[key];
    const lv = msg[key];
    if (typeof ev === 'function') {
      try {
        const es = sampleFn(key, ev);
        const ls = sampleFn(key, lv);
        if (es === ls && typeof es === 'string' && !isAllowed(es)) bad.push(`${key} (fn): ${es.slice(0, 60)}`);
      } catch {
        bad.push(`${key} (fn sample error)`);
      }
    } else if (ev && typeof ev === 'object' && !Array.isArray(ev)) {
      for (const sk of Object.keys(ev)) {
        const es = ev[sk];
        const ls = lv?.[sk];
        if (es === ls && typeof es === 'string' && !isAllowed(es)) bad.push(`${key}.${sk}: ${es.slice(0, 60)}`);
      }
    } else if (ev === lv && typeof ev === 'string' && !isAllowed(ev)) {
      bad.push(`${key}: ${ev.slice(0, 80)}`);
    }
  }
  console.log(`\n=== ${label}: ${bad.length} fallbacks ===\n`);
  console.log(bad.join('\n'));
  return bad.length;
}

collectEqual(zhCN, 'zh-CN');
collectEqual(ja, 'ja');