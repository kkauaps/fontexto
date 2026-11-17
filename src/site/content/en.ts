import type { SiteContent } from '../types';

export const en: SiteContent = {
  chrome: {
    skip: 'Skip to content',
    menuLabel: 'Site',
    languageLabel: 'Language',
    breadcrumbLabel: 'Breadcrumb',
    openApp: 'Open Fontexto',
    ctaTitle: 'Try it with your own document',
    ctaText: 'Free, no account, and your PDFs stay in your browser.',
    footerNote: 'The label on each citation is a reading aid, not proof. Always check the passage in the source.',
    license: 'Free software under the GNU AGPL-3.0-or-later.',
    updated: 'Last updated',
    ogLocale: 'en_US',
    appDescription:
      'Fontexto links each citation in an academic document to the exact passage in the cited source. Upload a PDF: it reads the reference list, looks up legal open-access versions of the cited works, and shows the page where each source says what the text claims, ready for review.',
    featureList: [
      'Links in-text citations (author–year and numbered) to their references',
      'Finds candidate passages in each reference PDF and labels them Located, Caveat or Not located',
      'Extracts reference lists in ABNT, APA, Harvard, IEEE, Vancouver, GOST, DIN and GB/T 7714 styles',
      'Looks up legal open-access PDFs in OpenAlex, Crossref, Unpaywall, Europe PMC, arXiv, Semantic Scholar and CORE',
      'Reference network built from OpenAlex citation data',
      'PDFs are processed in the browser and never uploaded',
    ],
    ogImageAlt: 'Fontexto: each citation linked to the exact passage in the source',
  },
  pages: {
    'how-it-works': {
      nav: 'How it works',
      title: 'How Fontexto links citations to the source passage',
      description:
        'From your PDF to a checked citation: how Fontexto reads references, finds legal free PDFs and locates the passage each citation refers to.',
      h1: 'How Fontexto works',
      lead: 'You upload one document. Fontexto reads its reference list, finds free legal copies of the cited works and, for every citation, points you to the passage in the source that most likely supports it. You make the final call.',
      sections: [
        {
          h2: '1. Upload your document',
          p: [
            'A thesis, dissertation, article or report in PDF is enough. If the PDF already contains text, Fontexto reads it directly; scanned pages can be read with OCR in the browser (English and Portuguese).',
            'You can also add the PDFs of your references or a .bib file. They are optional: without them, Fontexto builds the reference list from the document itself.',
          ],
        },
        {
          h2: '2. References and citations are extracted',
          p: [
            'Fontexto finds the reference list, even when it has no “References” heading, and splits it into entries. It understands the common styles used in theses and journals: ABNT, APA, Harvard, IEEE, Vancouver, GOST, DIN, French author–year and GB/T 7714, including references written in Cyrillic or Chinese, theses and unusual DOIs.',
            'Then it finds every in-text citation, author–year like (Silva, 2021) or numbered like [12], and links it to the right entry.',
          ],
        },
        {
          h2: '3. Free, legal PDFs are looked up',
          p: [
            'For references without a PDF, Fontexto asks open scholarly catalogues whether a free, legal copy exists: the publisher’s open-access version, an institutional or subject repository, or a preprint server. Only the DOI, title, year and first author of each reference are sent. See [open-access sources](open-access-sources) for the full list.',
          ],
        },
        {
          h2: '4. Each citing sentence is matched against the source',
          p: [
            'The sentence that contains the citation is compared with every sentence of the cited PDF (its bibliography excluded). Rare, specific terms weigh more than common words; numbers, acronyms and a Portuguese–English glossary help across languages. An optional multilingual semantic model re-ranks the best candidates; it is downloaded once (about 135 MB) and runs in your browser.',
          ],
        },
        {
          h2: '5. You get a label, never a verdict',
          ul: [
            '**Located**: a passage shares most of the sentence’s rare terms.',
            '**Caveat**: the overlap is weaker, a number from the sentence is missing in the passage, or only the abstract matches.',
            '**Not located**: no similar passage, no PDF, no extractable text, or a sentence with too little content to compare.',
          ],
          p: [
            'Labels are candidates for human review. Fontexto never marks a citation as proven: you open the source on the passage’s page, compare the other candidates and decide.',
          ],
        },
        {
          h2: '6. See the whole bibliography',
          p: [
            'The References table shows the status of every entry, how often it is cited in your text and whether a PDF was found. The reference network asks OpenAlex which of your references cite each other or share references, colours them by topic, and exports a PNG or SVG. These links come from OpenAlex and are labelled as such.',
          ],
        },
      ],
    },
    faq: {
      nav: 'FAQ',
      title: 'Frequently asked questions about Fontexto',
      description:
        'Is Fontexto free? Are my PDFs uploaded? Which citation styles work? Answers about privacy, open-access PDFs, labels and languages.',
      h1: 'Frequently asked questions',
      lead: 'Short answers about what Fontexto does with your files, what the labels mean and where the free PDFs come from.',
      sections: [],
      faq: [
        {
          q: 'Is Fontexto free?',
          a: 'Yes. Fontexto is free to use, needs no account and shows no ads. It is free software licensed under the GNU AGPL-3.0-or-later.',
        },
        {
          q: 'Are my PDFs uploaded to a server?',
          a: 'No. In the web edition your document and reference PDFs are read inside your browser and stored in its local database (IndexedDB). They never leave your device. See the [privacy page](privacy) for details.',
        },
        {
          q: 'What does leave my browser?',
          a: 'Only when you look up free PDFs or reference links: the DOI, title, year and first author of each reference go to Fontexto’s lookup service, which asks open scholarly catalogues and returns the result. Your document text is never sent.',
        },
        {
          q: 'Does “Located” mean the citation is correct?',
          a: 'No. “Located” means a passage in the source shares most of the citing sentence’s specific terms. It is a strong hint, not proof. Always read the passage and decide for yourself.',
        },
        {
          q: 'Which citation and reference styles are supported?',
          a: 'In-text citations in author–year and numbered formats. Reference lists in ABNT, APA, Harvard, IEEE, Vancouver, GOST, DIN, French author–year and GB/T 7714, including entries in Cyrillic and Chinese and lists without a “References” heading.',
        },
        {
          q: 'Can Fontexto get papers behind a paywall?',
          a: 'No. It only uses legal open-access copies: publisher open access, institutional and subject repositories, and preprint servers. Shadow libraries are deliberately not supported. If you have access to a paper, you can add its PDF yourself. See [open-access sources](open-access-sources).',
        },
        {
          q: 'Which languages does it work with?',
          a: 'The interface is available in English, Spanish, Russian and Brazilian Portuguese. Documents can be in any language; matching works best when the document and the source share a language, and the optional multilingual model helps across languages.',
        },
        {
          q: 'Do I need to create an account?',
          a: 'No. Open fontexto.com and upload a PDF. Projects are saved in your browser; clearing the site data deletes them.',
        },
        {
          q: 'Does it work with scanned PDFs?',
          a: 'Yes, with OCR in the browser for English and Portuguese text. Results are better with PDFs that already contain selectable text.',
        },
        {
          q: 'How do I report a security problem?',
          a: 'Email contact@xoryn.com.br. Our security.txt is published at /.well-known/security.txt.',
        },
      ],
    },
    about: {
      nav: 'About',
      title: 'About Fontexto, the citation-to-source checker',
      description:
        'Fontexto helps students, researchers and reviewers check that each citation says what the source says. Free, private by design, AGPL software.',
      h1: 'About Fontexto',
      lead: 'Fontexto exists to make one tedious part of academic work faster: checking that each citation points to a passage in the source that actually supports it.',
      sections: [
        {
          h2: 'Who it is for',
          ul: [
            'Students writing a thesis or dissertation who want to review their citations before submission.',
            'Supervisors and examiners who need to check sources quickly.',
            'Researchers, reviewers and editors reading a manuscript with a long bibliography.',
          ],
        },
        {
          h2: 'Principles',
          ul: [
            '**Nothing is invented.** No bibliographic data, page or passage is made up; unknown values are shown as unavailable.',
            '**Labels are not proof.** Automatic matching only suggests passages. A person always decides.',
            '**Private by design.** Your PDFs stay in your browser. There are no trackers or third-party scripts. An anonymous total of landing-page visits may be shown once it passes 1,000 in 30 days.',
            '**Legal sources only.** Free PDFs come from open-access publishers, repositories and preprint servers.',
          ],
        },
        {
          h2: 'Free software',
          p: [
            'Fontexto is free software under the GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later). Anyone who runs a modified version as a network service must offer its source code to its users.',
          ],
        },
        {
          h2: 'Who made it',
          p: [
            'Fontexto was created and is developed by **Pablo Kauã Pereira Silva** (@kkauaps), an Information Systems student. As a student himself, he knows the pain of checking a thesis citation by citation, opening PDF after PDF to find the right passage, and built Fontexto to make that review faster and more reliable.',
            '[X/Twitter @kkauaps](https://x.com/kkauaps) · [Threads @kkauaps](https://www.threads.com/@kkauaps) · [GitHub @kkauaps](https://github.com/kkauaps)',
          ],
        },
        {
          h2: 'Contact',
          p: ['Questions about open-access copies: oa@fontexto.com. Security reports: contact@xoryn.com.br.'],
        },
      ],
      credit: 'Created by Pablo Kauã Pereira Silva ([@kkauaps](https://github.com/kkauaps))',
    },
    privacy: {
      nav: 'Privacy',
      title: 'Privacy: your PDFs stay in your browser',
      description:
        'What Fontexto stores, what it sends and to whom. Your PDFs never leave the browser; no cookies, third-party analytics or ads.',
      h1: 'Privacy',
      lead: 'Fontexto is built so that your documents never leave your device. This page explains exactly what is stored, what is sent and to whom.',
      sections: [
        {
          h2: 'What stays on your device',
          ul: [
            'Your document, the reference PDFs and any .bib file you add are read in your browser and stored in its local database (IndexedDB).',
            'Projects, review decisions and settings are stored the same way. Your language and theme are kept in local storage.',
            'Clearing this site’s data in your browser deletes all of it. We have no copy.',
          ],
        },
        {
          h2: 'What is sent, and when',
          p: [
            'Only when you look up free PDFs or links between references, Fontexto sends the DOI, title, year and first author of each reference to its lookup service at fontexto.com/api/oa. The service queries open scholarly catalogues (listed on [open-access sources](open-access-sources)) and returns the result or streams the PDF back to you.',
            'Lookup results are cached for up to 7 days to reduce load on the catalogues. The cache is keyed by the reference data only and is not linked to you. The service keeps no logs of its own and never stores PDFs.',
          ],
        },
        {
          h2: 'Anonymous visit count',
          p: [
            'The landing page keeps a single running total of how many times it was opened in the last 30 days. Only daily totals are stored: no cookies, no IP addresses, no device identifiers and no personal data. A tab may remember, in session storage, that it has already been counted, so a reload in the same tab is not counted twice. That flag is not an identifier and disappears when the tab is closed.',
            'The total is shown on the landing page only after it passes 1,000 visits in 30 days, as a rounded figure such as “1.2k people used Fontexto in the last 30 days”.',
          ],
        },
        {
          h2: 'What we do not do',
          ul: [
            'No accounts, no cookies, no third-party analytics, no advertising, no tracking pixels.',
            'No third-party scripts, fonts or embeds: everything the page loads comes from fontexto.com.',
            'No sale or sharing of personal data, because we do not collect it. The visit total is an anonymous number only.',
          ],
        },
        {
          h2: 'Hosting',
          p: [
            'fontexto.com is served by Cloudflare. Like any web host, Cloudflare processes connection data such as IP addresses to deliver the site and protect it from abuse, under its own privacy policy.',
          ],
        },
        {
          h2: 'Contact',
          p: ['Questions about this page: contact@xoryn.com.br.'],
        },
      ],
    },
    'open-access-sources': {
      nav: 'Open-access sources',
      title: 'Where Fontexto finds free, legal PDFs',
      description:
        'The open scholarly catalogues Fontexto queries for free, legal copies of cited works, and the rules it follows. No shadow libraries.',
      h1: 'Open-access sources',
      lead: 'When a reference has no PDF, Fontexto looks for a free copy that is legal to read: the publisher’s open-access version, an author manuscript in a repository, or a preprint. It never uses shadow libraries.',
      sections: [
        {
          h2: 'Catalogues we query',
          ul: [
            '**OpenAlex**: an open index of scholarly works, used to identify the work and its open-access locations. It also provides the citation links shown in the reference network.',
            '**Crossref**: DOI metadata from publishers, used when the reference has no DOI or OpenAlex does not know it.',
            '**Unpaywall**: open-access locations for works with a DOI.',
            '**Europe PMC**: full texts in life sciences and biomedicine.',
            '**arXiv**: preprints in physics, mathematics, computer science and related fields.',
            '**Semantic Scholar**: open-access PDF links from its academic graph.',
            '**CORE**: papers aggregated from institutional and subject repositories.',
          ],
        },
        {
          h2: 'Which copy is preferred',
          p: [
            'Copies hosted by the publisher come first, then repositories, then preprint servers. Among versions, the published version is preferred over the accepted manuscript, and the accepted manuscript over a preprint. Fontexto shows the version and, when known, the license, so you know what you are reading.',
          ],
        },
        {
          h2: 'Rules we follow',
          ul: [
            'Only URLs returned by these catalogues are fetched; the service is not an open proxy.',
            'Every file is checked to be a PDF and capped in size. PDFs are streamed to you and never stored.',
            'Only the DOI, title, year and first author of a reference are sent; never your document.',
            'If you have legitimate access to a paper that is not open access, add its PDF yourself.',
          ],
        },
        {
          h2: 'Publishers and authors',
          p: [
            'If you believe a copy listed by Fontexto should not be offered, write to oa@fontexto.com with the DOI or URL. Fontexto does not host the files; it links to copies listed by the catalogues above.',
          ],
        },
      ],
    },
  },
};
