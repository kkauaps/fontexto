import type { SiteContent, SiteLang } from '../types';
import { en } from './en';
import { es } from './es';
import { ptBR } from './pt-BR';
import { ru } from './ru';

export const siteContent: Record<SiteLang, SiteContent> = { en, es, ru, 'pt-BR': ptBR };
