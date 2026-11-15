import type { SiteContent } from '../types';
import { en } from './en';

/** Simplified Chinese public site (SEO pages). Several sections still need native-speaker review. */
export const zhCN: SiteContent = {
  ...en,
  chrome: {
    ...en.chrome,
    skip: '跳到内容',
    menuLabel: '网站',
    languageLabel: '语言',
    breadcrumbLabel: '面包屑',
    openApp: '打开 Fontexto',
    ctaTitle: '用自己的文档试试',
    ctaText: '免费、无需账户，PDF 留在浏览器中。',
    footerNote: '每条引用的标签仅为阅读辅助，不构成证明。请始终在原文中核对。',
    ogLocale: 'zh_CN',
    appDescription:
      'Fontexto 将学术文档中的引用与参考文献 PDF 中的对应段落关联。上传 PDF：读取参考文献列表、查找合法的开放获取版本，并标出原文中最可能支持该引用的位置。',
    featureList: [
      ...en.chrome.featureList.slice(0, 4),
      '支持 GB/T 7714 等参考文献格式及中日韩文内文引用',
      ...en.chrome.featureList.slice(4),
    ],
    ogImageAlt: 'Fontexto：每条引用链接到原文段落',
  },
};