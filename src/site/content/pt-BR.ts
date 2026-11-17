import type { SiteContent } from '../types';

export const ptBR: SiteContent = {
  chrome: {
    skip: 'Pular para o conteúdo',
    menuLabel: 'Site',
    languageLabel: 'Idioma',
    breadcrumbLabel: 'Trilha de navegação',
    openApp: 'Abrir o Fontexto',
    ctaTitle: 'Experimente com o seu documento',
    ctaText: 'Grátis, sem cadastro, e os seus PDFs ficam no seu navegador.',
    footerNote: 'O rótulo de cada citação é um apoio à leitura, não uma prova. Confira sempre o trecho na fonte.',
    license: 'Software livre sob a GNU AGPL-3.0-or-later.',
    updated: 'Atualizado em',
    ogLocale: 'pt_BR',
    appDescription:
      'O Fontexto liga cada citação de um documento acadêmico ao trecho exato da fonte citada. Envie um PDF: ele lê a lista de referências, procura versões legais em acesso aberto das obras citadas e mostra a página em que cada fonte diz o que o texto afirma, pronta para você conferir.',
    featureList: [
      'Liga as citações no texto (autor–data e numéricas) às suas referências',
      'Encontra trechos candidatos no PDF de cada referência e os rotula como Localizado, Ressalva ou Não localizado',
      'Extrai listas de referências nos estilos ABNT, APA, Harvard, IEEE, Vancouver, GOST, DIN e GB/T 7714',
      'Procura PDFs legais em acesso aberto no OpenAlex, Crossref, Unpaywall, Europe PMC, arXiv, Semantic Scholar e CORE',
      'Rede de referências montada com dados de citação do OpenAlex',
      'Os PDFs são processados no navegador e nunca enviados',
    ],
    ogImageAlt: 'Fontexto: cada citação ligada ao trecho exato da fonte',
  },
  pages: {
    'how-it-works': {
      nav: 'Como funciona',
      title: 'Como o Fontexto liga cada citação ao trecho da fonte',
      description:
        'Do seu PDF a uma citação conferida: como o Fontexto lê as referências, encontra PDFs gratuitos e legais e localiza o trecho a que cada citação se refere.',
      h1: 'Como o Fontexto funciona',
      lead: 'Você envia um documento. O Fontexto lê a lista de referências, encontra cópias gratuitas e legais das obras citadas e, para cada citação, aponta o trecho da fonte que mais provavelmente a sustenta. A decisão final é sua.',
      sections: [
        {
          h2: '1. Envie o seu documento',
          p: [
            'Basta uma tese, dissertação, artigo ou relatório em PDF. Se o PDF já tiver texto, o Fontexto lê direto; páginas digitalizadas podem ser lidas com OCR no navegador (inglês e português).',
            'Você também pode adicionar os PDFs das referências ou um arquivo .bib. São opcionais: sem eles, o Fontexto monta a lista de referências a partir do próprio documento.',
          ],
        },
        {
          h2: '2. Referências e citações são extraídas',
          p: [
            'O Fontexto encontra a lista de referências, mesmo sem o título “Referências”, e a divide em entradas. Ele entende os estilos comuns em teses e periódicos: ABNT, APA, Harvard, IEEE, Vancouver, GOST, DIN, autor–data francês e GB/T 7714, inclusive referências em cirílico ou chinês, teses e DOIs incomuns.',
            'Depois encontra cada citação no texto, autor–data como (Silva, 2021) ou numérica como [12], e a liga à entrada certa.',
          ],
        },
        {
          h2: '3. PDFs gratuitos e legais são procurados',
          p: [
            'Para as referências sem PDF, o Fontexto pergunta a catálogos acadêmicos abertos se existe uma cópia gratuita e legal: a versão em acesso aberto da editora, um repositório institucional ou temático, ou um servidor de preprints. Só o DOI, o título, o ano e o primeiro autor de cada referência são enviados. Veja a lista completa em [fontes de acesso aberto](open-access-sources).',
          ],
        },
        {
          h2: '4. Cada frase com citação é comparada com a fonte',
          p: [
            'A frase que contém a citação é comparada com cada frase do PDF citado (sem a bibliografia dele). Termos raros e específicos pesam mais que palavras comuns; números, siglas e um glossário português–inglês ajudam entre idiomas. Um modelo semântico multilíngue opcional reordena os melhores candidatos; ele é baixado uma única vez (cerca de 135 MB) e roda no seu navegador.',
          ],
        },
        {
          h2: '5. Você recebe um rótulo, nunca um veredito',
          ul: [
            '**Localizado**: um trecho compartilha a maior parte dos termos raros da frase.',
            '**Ressalva**: a coincidência é mais fraca, falta no trecho um número da frase ou só o resumo coincide.',
            '**Não localizado**: não há trecho parecido, nem PDF, nem texto extraível, ou a frase tem conteúdo de menos para comparar.',
          ],
          p: [
            'Os rótulos são candidatos para revisão humana. O Fontexto nunca marca uma citação como comprovada: você abre a fonte na página do trecho, compara os outros candidatos e decide.',
          ],
        },
        {
          h2: '6. Veja a bibliografia inteira',
          p: [
            'A tabela de referências mostra o status de cada entrada, quantas vezes ela é citada no seu texto e se um PDF foi encontrado. A rede de referências pergunta ao OpenAlex quais das suas referências se citam ou compartilham referências, colore por tema e exporta em PNG ou SVG. Essas ligações vêm do OpenAlex e são indicadas como tal.',
          ],
        },
      ],
    },
    faq: {
      nav: 'Perguntas frequentes',
      title: 'Perguntas frequentes sobre o Fontexto',
      description:
        'O Fontexto é grátis? Meus PDFs são enviados? Quais estilos de citação funcionam? Respostas sobre privacidade, PDFs em acesso aberto, rótulos e idiomas.',
      h1: 'Perguntas frequentes',
      lead: 'Respostas curtas sobre o que o Fontexto faz com os seus arquivos, o que os rótulos significam e de onde vêm os PDFs gratuitos.',
      sections: [],
      faq: [
        {
          q: 'O Fontexto é grátis?',
          a: 'Sim. O Fontexto é gratuito, não exige cadastro e não mostra anúncios. É software livre sob a licença GNU AGPL-3.0-or-later.',
        },
        {
          q: 'Meus PDFs são enviados para um servidor?',
          a: 'Não. Na edição web, o seu documento e os PDFs das referências são lidos dentro do navegador e guardados no banco de dados local dele (IndexedDB). Eles nunca saem do seu dispositivo. Detalhes na [página de privacidade](privacy).',
        },
        {
          q: 'O que sai do meu navegador?',
          a: 'Só quando você procura PDFs gratuitos ou ligações entre referências: o DOI, o título, o ano e o primeiro autor de cada referência vão para o serviço de busca do Fontexto, que consulta catálogos acadêmicos abertos e devolve o resultado. O texto do seu documento nunca é enviado.',
        },
        {
          q: '“Localizado” quer dizer que a citação está correta?',
          a: 'Não. “Localizado” quer dizer que um trecho da fonte compartilha a maior parte dos termos específicos da frase com a citação. É um indício forte, não uma prova. Leia sempre o trecho e decida você.',
        },
        {
          q: 'Quais estilos de citação e de referências são aceitos?',
          a: 'Citações no texto nos formatos autor–data e numérico. Listas de referências em ABNT, APA, Harvard, IEEE, Vancouver, GOST, DIN, autor–data francês e GB/T 7714, inclusive entradas em cirílico e chinês e listas sem o título “Referências”.',
        },
        {
          q: 'O Fontexto consegue artigos pagos?',
          a: 'Não. Ele só usa cópias legais em acesso aberto: acesso aberto da editora, repositórios institucionais e temáticos e servidores de preprints. Bibliotecas piratas não são aceitas, de propósito. Se você tem acesso a um artigo, pode adicionar o PDF você mesmo. Veja [fontes de acesso aberto](open-access-sources).',
        },
        {
          q: 'Com quais idiomas ele funciona?',
          a: 'A interface está em inglês, espanhol, russo e português do Brasil. Os documentos podem estar em qualquer idioma; a comparação funciona melhor quando o documento e a fonte estão no mesmo idioma, e o modelo multilíngue opcional ajuda entre idiomas.',
        },
        {
          q: 'Preciso criar uma conta?',
          a: 'Não. Abra fontexto.com e envie um PDF. Os projetos ficam salvos no seu navegador; limpar os dados do site apaga tudo.',
        },
        {
          q: 'Funciona com PDF digitalizado?',
          a: 'Sim, com OCR no navegador para textos em inglês e português. Os resultados são melhores com PDFs que já têm texto selecionável.',
        },
        {
          q: 'Como relato um problema de segurança?',
          a: 'Escreva para contact@xoryn.com.br. O nosso security.txt está publicado em /.well-known/security.txt.',
        },
      ],
    },
    about: {
      nav: 'Sobre',
      title: 'Sobre o Fontexto, o verificador de citações e fontes',
      description:
        'O Fontexto ajuda estudantes, pesquisadores e revisores a conferir se cada citação diz o que a fonte diz. Grátis, privado por padrão, software AGPL.',
      h1: 'Sobre o Fontexto',
      lead: 'O Fontexto existe para acelerar uma parte cansativa do trabalho acadêmico: conferir se cada citação aponta para um trecho da fonte que realmente a sustenta.',
      sections: [
        {
          h2: 'Para quem é',
          ul: [
            'Estudantes escrevendo TCC, dissertação ou tese que querem revisar as citações antes da entrega.',
            'Orientadores e membros de banca que precisam conferir fontes rapidamente.',
            'Pesquisadores, pareceristas e editores lendo um manuscrito com bibliografia longa.',
          ],
        },
        {
          h2: 'Princípios',
          ul: [
            '**Nada é inventado.** Nenhum dado bibliográfico, página ou trecho é inventado; valores desconhecidos aparecem como indisponíveis.',
            '**Rótulo não é prova.** A comparação automática só sugere trechos. Quem decide é sempre uma pessoa.',
            '**Privado por padrão.** Os seus PDFs ficam no seu navegador. Não há rastreadores nem scripts de terceiros. Um total anônimo de visitas à página inicial pode aparecer quando passar de 1.000 em 30 dias.',
            '**Só fontes legais.** Os PDFs gratuitos vêm de editoras de acesso aberto, repositórios e servidores de preprints.',
          ],
        },
        {
          h2: 'Software livre',
          p: [
            'O Fontexto é software livre sob a GNU Affero General Public License v3.0 ou posterior (AGPL-3.0-or-later). Quem oferecer uma versão modificada como serviço em rede deve disponibilizar o código-fonte aos seus usuários.',
          ],
        },
        {
          h2: 'Quem criou',
          p: [
            'O Fontexto foi criado e é desenvolvido por **Pablo Kauã Pereira Silva** (@kkauaps), estudante de Sistemas de Informação. Como estudante, ele conhece de perto a dor de conferir citação por citação no TCC, abrindo PDF atrás de PDF para achar o trecho certo, e criou o Fontexto para tornar essa revisão mais rápida e confiável.',
            '[X/Twitter @kkauaps](https://x.com/kkauaps) · [Threads @kkauaps](https://www.threads.com/@kkauaps) · [GitHub @kkauaps](https://github.com/kkauaps)',
          ],
        },
        {
          h2: 'Contato',
          p: ['Dúvidas sobre cópias em acesso aberto: oa@fontexto.com. Relatos de segurança: contact@xoryn.com.br.'],
        },
      ],
      credit: 'Criado por Pablo Kauã Pereira Silva ([@kkauaps](https://github.com/kkauaps))',
    },
    privacy: {
      nav: 'Privacidade',
      title: 'Privacidade: os seus PDFs ficam no seu navegador',
      description:
        'O que o Fontexto guarda, o que envia e para quem. Os seus PDFs nunca saem do navegador; sem cookies, analytics de terceiros ou anúncios.',
      h1: 'Privacidade',
      lead: 'O Fontexto foi feito para que os seus documentos nunca saiam do seu dispositivo. Esta página explica exatamente o que é guardado, o que é enviado e para quem.',
      sections: [
        {
          h2: 'O que fica no seu dispositivo',
          ul: [
            'O seu documento, os PDFs das referências e qualquer arquivo .bib que você adicionar são lidos no navegador e guardados no banco de dados local dele (IndexedDB).',
            'Projetos, decisões de revisão e configurações são guardados do mesmo jeito. Idioma e tema ficam no armazenamento local.',
            'Limpar os dados deste site no navegador apaga tudo. Nós não temos cópia.',
          ],
        },
        {
          h2: 'O que é enviado, e quando',
          p: [
            'Só quando você procura PDFs gratuitos ou ligações entre referências, o Fontexto envia o DOI, o título, o ano e o primeiro autor de cada referência para o serviço de busca em fontexto.com/api/oa. O serviço consulta catálogos acadêmicos abertos (listados em [fontes de acesso aberto](open-access-sources)) e devolve o resultado ou transmite o PDF para você.',
            'Os resultados das buscas ficam em cache por até 7 dias para reduzir a carga sobre os catálogos. O cache usa só os dados da referência e não está ligado a você. O serviço não mantém registros próprios e nunca guarda PDFs.',
          ],
        },
        {
          h2: 'Total anônimo de visitas',
          p: [
            'A página inicial guarda um único total de quantas vezes foi aberta nos últimos 30 dias. Só são armazenados totais diários: sem cookies, sem endereços IP, sem identificadores de dispositivo e sem dados pessoais. Uma aba pode lembrar, no armazenamento da sessão, que já foi contada, para um recarregamento na mesma aba não contar duas vezes. Essa marca não é um identificador e some quando a aba é fechada.',
            'O total só aparece na página inicial depois de passar de 1.000 visitas em 30 dias, como um número arredondado do tipo “1,2 mil pessoas usaram o Fontexto nos últimos 30 dias”.',
          ],
        },
        {
          h2: 'Avaliações para calibrar (opcional)',
          p: [
            'Desligado por padrão. Se você marcar “Ajudar a calibrar o Fontexto” no painel de uma citação, cada avaliação que fizer (OK, Ressalva, Não localizado) envia só quatro valores: o rótulo automático, a sua avaliação, a pontuação do trecho arredondada e se a busca semântica estava ligada. Nada do texto, título, DOI, arquivo ou projeto, e nenhum identificador. O servidor só soma esses valores em totais, usados para ajustar os limites dos rótulos automáticos.',
          ],
        },
        {
          h2: 'Extensão “Fontexto — meu acesso” (opcional)',
          p: [
            'Se você instalar a extensão, o Fontexto pode pedir a ela o PDF de uma referência sem cópia gratuita. A extensão busca pelo DOI, no seu navegador, usando o seu próprio acesso (rede da universidade, login da biblioteca). Ela só funciona no fontexto.com, só aceita DOIs e só devolve PDFs. Nada passa pelos servidores do Fontexto.',
          ],
        },
        {
          h2: 'O que não fazemos',
          ul: [
            'Sem contas, sem cookies, sem analytics de terceiros, sem publicidade, sem pixels de rastreamento.',
            'Sem scripts, fontes ou conteúdos de terceiros: tudo o que a página carrega vem de fontexto.com.',
            'Sem venda ou compartilhamento de dados pessoais, porque não os coletamos. O total de visitas é só um número anônimo.',
          ],
        },
        {
          h2: 'Hospedagem',
          p: [
            'O fontexto.com é servido pela Cloudflare. Como qualquer hospedagem, a Cloudflare processa dados de conexão, como endereços IP, para entregar o site e protegê-lo contra abusos, conforme a política de privacidade dela.',
          ],
        },
        {
          h2: 'Contato',
          p: ['Dúvidas sobre esta página: contact@xoryn.com.br.'],
        },
      ],
    },
    'open-access-sources': {
      nav: 'Fontes de acesso aberto',
      title: 'Onde o Fontexto encontra PDFs gratuitos e legais',
      description:
        'Os catálogos acadêmicos abertos que o Fontexto consulta para achar cópias gratuitas e legais das obras citadas, e as regras que segue. Sem bibliotecas piratas.',
      h1: 'Fontes de acesso aberto',
      lead: 'Quando uma referência não tem PDF, o Fontexto procura uma cópia gratuita que seja legal ler: a versão em acesso aberto da editora, um manuscrito do autor em repositório ou um preprint. Ele nunca usa bibliotecas piratas.',
      sections: [
        {
          h2: 'Catálogos consultados',
          ul: [
            '**OpenAlex**: índice aberto de obras acadêmicas, usado para identificar a obra e onde ela está em acesso aberto. Também fornece as ligações de citação da rede de referências.',
            '**Crossref**: metadados de DOI das editoras, usados quando a referência não tem DOI ou o OpenAlex não a conhece.',
            '**Unpaywall**: locais de acesso aberto para obras com DOI.',
            '**Europe PMC**: textos completos de ciências da vida e biomedicina.',
            '**arXiv**: preprints de física, matemática, computação e áreas afins.',
            '**Semantic Scholar**: links de PDF em acesso aberto do grafo acadêmico dele.',
            '**CORE**: artigos reunidos de repositórios institucionais e temáticos.',
          ],
        },
        {
          h2: 'Qual cópia é preferida',
          p: [
            'Primeiro as cópias hospedadas pela editora, depois repositórios e por último servidores de preprints. Entre versões, a publicada vem antes do manuscrito aceito, e o manuscrito aceito antes do preprint. O Fontexto mostra a versão e, quando conhecida, a licença, para você saber o que está lendo.',
          ],
        },
        {
          h2: 'Regras que seguimos',
          ul: [
            'Só são baixadas URLs devolvidas por esses catálogos; o serviço não é um proxy aberto.',
            'Cada arquivo é verificado como PDF e tem tamanho limitado. Os PDFs são transmitidos para você e nunca guardados.',
            'Só o DOI, o título, o ano e o primeiro autor de uma referência são enviados; nunca o seu documento.',
            'Se você tem acesso legítimo a um artigo que não está em acesso aberto, adicione o PDF você mesmo.',
          ],
        },
        {
          h2: 'Editoras e autores',
          p: [
            'Se você acha que uma cópia indicada pelo Fontexto não deveria ser oferecida, escreva para oa@fontexto.com com o DOI ou a URL. O Fontexto não hospeda os arquivos; ele aponta para cópias listadas pelos catálogos acima.',
          ],
        },
      ],
    },
  },
};
