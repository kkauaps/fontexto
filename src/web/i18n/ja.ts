import { en, type Messages } from './en';

/** Japanese UI. Body strings follow English where not yet reviewed by a native speaker. */
export const ja: Messages = {
  ...en,
  metaTitle: 'Fontexto — 各引用を原文の該当箇所につなぐ',
  metaDescription:
    'Fontexto は論文内の各引用を、参照文献 PDF の該当段落と結びつけます。PDF をアップロードし、ブラウザ内で照合してください。ファイルは端末から出ません。',
  boot: 'Fontexto を読み込み中…',
  language: '言語',
  displaySettings: 'テーマと言語',
  appearance: '外観',
  themeGlass: 'グラス',
  themeDarkSolid: 'ダーク',
  themeLight: 'ライト',
  tagline: '各引用を参照文献の該当箇所にリンク',
  pageTitle: (section?: string) => (section ? `${section} · Fontexto` : 'Fontexto — 各引用を原文の該当箇所につなぐ'),
  privacyNote: '追加したファイルはこの端末でのみ読み取り・保存されます。',
  privacyNoteWeb: '追加したファイルはこのブラウザでのみ読み取り・保存されます。',
  navHowItWorks: '使い方',
  navPrivacy: 'プライバシー',
  navOpenProject: 'プロジェクトを開く',
  heroLead:
    '論文 PDF をアップロードすると、Fontexto が参考文献を読み取り、合法な OA 版を探し、各引用に対応する原文の箇所を示します。',
  ctaJustDoc: '本文のみ',
  ctaDocAndPdfs: '本文 + 参考文献 PDF',
  howItWorks: '使い方',
  openingPdf: 'PDF を開いています…',
  pdfViewer: 'PDF ビューア',
  back: '戻る',
  all: 'すべて',
  filterByStatus: '状態で絞り込み',
  filterByReference: '参考文献で絞り込み',
  searchInSentenceOrRef: '文または参考文献を検索…',
};