import { describe, expect, it } from 'vitest';
import { CoreStore, MemoryDriver, NotFoundError, ValidationError } from '../src/core/coreStore';
import type { PdfText } from '../src/core/text';
import { pdfText } from './helpers/fixtures';

// A "PDF" for the fake extractor: the %PDF- magic followed by the JSON text layer.
const fakePdf = (t: PdfText) => new TextEncoder().encode('%PDF-1.7\n' + JSON.stringify(t));
const extractText = async (data: Uint8Array): Promise<PdfText> => JSON.parse(new TextDecoder().decode(data).slice(9));

const mainText = pdfText([
  ['1 INTRODUÇÃO', 'A variabilidade entre clínicos na avaliação de feridas é considerável (QUINTANA et al., 2020).', 'Fonte: Autor (2026).'],
  ['REFERÊNCIAS', 'QUINTANA, A. et al. Gradient Lattices for Tissue Boundary Estimation. 2020.'],
]);
const refText = pdfText([
  ['Gradient Lattices for Tissue Boundary Estimation', 'Aurelio Quintana, Maja Brandt', 'Abstract', 'We study imaginary things in a short summary of the work.', '1 Introduction', 'Wound assessment has long shown considerable variability between clinicians in practice.'],
]);
const bib = '@article{quintana2020, author={Quintana, Aurelio and Brandt, Maja}, title={Gradient Lattices for Tissue Boundary Estimation}, year={2020}}';

async function setup() {
  const store = new CoreStore({ driver: new MemoryDriver(), extractText });
  const p = await store.createProject('Teste');
  await store.addFile(p.id, { data: fakePdf(mainText), originalName: 'artigo.pdf', role: 'main' });
  await store.addFile(p.id, { data: fakePdf(refText), originalName: 'quintana.pdf', role: 'reference' });
  return { store, id: p.id };
}

describe('CoreStore (browser edition storage, in memory)', () => {
  it('validates files and keeps one main document', async () => {
    const { store, id } = await setup();
    await expect(store.addFile(id, { data: new TextEncoder().encode('nope'), originalName: 'x.pdf' })).rejects.toThrow(ValidationError);
    await expect(store.addFile(id, { data: new TextEncoder().encode('x'), originalName: 'x.docx' })).rejects.toThrow(/accepted/);
    await expect(store.addFile(id, { data: fakePdf(mainText), originalName: 'outro.pdf', role: 'main' })).resolves.toBeTruthy(); // same hash: returns the existing record
    await expect(store.getProject('nope')).rejects.toThrow(NotFoundError);
  });

  it('with a .bib: extracts text, links the PDF, finds the passage and ignores "Autor (2026)"', async () => {
    const { store, id } = await setup();
    await store.addFile(id, { data: new TextEncoder().encode(bib), originalName: 'refs.bib' });
    await store.ensureExtracted(id);
    await store.rebuild(id);
    const g = await store.getGraph(id);
    expect(g.fileLinks.filter((l) => l.status === 'matched')).toHaveLength(1);
    const ev = await store.getEvidence(id);
    expect(ev.occurrences).toHaveLength(1);
    expect(ev.summary.unresolved).toBe(0);
    expect(ev.occurrences[0].passages[0]?.text).toMatch(/variability/);
    expect(ev.occurrences[0].passages[0]?.page).toBe(1);
    expect((await store.getFileBytes(id, g.files && Object.keys(g.files)[0])).data.length).toBeGreaterThan(10);
  });

  it('without a .bib: reads the reference list from the article and links the PDF', async () => {
    const { store, id } = await setup();
    const out = await store.extractReferencesFromMain(id);
    expect(out.references.map((r) => r.key)).toContain('quintana2020');
    const ev = await store.getEvidence(id);
    expect(ev.summary.resolved).toBe(1);
  });

  it('keeps the embeddings cached: a rebuild stays semantic without the model', async () => {
    const { store, id } = await setup();
    await store.extractReferencesFromMain(id);
    const todo = await store.semanticTodo(id);
    expect(todo.claims.length).toBeGreaterThan(0);
    expect(todo.passages.length).toBeGreaterThan(0);
    const unit = (i: number) => Float32Array.from({ length: 4 }, (_, k) => (k === i ? 1 : 0));
    const ev = await store.semanticStore(
      id,
      todo.claims.map((text) => ({ text, vec: unit(0) })),
      todo.passages.map((text) => ({ text, vec: unit(/variability/.test(text) ? 0 : 1) })),
    );
    expect(ev.method).toMatch(/modelo de linguagem multilíngue/);
    expect((await store.semanticStatus(id)).active).toBe(true);
    expect((await store.semanticTodo(id)).claims).toHaveLength(0);
    await store.rebuild(id);
    expect((await store.getEvidence(id)).method).toMatch(/multilíngue/);
    await store.clearSemantic(id);
    expect((await store.getEvidence(id)).method).not.toMatch(/multilíngue/);
  });

  it('deletes a project with everything inside', async () => {
    const { store, id } = await setup();
    await store.deleteProject(id);
    expect(await store.listProjects()).toEqual([]);
  });
});
