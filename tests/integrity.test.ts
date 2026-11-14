/** Page/anchor integrity and relations without confirmed evidence. */
import { describe, expect, it } from 'vitest';
import { checkAnchor, viewerTarget } from '../src/core/anchors';
import type { GraphEdge } from '../src/core/model';
import { buildView, DEFAULT_FILTERS } from '../src/core/view';
import { applyReview, assertAutomaticStatus, isEstablishedCitation, isValidatedEvidence, VerificationError } from '../src/core/verification';
import { articleText, bibFixture, build, fileRecord, pdfText } from './helpers/fixtures';

const file = { id: 'f_00000000000a', pageCount: 2 };
const text = pdfText([['Intro line'], ['Quintana A. Gradient lattices. 2020.']]);

describe('page and anchor integrity', () => {
  it('rejects pages outside the document', () => {
    expect(checkAnchor({ fileId: file.id, page: 3 }, file).problems).toContain('page_out_of_range');
    expect(checkAnchor({ fileId: file.id, page: 0 }, file).valid).toBe(false);
    expect(checkAnchor({ fileId: file.id, page: 1.5 }, file).valid).toBe(false);
    expect(viewerTarget({ fileId: file.id, page: 9 }, file)).toMatchObject({ ok: false, reason: 'invalid_page' });
  });

  it('highlights only when the text is on the page and rects fit the page', () => {
    const good = { fileId: file.id, page: 2, text: 'Gradient lattices', rects: [{ x: 56, y: 60, w: 200, h: 12 }], pageSize: { width: 595, height: 842 } };
    expect(viewerTarget(good, file, text)).toMatchObject({ ok: true, page: 2, exactHighlight: true });

    const wrongPage = { ...good, page: 1 };
    const t1 = viewerTarget(wrongPage, file, text);
    expect(t1).toMatchObject({ ok: true, page: 1, exactHighlight: false, highlights: [] });
    expect(t1.ok && t1.notice).toMatch(/Destaque exato indisponível/);

    const outside = { ...good, rects: [{ x: 500, y: 830, w: 300, h: 40 }] };
    expect(viewerTarget(outside, file, text)).toMatchObject({ ok: true, exactHighlight: false });
  });

  it('opens the page without highlight when there are no coordinates (never invents them)', () => {
    const t = viewerTarget({ fileId: file.id, page: 2 }, file, text);
    expect(t).toMatchObject({ ok: true, page: 2, exactHighlight: false, highlights: [] });
  });

  it('highlights from extracted line boxes when the anchor has the passage text but no rectangles', () => {
    const t = viewerTarget({ fileId: file.id, page: 2, text: 'Gradient lattices' }, file, text);
    expect(t).toMatchObject({ ok: true, page: 2, exactHighlight: true });
    expect(t.ok && t.highlights.length).toBeGreaterThan(0);
  });

  it('rejects anchors that point to another file', () => {
    expect(viewerTarget({ fileId: 'f_00000000000b', page: 1 }, file)).toMatchObject({ ok: false, reason: 'file_mismatch' });
  });

  it('pipeline anchors always reference existing pages of the source file', () => {
    const bib = bibFixture();
    const pdf = fileRecord('reference', 'q.pdf', { pageCount: 2 });
    const t = articleText({
      title: 'Gradient Lattices for Tissue Boundary Estimation',
      authorsLine: 'Aurelio Quintana',
      references: ['Albrecht, H. (2018). A benchmark of imaginary segmentation networks.'],
    });
    const g = build({ files: { [bib.file.id]: bib.file, [pdf.id]: pdf }, bib: [{ fileId: bib.file.id, entries: bib.entries }], texts: { [pdf.id]: t } });
    const anchors = Object.values(g.edges).flatMap((e) => e.provenance.flatMap((p) => [p.referenceAnchor, ...(p.citationAnchors ?? [])].filter(Boolean)));
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) expect(checkAnchor(a!, g.files[a!.fileId], t).valid).toBe(true);
  });
});

const edge = (kind: GraphEdge['kind'], status: GraphEdge['status']): GraphEdge => ({ id: `${kind}:a->b`, kind, source: 'a', target: 'b', status, provenance: [] });

