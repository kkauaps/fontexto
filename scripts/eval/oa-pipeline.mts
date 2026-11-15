/**
 * Headless OA pipeline eval: PDF → reference parse → /api/oa lookup + PDF (same queries as the browser).
 *
 *   PDF=C:\path\paper.pdf [BASE=http://127.0.0.1:8788] [OUT=report.json] npx tsx scripts/eval/oa-pipeline.mts
 *
 * Browser-faithful prod repro:
 *   BASE=https://fontexto.com MIMIC_PROD=1 CONCURRENCY=3 GAP_MS=1100
 *
 * Without BASE, calls handleOaRequest in-process (local server logic, live upstream).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CoreStore, MemoryDriver } from '../../src/core/coreStore.ts';
import type { PublicationNode } from '../../src/core/model.ts';
import { extractPdfText } from '../../src/server/pdfText.ts';
import { handleOaRequest, lookupOpenAccess, parseOaQuery, type OaResult } from '../../src/core/openAccess.ts';
import {
  arxivFromPub,
  makePacer,
  oaBatchLookup,
  oaEligible,
  OA_PROD_CONCURRENCY,
  OA_PROD_GAP_MS,
  OA_PROD_RETRY_WAITS,
  oaQueryFromPub,
  withRetry,
} from '../../src/core/oaClient.ts';

const env = process.env;
const pdfPath = env.PDF;
if (!pdfPath) throw new Error('PDF= path to main document is required');
const base = env.BASE?.replace(/\/$/, '');
const mimicProd = env.MIMIC_PROD === '1' || env.MIMIC_PROD === 'true';
const concurrency = Number(env.CONCURRENCY) || (mimicProd ? OA_PROD_CONCURRENCY : 5);
const gapMs = Number(env.GAP_MS) || (mimicProd ? OA_PROD_GAP_MS : 900);
const retryWaits = mimicProd ? [...OA_PROD_RETRY_WAITS] : [2000, 6000, 15_000];

const store = new CoreStore({ driver: new MemoryDriver(), extractText: async (d) => extractPdfText(d) });
const pid = (await store.createProject('oa-eval', 'oa-eval')).id;
await store.addFile(pid, { data: readFileSync(pdfPath), originalName: path.basename(pdfPath), role: 'main' });
await store.ensureExtracted(pid);
const extracted = await store.extractReferencesFromMain(pid);
const graph = await store.rebuild(pid);
const pubs = Object.values(graph.nodes).filter(
  (n): n is PublicationNode => n.kind === 'publication' && n.inMainBibliography,
);

const query = oaQueryFromPub;
const eligible = oaEligible;

type RefOutcome = {
  id: string;
  label: string;
  eligible: boolean;
  lookup?: OaResult;
  pdfOk?: boolean;
  pdfError?: string;
  edgeStatus?: number;
  final: string;
};

async function lookupOne(q: ReturnType<typeof query>, mode: 'lookup' | 'pdf'): Promise<{ result: OaResult; pdfOk: boolean; pdfError?: string; edgeStatus?: number }> {
  const params = new URLSearchParams();
  if (q.doi) params.set('doi', q.doi);
  if (q.title) params.set('title', q.title);
  if (q.year) params.set('year', String(q.year));
  if (q.author) params.set('author', q.author);
  if (q.arxiv) params.set('arxiv', q.arxiv);
  if (q.kind) params.set('kind', q.kind);
  if (base) {
    const url = `${base}/api/oa/${mode === 'pdf' ? 'pdf' : 'lookup'}?${params}`;
    const res = await fetch(url, { credentials: 'omit' });
    const edgeStatus = res.status;
    if (mode === 'pdf') {
      const type = res.headers.get('content-type') ?? '';
      if (res.ok && type.startsWith('application/pdf')) return { result: { status: 'oa', pdfUrls: [] }, pdfOk: true, edgeStatus };
      const body = (await res.json()) as { result?: OaResult; error?: string };
      return { result: body.result ?? { status: 'not_found', pdfUrls: [] }, pdfOk: false, pdfError: body.error ?? `${res.status}`, edgeStatus };
    }
    const result = (await res.json()) as OaResult;
    return { result, pdfOk: false, edgeStatus };
  }
  if (mode === 'pdf') {
    const res = await handleOaRequest(new URL(`https://eval.local/api/oa/pdf?${params}`), fetch, {
      env: { OPENALEX_API_KEY: process.env.OPENALEX_API_KEY, S2_API_KEY: process.env.S2_API_KEY, CORE_API_KEY: process.env.CORE_API_KEY },
      timeoutMs: 20_000,
    });
    if (res.ok && (res.headers.get('content-type') ?? '').startsWith('application/pdf')) {
      const r = await lookupOpenAccess(parseOaQuery(params)!, fetch, { timeoutMs: 20_000 });
      return { result: r, pdfOk: true };
    }
    const body = (await res.json()) as { result?: OaResult; error?: string };
    return { result: body.result ?? { status: 'not_found', pdfUrls: [] }, pdfOk: false, pdfError: body.error };
  }
  const result = await lookupOpenAccess(parseOaQuery(params)!, fetch, {
    env: { OPENALEX_API_KEY: process.env.OPENALEX_API_KEY, S2_API_KEY: process.env.S2_API_KEY, CORE_API_KEY: process.env.CORE_API_KEY },
    timeoutMs: 20_000,
  });
  return { result, pdfOk: false };
}

function classify(r: OaResult, pdfOk: boolean, eligible: boolean, clientError?: string): string {
  if (!eligible) return 'skipped_no_query';
  if (clientError) return `client_error: ${clientError}`;
  if (pdfOk) return 'found_pdf';
  if (r.pdfUrls.length) return 'found_record_pdf_blocked';
  if (r.status === 'oa') return 'found_record_no_oa_fetch';
  if (r.status === 'closed') return 'found_record_no_oa';
  if (r.status === 'not_found') {
    const deg = r.sources?.some((s) => s.status === 'rate_limited' || s.status === 'timeout' || s.status === 'error');
    return deg ? 'upstream_error' : 'not_found';
  }
  return 'unknown';
}

const queue = pubs.filter(eligible);
const outcomes: RefOutcome[] = [];

if (base) {
  try {
    await withRetry(() => oaBatchLookup(queue.map(query), base), retryWaits);
  } catch {
    /* batch optional */
  }
}

