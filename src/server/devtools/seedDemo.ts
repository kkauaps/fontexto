/**
 * Creates a fully synthetic demo project ("demo") so the UI can be explored
 * without any real or copyrighted documents. All titles, authors and DOIs are
 * invented (DOI prefix 10.99999 is fictitious).
 *
 *   npm run demo:seed [-- --data-dir ./data]
 */
import { ProjectStore } from '../store.js';
import { flowText, makePdf } from './syntheticPdf.js';

interface Work {
  key: string;
  authors: string[];
  title: string;
  year: number;
  doi?: string;
  venue: string;
  cites: string[];
  /** Whether a (synthetic) PDF is provided. */
  pdf: boolean;
}

const WORKS: Work[] = [
  { key: 'quintana2020', authors: ['Quintana, Aurelio', 'Brandt, Maja', 'Oyelaran, Tunde'], title: 'Gradient Lattices for Tissue Boundary Estimation', year: 2020, doi: '10.99999/demo.2020.001', venue: 'Journal of Synthetic Studies', cites: ['albrecht2018', 'nakamura2019'], pdf: true },
  { key: 'albrecht2018', authors: ['Albrecht, Henrike', 'Moreau, Lucien'], title: 'A Benchmark of Imaginary Segmentation Networks', year: 2018, doi: '10.99999/demo.2018.042', venue: 'Synthetic Vision Letters', cites: ['okafor2015'], pdf: true },
  { key: 'nakamura2019', authors: ['Nakamura, Rei', 'Sánchez, Eloísa'], title: 'Self-Calibrating Annotation Protocols for Fictional Wounds', year: 2019, venue: 'Proceedings of the Imaginary Conference', cites: ['okafor2015', 'albrecht2018'], pdf: true },
  { key: 'okafor2015', authors: ['Okafor, Chidi'], title: 'Convolutional Lattice Networks', year: 2015, doi: '10.99999/demo.2015.007', venue: 'Synthetic Neural Computing', cites: [], pdf: true },
  { key: 'lindqvist2022', authors: ['Lindqvist, Petra', 'Haddad, Omar', 'Ferreira, Lia'], title: 'Agreement Metrics for Invented Tissue Classes', year: 2022, doi: '10.99999/demo.2022.110', venue: 'Journal of Synthetic Studies', cites: ['quintana2020', 'nakamura2019', 'albrecht2018'], pdf: true },
  { key: 'consortium2021', authors: ['{Synthetic Standards Consortium}'], title: 'Guidelines for Invented Measurements', year: 2021, venue: 'Imaginary Press', cites: [], pdf: false },
];

const bibAuthor = (a: string) => a;
const refLine = (w: Work, i: number) => {
  const names = w.authors.map((a) => a.replace(/[{}]/g, '')).join(', ');
  return `[${i + 1}] ${names}. ${w.title}. ${w.venue}. ${w.year}.${w.doi ? ` doi:${w.doi}` : ''}`;
};

async function main() {
  const argv = process.argv.slice(2);
  const dataDir = argv[argv.indexOf('--data-dir') + 1] && argv.includes('--data-dir') ? argv[argv.indexOf('--data-dir') + 1] : (process.env.CITATION_GRAPH_DATA_DIR ?? 'data');
  const store = new ProjectStore(dataDir);
  try {
    await store.getProject('demo');
    console.log('Project "demo" already exists; delete it first (UI or remove data/projects/demo).');
    return;
  } catch {
    /* create */
  }
  await store.createProject('Demo sintética', 'demo');

  const bib = WORKS.map(
    (w) =>
      `@article{${w.key},\n  author = {${w.authors.map(bibAuthor).join(' and ')}},\n  title = {{${w.title}}},\n  journal = {${w.venue}},\n  year = {${w.year}}${w.doi ? `,\n  doi = {${w.doi}}` : ''}\n}`,
  ).join('\n\n');
  await store.addFile('demo', { data: Buffer.from(`% Synthetic demo bibliography (invented).\n${bib}\n`), originalName: 'demo.bib' });

  const main = makePdf(
    flowText([
      { text: 'Synthetic Thesis on Invented Wound Imaging', size: 16 },
      { text: 'Demo Student', gapBefore: 4 },
      { text: 'Introduction', size: 12, gapBefore: 14 },
      { text: 'Tissue boundaries were modelled with gradient lattices (Quintana et al., 2020), building on convolutional lattice networks (Okafor, 2015).', gapBefore: 4 },
      { text: 'Annotation followed Nakamura e Sánchez (2019) and agreement was measured as in Lindqvist et al. (2022).', gapBefore: 4 },
      { text: 'Benchmarks (Albrecht; Moreau, 2018) and guidelines (SYNTHETIC STANDARDS CONSORTIUM, 2021) were also considered.', gapBefore: 4 },
      { text: 'An unknown work (Nobody et al., 2023) is cited here to show an unresolved marker.', gapBefore: 4 },
    ]),
    { title: 'Synthetic Thesis on Invented Wound Imaging' },
  );
  await store.addFile('demo', { data: main, originalName: 'synthetic-thesis.pdf', role: 'main' });

  for (const w of WORKS.filter((x) => x.pdf)) {
    const refs = w.cites.map((k) => WORKS.find((x) => x.key === k)!);
    refs.push({ key: 'outside', authors: ['Outsider, Zed'], title: 'A Reference Outside the Project', year: 2010, venue: 'Elsewhere', cites: [], pdf: false });
    const pdf = makePdf(
      flowText([
        { text: w.title, size: 15 },
        { text: w.authors.map((a) => a.replace(/[{}]/g, '').split(', ').reverse().join(' ')).join(', '), gapBefore: 4 },
        ...(w.doi ? [{ text: `https://doi.org/${w.doi}` }] : []),
        { text: 'Abstract', size: 12, gapBefore: 12 },
        { text: 'This is a synthetic document generated for demonstration. It has no scientific content. '.repeat(6), gapBefore: 4 },
        { text: 'References', size: 12, gapBefore: 16 },
        ...refs.map((r, i) => ({ text: refLine(r, i), gapBefore: 3 })),
      ]),
      { title: w.title },
    );
    await store.addFile('demo', { data: pdf, originalName: `${w.key}.pdf` });
  }
  await store.ensureExtracted('demo');
  const g = await store.rebuild('demo');
  console.log(`Demo project created in ${dataDir}: ${Object.keys(g.nodes).length} nodes, ${Object.keys(g.edges).length} edges.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
