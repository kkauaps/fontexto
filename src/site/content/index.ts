import type { SiteContent, SiteLang } from '../types';
import { en } from './en';
import { es } from './es';
import { ja } from './ja';
import { ptBR } from './pt-BR';
import { ru } from './ru';
import { zhCN } from './zh-CN';

export const siteContent: Record<SiteLang, SiteContent> = { en, es, ru, 'pt-BR': ptBR, 'zh-CN': zhCN, ja };