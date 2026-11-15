import type { SiteContent } from '../types';

export const es: SiteContent = {
  chrome: {
    skip: 'Saltar al contenido',
    menuLabel: 'Sitio',
    languageLabel: 'Idioma',
    breadcrumbLabel: 'Ruta de navegación',
    openApp: 'Abrir Fontexto',
    ctaTitle: 'Pruébalo con tu propio documento',
    ctaText: 'Gratis, sin cuenta, y tus PDF se quedan en tu navegador.',
    footerNote: 'La etiqueta de cada cita es una ayuda de lectura, no una prueba. Revisa siempre el pasaje en la fuente.',
    license: 'Software libre bajo la GNU AGPL-3.0-or-later.',
    updated: 'Última actualización',
    ogLocale: 'es_ES',
    appDescription:
      'Fontexto vincula cada cita de un documento académico con el pasaje exacto de la fuente citada. Sube un PDF: lee la lista de referencias, busca versiones legales de acceso abierto de las obras citadas y muestra la página donde cada fuente dice lo que afirma el texto, lista para revisar.',
    featureList: [
      'Vincula las citas en el texto (autor–año y numéricas) con sus referencias',
      'Encuentra pasajes candidatos en el PDF de cada referencia y los etiqueta como Localizado, Salvedad o No localizado',
      'Extrae listas de referencias en los estilos ABNT, APA, Harvard, IEEE, Vancouver, GOST, DIN y GB/T 7714',
      'Busca PDF legales de acceso abierto en OpenAlex, Crossref, Unpaywall, Europe PMC, arXiv, Semantic Scholar y CORE',
      'Red de referencias construida con datos de citas de OpenAlex',
      'Los PDF se procesan en el navegador y nunca se suben',
    ],
    ogImageAlt: 'Fontexto: cada cita vinculada al pasaje exacto de la fuente',
  },
  pages: {
    'how-it-works': {
      nav: 'Cómo funciona',
      title: 'Cómo Fontexto vincula cada cita con el pasaje de la fuente',
      description:
        'De tu PDF a una cita revisada: cómo Fontexto lee las referencias, encuentra PDF gratuitos y legales y localiza el pasaje al que remite cada cita.',
      h1: 'Cómo funciona Fontexto',
      lead: 'Subes un documento. Fontexto lee su lista de referencias, encuentra copias gratuitas y legales de las obras citadas y, para cada cita, te señala el pasaje de la fuente que con más probabilidad la respalda. La decisión final es tuya.',
      sections: [
        {
          h2: '1. Sube tu documento',
          p: [
            'Basta con una tesis, disertación, artículo o informe en PDF. Si el PDF ya contiene texto, Fontexto lo lee directamente; las páginas escaneadas pueden leerse con OCR en el navegador (inglés y portugués).',
            'También puedes añadir los PDF de tus referencias o un archivo .bib. Son opcionales: sin ellos, Fontexto arma la lista de referencias a partir del propio documento.',
          ],
        },
        {
          h2: '2. Se extraen las referencias y las citas',
          p: [
            'Fontexto encuentra la lista de referencias, incluso sin un título «Referencias», y la divide en entradas. Entiende los estilos habituales en tesis y revistas: ABNT, APA, Harvard, IEEE, Vancouver, GOST, DIN, autor–año francés y GB/T 7714, incluidas referencias en cirílico o chino, tesis y DOI poco comunes.',
            'Después encuentra cada cita en el texto, de autor–año como (Silva, 2021) o numérica como [12], y la vincula con la entrada correcta.',
          ],
        },
        {
          h2: '3. Se buscan PDF gratuitos y legales',
          p: [
            'Para las referencias sin PDF, Fontexto pregunta a catálogos académicos abiertos si existe una copia gratuita y legal: la versión de acceso abierto del editor, un repositorio institucional o temático, o un servidor de preprints. Solo se envían el DOI, el título, el año y el primer autor de cada referencia. Consulta la lista completa en [fuentes de acceso abierto](open-access-sources).',
          ],
        },
        {
          h2: '4. Cada frase con cita se compara con la fuente',
          p: [
            'La frase que contiene la cita se compara con cada frase del PDF citado (sin su bibliografía). Los términos raros y específicos pesan más que las palabras comunes; los números, las siglas y un glosario portugués–inglés ayudan entre idiomas. Un modelo semántico multilingüe opcional reordena los mejores candidatos; se descarga una sola vez (unos 135 MB) y funciona en tu navegador.',
          ],
        },
        {
          h2: '5. Recibes una etiqueta, nunca un veredicto',
          ul: [
            '**Localizado**: un pasaje comparte la mayoría de los términos raros de la frase.',
            '**Salvedad**: la coincidencia es más débil, falta en el pasaje un número de la frase o solo coincide el resumen.',
            '**No localizado**: no hay pasaje parecido, ni PDF, ni texto extraíble, o la frase tiene muy poco contenido para comparar.',
          ],
          p: [
            'Las etiquetas son candidatas para revisión humana. Fontexto nunca marca una cita como comprobada: abres la fuente en la página del pasaje, comparas los demás candidatos y decides.',
          ],
        },
        {
          h2: '6. Mira toda la bibliografía',
          p: [
            'La tabla de referencias muestra el estado de cada entrada, cuántas veces se cita en tu texto y si se encontró un PDF. La red de referencias pregunta a OpenAlex cuáles de tus referencias se citan entre sí o comparten referencias, las colorea por tema y se exporta en PNG o SVG. Estos vínculos vienen de OpenAlex y se indican como tales.',
          ],
        },
      ],
    },
    faq: {
      nav: 'Preguntas frecuentes',
      title: 'Preguntas frecuentes sobre Fontexto',
      description:
        '¿Fontexto es gratis? ¿Se suben mis PDF? ¿Qué estilos de cita funcionan? Respuestas sobre privacidad, PDF de acceso abierto, etiquetas e idiomas.',
      h1: 'Preguntas frecuentes',
      lead: 'Respuestas breves sobre qué hace Fontexto con tus archivos, qué significan las etiquetas y de dónde salen los PDF gratuitos.',
      sections: [],
      faq: [
        {
          q: '¿Fontexto es gratis?',
          a: 'Sí. Fontexto es gratuito, no requiere cuenta y no muestra anuncios. Es software libre bajo la licencia GNU AGPL-3.0-or-later.',
        },
        {
          q: '¿Mis PDF se suben a un servidor?',
          a: 'No. En la edición web, tu documento y los PDF de las referencias se leen dentro del navegador y se guardan en su base de datos local (IndexedDB). Nunca salen de tu dispositivo. Más detalles en la [página de privacidad](privacy).',
        },
        {
          q: '¿Qué sale de mi navegador?',
          a: 'Solo cuando buscas PDF gratuitos o vínculos entre referencias: el DOI, el título, el año y el primer autor de cada referencia van al servicio de búsqueda de Fontexto, que consulta catálogos académicos abiertos y devuelve el resultado. El texto de tu documento nunca se envía.',
        },
        {
          q: '¿«Localizado» significa que la cita es correcta?',
          a: 'No. «Localizado» significa que un pasaje de la fuente comparte la mayoría de los términos específicos de la frase con la cita. Es un indicio fuerte, no una prueba. Lee siempre el pasaje y decide tú.',
        },
        {
          q: '¿Qué estilos de cita y de referencias admite?',
          a: 'Citas en el texto en formato autor–año y numérico. Listas de referencias en ABNT, APA, Harvard, IEEE, Vancouver, GOST, DIN, autor–año francés y GB/T 7714, incluidas entradas en cirílico y chino y listas sin título «Referencias».',
        },
        {
          q: '¿Fontexto consigue artículos de pago?',
          a: 'No. Solo usa copias legales de acceso abierto: acceso abierto del editor, repositorios institucionales y temáticos, y servidores de preprints. Las bibliotecas piratas no se admiten, a propósito. Si tienes acceso a un artículo, puedes añadir su PDF tú mismo. Consulta [fuentes de acceso abierto](open-access-sources).',
        },
        {
          q: '¿Con qué idiomas funciona?',
          a: 'La interfaz está en inglés, español, ruso y portugués de Brasil. Los documentos pueden estar en cualquier idioma; la comparación funciona mejor cuando el documento y la fuente comparten idioma, y el modelo multilingüe opcional ayuda entre idiomas.',
        },
        {
          q: '¿Necesito crear una cuenta?',
          a: 'No. Abre fontexto.com y sube un PDF. Los proyectos se guardan en tu navegador; si borras los datos del sitio, se eliminan.',
        },
        {
          q: '¿Funciona con PDF escaneados?',
          a: 'Sí, con OCR en el navegador para textos en inglés y portugués. Los resultados son mejores con PDF que ya tienen texto seleccionable.',
        },
        {
          q: '¿Cómo informo de un problema de seguridad?',
          a: 'Escribe a contact@xoryn.com.br. Nuestro security.txt está publicado en /.well-known/security.txt.',
        },
      ],
    },
    about: {
      nav: 'Acerca de',
      title: 'Acerca de Fontexto, el verificador de citas y fuentes',
      description:
        'Fontexto ayuda a estudiantes, investigadores y revisores a comprobar que cada cita dice lo que dice la fuente. Gratis, privado por diseño, software AGPL.',
      h1: 'Acerca de Fontexto',
      lead: 'Fontexto existe para acelerar una parte tediosa del trabajo académico: comprobar que cada cita remite a un pasaje de la fuente que de verdad la respalda.',
      sections: [
        {
          h2: 'Para quién es',
          ul: [
            'Estudiantes que escriben una tesis o disertación y quieren revisar sus citas antes de entregarla.',
            'Directores y miembros de tribunal que necesitan comprobar fuentes con rapidez.',
            'Investigadores, revisores y editores que leen un manuscrito con una bibliografía extensa.',
          ],
        },
        {
          h2: 'Principios',
          ul: [
            '**Nada se inventa.** Ningún dato bibliográfico, página o pasaje es inventado; los valores desconocidos se muestran como no disponibles.',
            '**Las etiquetas no son pruebas.** La comparación automática solo sugiere pasajes. Siempre decide una persona.',
            '**Privado por diseño.** Tus PDF se quedan en tu navegador. No hay analítica, rastreadores ni scripts de terceros.',
            '**Solo fuentes legales.** Los PDF gratuitos vienen de editores de acceso abierto, repositorios y servidores de preprints.',
          ],
        },
        {
          h2: 'Software libre',
          p: [
            'Fontexto es software libre bajo la GNU Affero General Public License v3.0 o posterior (AGPL-3.0-or-later). Quien ofrezca una versión modificada como servicio en red debe poner su código fuente a disposición de sus usuarios.',
          ],
        },
        {
          h2: 'Contacto',
          p: ['Preguntas sobre copias de acceso abierto: oa@fontexto.com. Avisos de seguridad: contact@xoryn.com.br.'],
        },
      ],
      credit: 'Creado por Pablo Kauã ([@kkauaps](https://github.com/kkauaps))',
    },
    privacy: {
      nav: 'Privacidad',
      title: 'Privacidad: tus PDF se quedan en tu navegador',
      description:
        'Qué guarda Fontexto, qué envía y a quién. Tus PDF nunca salen del navegador; sin cookies, analítica ni anuncios.',
      h1: 'Privacidad',
      lead: 'Fontexto está hecho para que tus documentos nunca salgan de tu dispositivo. Esta página explica con exactitud qué se guarda, qué se envía y a quién.',
      sections: [
        {
          h2: 'Lo que se queda en tu dispositivo',
          ul: [
            'Tu documento, los PDF de las referencias y cualquier archivo .bib que añadas se leen en tu navegador y se guardan en su base de datos local (IndexedDB).',
            'Los proyectos, las decisiones de revisión y los ajustes se guardan igual. El idioma y el tema se conservan en el almacenamiento local.',
            'Si borras los datos de este sitio en tu navegador, se elimina todo. No tenemos copia.',
          ],
        },
        {
          h2: 'Qué se envía y cuándo',
          p: [
            'Solo cuando buscas PDF gratuitos o vínculos entre referencias, Fontexto envía el DOI, el título, el año y el primer autor de cada referencia a su servicio de búsqueda en fontexto.com/api/oa. El servicio consulta catálogos académicos abiertos (listados en [fuentes de acceso abierto](open-access-sources)) y te devuelve el resultado o te transmite el PDF.',
            'Los resultados de búsqueda se guardan en caché hasta 7 días para reducir la carga sobre los catálogos. La caché usa solo los datos de la referencia y no está vinculada a ti. El servicio no guarda registros propios y nunca almacena PDF.',
          ],
        },
        {
          h2: 'Lo que no hacemos',
          ul: [
            'Sin cuentas, sin cookies, sin analítica, sin publicidad, sin píxeles de seguimiento.',
            'Sin scripts, fuentes ni contenidos de terceros: todo lo que carga la página viene de fontexto.com.',
            'Sin venta ni cesión de datos, porque no los recopilamos.',
          ],
        },
        {
          h2: 'Alojamiento',
          p: [
            'fontexto.com se sirve a través de Cloudflare. Como cualquier proveedor de alojamiento, Cloudflare procesa datos de conexión, como direcciones IP, para entregar el sitio y protegerlo de abusos, según su propia política de privacidad.',
          ],
        },
        {
          h2: 'Contacto',
          p: ['Preguntas sobre esta página: contact@xoryn.com.br.'],
        },
      ],
    },
    'open-access-sources': {
      nav: 'Fuentes de acceso abierto',
      title: 'Dónde encuentra Fontexto PDF gratuitos y legales',
      description:
        'Los catálogos académicos abiertos que consulta Fontexto para encontrar copias gratuitas y legales de las obras citadas, y sus reglas. Sin bibliotecas piratas.',
      h1: 'Fuentes de acceso abierto',
      lead: 'Cuando una referencia no tiene PDF, Fontexto busca una copia gratuita que sea legal leer: la versión de acceso abierto del editor, un manuscrito del autor en un repositorio o un preprint. Nunca usa bibliotecas piratas.',
      sections: [
        {
          h2: 'Catálogos que consultamos',
          ul: [
            '**OpenAlex**: índice abierto de obras académicas, usado para identificar la obra y sus ubicaciones de acceso abierto. También aporta los vínculos de citas de la red de referencias.',
            '**Crossref**: metadatos DOI de los editores, usados cuando la referencia no tiene DOI u OpenAlex no la conoce.',
            '**Unpaywall**: ubicaciones de acceso abierto para obras con DOI.',
            '**Europe PMC**: textos completos de ciencias de la vida y biomedicina.',
            '**arXiv**: preprints de física, matemáticas, informática y áreas afines.',
            '**Semantic Scholar**: enlaces a PDF de acceso abierto de su grafo académico.',
            '**CORE**: artículos reunidos de repositorios institucionales y temáticos.',
          ],
        },
        {
          h2: 'Qué copia se prefiere',
          p: [
            'Primero las copias alojadas por el editor, después los repositorios y por último los servidores de preprints. Entre versiones, se prefiere la publicada al manuscrito aceptado, y el manuscrito aceptado a un preprint. Fontexto muestra la versión y, si se conoce, la licencia, para que sepas qué estás leyendo.',
          ],
        },
        {
          h2: 'Reglas que seguimos',
          ul: [
            'Solo se descargan URL devueltas por estos catálogos; el servicio no es un proxy abierto.',
            'Se comprueba que cada archivo sea un PDF y se limita su tamaño. Los PDF se te transmiten y nunca se almacenan.',
            'Solo se envían el DOI, el título, el año y el primer autor de una referencia; nunca tu documento.',
            'Si tienes acceso legítimo a un artículo que no es de acceso abierto, añade su PDF tú mismo.',
          ],
        },
        {
          h2: 'Editores y autores',
          p: [
            'Si crees que una copia indicada por Fontexto no debería ofrecerse, escribe a oa@fontexto.com con el DOI o la URL. Fontexto no aloja los archivos; enlaza copias listadas por los catálogos anteriores.',
          ],
        },
      ],
    },
  },
};
