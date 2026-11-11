# Política de segurança

O Fontexto processa documentos acadêmicos dos usuários, então tratamos relatos de segurança com prioridade.

## Como relatar uma vulnerabilidade

Escreva para **security@fontexto.com** *(placeholder: edite este endereço antes de publicar; mantenha o mesmo valor em `src/web/public/.well-known/security.txt`)*.

- Descreva o problema, como reproduzir e o impacto que você enxerga.
- Não abra uma issue pública com detalhes antes da correção.
- Responderemos em até 5 dias úteis e avisamos quando houver correção. Agradecemos o crédito, se você quiser.
- Não acesse dados de outras pessoas, não faça testes de negação de serviço e não use engenharia social.

## Versões com suporte

Só a versão publicada em `main` recebe correções de segurança.

## O que o projeto faz para se proteger

- **Tudo local.** Na versão web, os PDFs e o `.bib` são lidos no próprio navegador e não são enviados a nenhum servidor. Não há análise de uso, anúncios nem scripts, fontes ou CDNs de terceiros.
- **CSP restrita** (`src/server/securityHeaders.ts`, gerada para `_headers` no build): sem `unsafe-inline` nem `unsafe-eval`, `connect-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, Trusted Types para scripts. Além disso: HSTS, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` negando câmera, microfone, geolocalização e afins, COOP/COEP/CORP.
- **Texto de PDF e de `.bib` nunca vira HTML.** O React escapa tudo; não há `innerHTML` nem `dangerouslySetInnerHTML` (um teste vigia isso).
- **pdf.js** em Web Worker, com `isEvalSupported: false`, versão corrigida para a CVE-2024-4367, fontes e decodificadores servidos pelo próprio site.
- **Cadeia de suprimentos:** `package-lock.json` versionado, `npm ci` no build, `npm audit` sem vulnerabilidades altas ou críticas, Dependabot, ações do GitHub fixadas por SHA com permissões mínimas e CodeQL.
