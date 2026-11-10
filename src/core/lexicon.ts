/**
 * Language resources of the v2 matcher: stop words, a PT -> EN cognate normaliser and a general academic /
 * machine-learning / biomedical PT -> EN word list. Small on purpose: the embedding model (when available) does the
 * heavy cross-language lifting; this keeps the offline lexical stage useful on its own.
 */
import { stripDiacritics } from './normalize.js';

const STOP_PT =
  'a o as os um uma uns umas de do da dos das em no na nos nas por para com sem sob sobre entre ate apos ante contra desde durante perante e ou mas porem contudo todavia entretanto que qual quais quem cujo cuja cujos cujas onde como quando quanto quanta quantos quantas se nao sim mais menos muito muita muitos muitas pouco pouca poucos poucas tao tambem ja ainda so apenas mesmo mesma mesmos mesmas outro outra outros outras cada todo toda todos todas algum alguma alguns algumas nenhum nenhuma este esta estes estas esse essa esses essas isto isso aquilo aquele aquela aqueles aquelas ele ela eles elas nos voces eu tu meu minha seu sua seus suas nosso nossa ser estar ter haver fazer ir foi era sao eram sera serao seria sendo sido esta estao estava estavam tem tem tinha tinham ha havia pode podem poder deve devem dever fica ficam ficou pelo pela pelos pelas num numa nuns numas dele dela deles delas disso disto nesse nessa nesses nessas neste nesta nestes nestas nisso nisto assim entao pois porque portanto logo alem caso seja sejam bem tal tais vez vezes cerca face conforme segundo mediante via frente fonte dessa desse dessas desses desta deste destas destes aqui ali la';
const STOP_EN =
  'a an the and or but nor of to in on at by for with without from into onto over under about above below between among through during before after against within upon as is are was were be been being am do does did done doing have has had having will would shall should can could may might must this that these those it its itself they them their theirs we us our ours you your yours he him his she her hers i me my mine not no yes than then thus so such very more most less least much many few some any each every all both either neither other another same own only also just even still yet already again once here there where when while whereas which who whom whose what how why if else because since until unless although though however therefore hence per via etc eg ie et al fig table figure section used use using based using can';
export const STOPWORDS: ReadonlySet<string> = new Set(`${STOP_PT} ${STOP_EN}`.split(/\s+/).filter(Boolean));

/**
 * PT/EN spelling normalisation applied to every word so that cognates collapse to the same stem:
 * segmentacao / segmentation, anotacao / annotation, fotografia / photography, sistema / system, metodo / method.
 */
export function normalizeWord(w: string): string {
  let s = w;
  s = s.replace(/^avali/, 'evalu').replace(/^aval/, 'eval');
  s = s.replace(/(.)\1+/g, '$1'); // double letters: annotation / anotacao, supplement
  s = s.replace(/ph/g, 'f').replace(/th/g, 't').replace(/ck/g, 'c').replace(/y/g, 'i').replace(/kn/g, 'n');
  s = s.replace(/cao$|coes$/, 'tion').replace(/sao$|soes$/, 'sion').replace(/dade$|dades$/, 'ty');
  s = s.replace(/gem$|gens$/, 'ge'); // imagem / image, margem / margin
  s = s.replace(/(?<=.{3})(?:ados|adas|ado|ada)$/, 'ed').replace(/(?<=.{4})(?:os|as|es|s)$/, '');
  return s;
}

export const STEM_LEN = 5;
/** Search-term stem of an accent-free lower-case word. */
export const stemOf = (w: string): string => {
  const n = normalizeWord(w);
  return n.length > STEM_LEN ? n.slice(0, STEM_LEN) : n;
};