let i = 0;
const pace = makePacer(gapMs);
const worker = async () => {
  while (i < queue.length) {
    const pub = queue[i++];
    const q = query(pub);
    try {
      const { result, pdfOk, pdfError, edgeStatus } = await withRetry(async () => (await pace(), lookupOne(q, 'pdf')), retryWaits);
      outcomes.push({
        id: pub.id,
        label: pub.label,
        eligible: true,
        lookup: result,
        pdfOk,
        pdfError,
        edgeStatus,
        final: classify(result, pdfOk, true),
      });
    } catch (e) {
      const msg = (e as Error).message;
      outcomes.push({
        id: pub.id,
        label: pub.label,
        eligible: true,
        edgeStatus: /^(429|5\d\d)\b/.test(msg) ? Number(msg.slice(0, 3)) : undefined,
        final: classify({ status: 'not_found', pdfUrls: [] }, false, true, msg),
      });
    }
  }
};
await Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, () => worker()));

for (const p of pubs.filter((p) => !eligible(p))) {
  outcomes.push({ id: p.id, label: p.label, eligible: false, final: 'skipped_no_query' });
}

function upstreamBreakdown(os: RefOutcome[]) {
  const by: Record<string, number> = {};
  for (const o of os.filter((x) => x.final === 'upstream_error' || x.edgeStatus === 429)) {
    for (const s of o.lookup?.sources ?? []) {
      if (s.status === 'rate_limited' || s.status === 'timeout' || s.status === 'error') {
        const key = `${s.name}:${s.detail ?? s.status}`;
        by[key] = (by[key] ?? 0) + 1;
      }
    }
    if (o.edgeStatus === 429) by['edge:429'] = (by['edge:429'] ?? 0) + 1;
  }
  return by;
}

function isDefinitive(final: string): boolean {
  if (final.startsWith('client_error')) return true;
  return [
    'found_pdf',
    'found_record_no_oa',
    'found_record_pdf_blocked',
    'found_record_no_oa_fetch',
    'not_found',
    'upstream_error',
  ].includes(final);
}

const summary = {
  base: base ?? 'in-process',
  mimicProd,
  concurrency,
  gapMs,
  recognized: extracted.references.length,
  usable: extracted.usable,
  bibliography: pubs.length,
  eligible: queue.length,
  attempted: outcomes.filter((o) => o.eligible).length,
  definitive: outcomes.filter((o) => o.eligible && isDefinitive(o.final)).length,
  matched: outcomes.filter((o) => o.lookup && o.lookup.status !== 'not_found').length,
  pdfs: outcomes.filter((o) => o.pdfOk).length,
  edge429: outcomes.filter((o) => o.edgeStatus === 429).length,
  clientErrors: outcomes.filter((o) => o.final.startsWith('client_error')).length,
  byFinal: outcomes.reduce<Record<string, number>>((a, o) => ((a[o.final] = (a[o.final] ?? 0) + 1), a), {}),
  upstreamBreakdown: upstreamBreakdown(outcomes),
  pdfBlockedReasons: outcomes
    .filter((o) => o.final === 'found_record_pdf_blocked' || o.final === 'found_record_no_oa_fetch')
    .map((o) => ({ label: o.label, error: o.pdfError, sources: o.lookup?.sources })),
};

const report = { summary, outcomes };
console.log(JSON.stringify(summary, null, 2));
if (env.OUT) writeFileSync(env.OUT, JSON.stringify(report, null, 2));