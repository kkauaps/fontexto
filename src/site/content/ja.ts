import type { SiteContent } from '../types';
import { en } from './en';

/** Japanese public site (SEO pages). Several sections still need native-speaker review. */
export const ja: SiteContent = {
  ...en,
  chrome: {
    ...en.chrome,
    skip: 'コンテンツへ',
    menuLabel: 'サイト',
    languageLabel: '言語',
    breadcrumbLabel: 'パンくず',
    openApp: 'Fontexto を開く',
    ctaTitle: '自分の文書で試す',
    ctaText: '無料・アカウント不要。PDF はブラウザ内に留まります。',
    footerNote: '各引用のラベルは読み取り補助であり証明ではありません。必ず原文で確認してください。',
    ogLocale: 'ja_JP',
    appDescription:
      'Fontexto は学術文書の引用を、参照文献 PDF 内の該当段落につなぎます。PDF をアップロードすると参考文献を読み取り、合法的な OA 版を探し、引用に対応する箇所を示します。',
    featureList: [
      ...en.chrome.featureList.slice(0, 4),
      'JIS／日本語引用形式と GB/T 7714 に対応',
      ...en.chrome.featureList.slice(4),
    ],
    ogImageAlt: 'Fontexto：引用を原文の該当箇所につなぐ',
  },
};