/** PT lemma -> EN equivalents. Keys and values are plain words; they are stemmed when the table is compiled. */
const PAIRS = `
ferida:wound,wounds|ferimento:wound,injury|tecido:tissue|granulacao:granulation|esfacelo:slough|escara:eschar|necrose:necrosis,necrotic|epitelio:epithelium,epithelial|epitelizacao:epithelialization
cicatrizacao:healing|cicatriz:scar|queimadura:burn,burns|ulcera:ulcer|pele:skin|calo:callus|exsudato:exudate|umido:moist|umidade:moisture|edema:edema,swelling|infeccao:infection|dor:pain
paciente:patient|clinico:clinician,clinical|enfermeiro:nurse|medico:physician,doctor|especialista:expert,specialist|profissional:professional|saude:health|doenca:disease|diagnostico:diagnosis|tratamento:treatment,therapy
estudo:study,studies|pesquisa:research,study|trabalho:work,paper,study|artigo:paper,article|autor:author|resultado:result,results,finding|resultados:results,findings|conclusao:conclusion|metodo:method|metodologia:methodology|abordagem:approach
conjunto:set|dados:data,dataset|acervo:dataset,collection,corpus|amostra:sample|exemplo:example,instance|caso:case|classe:class,category|categoria:category,class|rotulo:label|rotulos:labels|anotacao:annotation,labeling,labelling|anotado:annotated,labeled
treinamento:training|treino:training|treinar:train|treinado:trained|teste:test,testing|validacao:validation|avaliacao:evaluation,assessment|avaliar:evaluate,assess|desempenho:performance|precisao:accuracy,precision|revocacao:recall|acuracia:accuracy|erro:error,mistake|perda:loss|metrica:metric|metricas:metrics
aprendizado:learning|aprendizagem:learning|profundo:deep|raso:shallow|rede:network|redes:networks|neural:neural|modelo:model|modelos:models|arquitetura:architecture|camada:layer|camadas:layers|peso:weight|pesos:weights|parametro:parameter|parametros:parameters|funcao:function
segmentacao:segmentation|segmentar:segment|mascara:mask,masks|imagem:image,images|imagens:images|fotografia:photograph,photo,image|fotografias:photographs,photos,images|pixel:pixel|pixels:pixels|regiao:region|borda:border,boundary,edge|contorno:contour,outline,boundary|limite:boundary,limit|delimitacao:delineation,delimitation,boundary|delimitar:delineate
visual:visual|visao:vision|computacional:computer|deteccao:detection|detectar:detect|classificacao:classification|classificar:classify|reconhecimento:recognition|extracao:extraction|caracteristica:feature,characteristic|atributo:attribute,feature|textura:texture|cor:color,colour|cores:colors|forma:shape,form|tamanho:size
codificador:encoder|decodificador:decoder|atencao:attention|transformador:transformer|convolucional:convolutional|convolucao:convolution|pre-treinado:pretrained|pre-treinamento:pretraining|autossupervisionado:self-supervised|supervisionado:supervised|supervisao:supervision|semissupervisionado:semi-supervised|aumento:augmentation,increase|ajuste:fine-tuning,tuning,adjustment|fino:fine
transferencia:transfer|generalizacao:generalization|sobreajuste:overfitting|desbalanceamento:imbalance|desbalanceado:imbalanced|balanceamento:balancing|ruido:noise|robusto:robust|robustez:robustness|escalavel:scalable|eficiente:efficient|eficiencia:efficiency|leve:lightweight|rapido:fast|velocidade:speed|latencia:latency
custo:cost|computacional:computational|memoria:memory|tempo:time|hardware:hardware|nuvem:cloud|local:local|processamento:processing|unidade:unit|grafica:graphics|placa:card|inferencia:inference
concordancia:agreement|discordancia:disagreement|variabilidade:variability|variacao:variation|consistencia:consistency|confiabilidade:reliability|confiavel:reliable|subjetividade:subjectivity|subjetivo:subjective|observador:observer,rater|avaliador:rater|intraobservador:intrarater|interobservador:interrater|intra-observador:intrarater|inter-observador:interrater
sobreposicao:overlap|intersecao:intersection|uniao:union|coeficiente:coefficient|correlacao:correlation|intervalo:interval|confianca:confidence|significativo:significant|estatistico:statistical|media:mean,average|mediana:median|desvio:deviation|padrao:standard,pattern|taxa:rate|razao:ratio|proporcao:proportion,ratio|percentual:percentage|porcentagem:percentage
propor:propose|proposto:proposed|proposta:proposal,proposed|apresentar:present|descrever:describe|descreve:describes|descrito:described|relatar:report|relataram:reported|relatado:reported|observar:observe|observaram:observed|mostrar:show|mostraram:showed|demonstrar:demonstrate|demonstrou:demonstrated|indicar:indicate|indicam:indicate|sugerir:suggest|sugerem:suggest
usar:use|usado:used|utilizar:use,utilize|utilizado:used,utilized|aplicar:apply|aplicado:applied|aplicacao:application|empregar:employ|adotar:adopt|adotado:adopted|considerar:consider|investigar:investigate|investigaram:investigated|analisar:analyze,analyse|analise:analysis|comparar:compare|comparacao:comparison
superior:superior,higher,better|inferior:inferior,lower,worse|melhor:better,best|pior:worse,worst|maior:larger,greater,higher|menor:smaller,lower,less|alto:high|baixo:low|grande:large,big|pequeno:small|pouco:few,little,small|muito:many,much,very|poucos:few|varios:several,various|diversos:several,various
base:baseline,base|referencia:reference,baseline|linha:line,baseline|inicial:initial|final:final|etapa:stage,step|fase:phase,stage|duas:two|tres:three|quatro:four|cinco:five|seis:six|sete:seven|oito:eight|nove:nine|dez:ten|cem:hundred|mil:thousand
publico:public|publicamente:publicly|disponivel:available|aberto:open|codigo:code|licenca:license|etica:ethics|etico:ethical|consentimento:consent|privacidade:privacy|anonimizacao:anonymization|anonimizado:anonymized
limitacao:limitation|limitacoes:limitations|desafio:challenge|desafios:challenges|problema:problem|solucao:solution|objetivo:objective,goal,aim|hipotese:hypothesis|pergunta:question|questao:question|revisao:review|sistematica:systematic|literatura:literature|estado:state|arte:art
exame:examination,assessment|medicao:measurement|medir:measure|medida:measure,measurement|estimativa:estimate,estimation|estimar:estimate|identificacao:identification|identificar:identify|quantificacao:quantification|quantificar:quantify|delineamento:design|desenho:design|projeto:project,design
clinicamente:clinically|manual:manual|manualmente:manually|automatico:automatic,automated|automaticamente:automatically|semiautomatico:semi-automatic|processo:process|fluxo:workflow,flow|ferramenta:tool|software:software|aplicativo:app,application|movel:mobile|celular:mobile,smartphone|camera:camera|iluminacao:lighting,illumination|fundo:background|sombra:shadow|reflexo:reflection,glare
lesao:lesion|lesoes:lesions|perilesional:periwound,perilesional|periferida:periwound|vascular:vascular|diabetico:diabetic|pe:foot|pernas:legs|perna:leg|pressao:pressure|venosa:venous|arterial:arterial|cronica:chronic|cronico:chronic|aguda:acute|agudo:acute|cirurgica:surgical|cirurgico:surgical
grau:grade,degree|gravidade:severity|profundidade:depth|area:area|superficie:surface|largura:width|comprimento:length|volume:volume|espessura:thickness|saliente:raised|rosa:pink|vermelho:red|vermelha:red|amarelo:yellow|amarelada:yellowish|preto:black|negro:black|branco:white|esbranquicada:whitish|seca:dry|seco:dry
`;

/** Compiled glossary: PT stem -> EN stems. */
export const GLOSSARY_V2: ReadonlyMap<string, readonly string[]> = (() => {
  const m = new Map<string, Set<string>>();
  for (const line of PAIRS.split('\n')) {
    for (const item of line.split('|')) {
      const [pt, en] = item.split(':');
      if (!pt || !en) continue;
      const k = stemOf(stripDiacritics(pt.trim().toLowerCase()));
      const set = m.get(k) ?? new Set<string>();
      for (const e of en.split(',')) set.add(stemOf(stripDiacritics(e.trim().toLowerCase())));
      set.delete(k);
      m.set(k, set);
    }
  }
  return new Map([...m].map(([k, v]) => [k, [...v]]));
})();