describe('relations without confirmed evidence', () => {
  it('automatic methods can never produce validated evidence or confirm via similarity', () => {
    expect(() => assertAutomaticStatus('supports', 'semantic_similarity', 'validated')).toThrow(VerificationError);
    expect(() => assertAutomaticStatus('related_to', 'bibliographic_coupling', 'confirmed')).toThrow(VerificationError);
    expect(() => assertAutomaticStatus('cites', 'bibliographic_coupling', 'confirmed')).toThrow(VerificationError);
    expect(() => assertAutomaticStatus('supports', 'semantic_similarity', 'candidate')).not.toThrow();
    expect(() => assertAutomaticStatus('supports', 'manual', 'validated')).not.toThrow();
  });

  it('candidate evidence only becomes validated through an explicit human review', () => {
    const e = edge('supports', 'candidate');
    expect(isValidatedEvidence(e)).toBe(false);
    const v = applyReview(e, 'confirm', '2026-01-01T00:00:00Z');
    expect(v.status).toBe('validated');
    expect(isValidatedEvidence(v)).toBe(true);
    expect(applyReview(e, 'flag_contradiction', 'now').status).toBe('potential_contradiction');
    expect(applyReview(e, 'mark_inconclusive', 'now').status).toBe('inconclusive');
    expect(isValidatedEvidence({ ...e, status: 'validated' })).toBe(false); // no review record
  });

  it('a thematic relation never becomes a citation', () => {
    const r = applyReview(edge('related_to', 'suggested'), 'confirm', 'now');
    expect(r.kind).toBe('related_to');
    expect(isEstablishedCitation(r)).toBe(false);
  });

  it('invalid transitions are refused; reset restores the original status', () => {
    expect(() => applyReview(edge('cites', 'confirmed'), 'flag_contradiction', 'now')).toThrow(VerificationError);
    const rej = applyReview(edge('cites', 'unverified'), 'reject', 'now');
    expect(applyReview(rej, 'reset', 'now').status).toBe('unverified');
  });

  it('weak matches stay unverified until reviewed, and reviews survive rebuilds', () => {
    const bib = bibFixture(String.raw`
      @article{src, author={Quintana, Aurelio}, title={Gradient Lattices for Tissue Boundary Estimation}, year={2020}}
      @article{tgt, author={Okafor, Chidi}, year={2016}}`);
    const pdf = fileRecord('reference', 'q.pdf');
    const t = articleText({
      title: 'Gradient Lattices for Tissue Boundary Estimation',
      authorsLine: 'Aurelio Quintana',
      references: ['Okafor, C. (2016). Some work whose title the bibliography does not know. Synthetic Press.'],
    });
    const input = { files: { [bib.file.id]: bib.file, [pdf.id]: pdf }, bib: [{ fileId: bib.file.id, entries: bib.entries }], texts: { [pdf.id]: t } };
    const g1 = build(input);
    const id = 'cites:pub:bib:src->pub:bib:tgt';
    expect(g1.edges[id].status).toBe('unverified');
    expect(g1.edges[id].provenance[0].method).toBe('reference_list_author_year');
    const g2 = build(input, { edgeReviews: { [id]: [{ action: 'confirm', at: 'now' }] } });
    expect(g2.edges[id].status).toBe('confirmed');
    expect(g2.edges[id].reviews?.[0]).toMatchObject({ from: 'unverified', to: 'confirmed' });
  });

  it('bibliographic coupling only yields hidden-by-default suggestions', () => {
    const bib = bibFixture(String.raw`
      @article{a, author={Ames, A.}, title={Alpha synthetic article on lattices}, year={2020}}
      @article{b, author={Bose, B.}, title={Beta synthetic article on lattices}, year={2021}}
      @article{x, author={Xu, X.}, title={Shared reference number one}, year={2010}}
      @article{y, author={Yilmaz, Y.}, title={Shared reference number two}, year={2011}}`);
    const refs = ['Xu, X. (2010). Shared reference number one. Press.', 'Yilmaz, Y. (2011). Shared reference number two. Press.'];
    const fa = fileRecord('reference', 'a.pdf');
    const fb = fileRecord('reference', 'b.pdf');
    const g = build({
      files: { [bib.file.id]: bib.file, [fa.id]: fa, [fb.id]: fb },
      bib: [{ fileId: bib.file.id, entries: bib.entries }],
      texts: {
        [fa.id]: articleText({ title: 'Alpha synthetic article on lattices', authorsLine: 'A. Ames', references: refs }),
        [fb.id]: articleText({ title: 'Beta synthetic article on lattices', authorsLine: 'B. Bose', references: refs }),
      },
    });
    const rel = Object.values(g.edges).filter((e) => e.kind === 'related_to');
    expect(rel).toHaveLength(1);
    expect(rel[0].status).toBe('suggested');
    expect(g.edges['cites:pub:bib:a->pub:bib:b']).toBeUndefined();
    expect(buildView(g, DEFAULT_FILTERS).edges.some((e) => e.kind === 'related_to')).toBe(false);
  });
});
