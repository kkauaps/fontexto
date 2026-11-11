# Avaliação do localizador automático de passagens

O Fontexto liga cada citação do artigo a passagens do PDF da referência **sem curadoria**. Este documento descreve como
medimos isso, os números atuais e os limites.

## Conjunto de referência (gold)

O projeto de referência tem uma revisão manual (a curadoria importada de `index.html`): para cada ocorrência de citação, o
veredito (Localizado / Ressalva / Não localizado) e as páginas das passagens escolhidas. `scripts/eval/gold.mts` carrega
isso e o pareia com as ocorrências do projeto (por chave, por autor+ano e, no fim, por similaridade de frase).

- 187 ocorrências resolvidas (as 6 "Autor (2026)" são autocitações de fonte de tabela e não entram: ver
  `isSelfCitation`).
- Métricas por ocorrência: a página certa do PDF da referência está entre as **1** / **3** primeiras passagens; e a
  concordância de status com a curadoria (3 classes), com precisão/revocação do rótulo "Localizado".

Os dois fluxos (com `.bib` e sem `.bib`) dão números idênticos: a ligação citação→referência acerta 31/31 em ambos, e
a diferença só aparece na ligação, não na busca de trecho.

## Resultados (conjunto de referência, 187 ocorrências)

| Localizador | página certa top-1 | top-3 | status (3 classes) | Localizado: precisão | Localizado: revocação |
|---|---|---|---|---|---|
| v1 (antes) | 33,9% | 59,6% | 34,8% | 0,91 | 0,30 |
| v2 léxico (padrão) | 42,1% | 68,3% | 69,0% | 0,91 | 0,71 |
| v2 + modelo semântico (opcional, só web) | 47,0% | 72,1% | 65,2% | 0,91 | 0,67 |

Reproduzir: `DATA_DIR=<dados> PROJECT=<id> npx tsx scripts/eval/final.mts [lex|sem|all]`.

## O que mudou no v2

1. **Afirmação em três camadas**: a oração em volta do marcador (peso 1,0), a frase que cita (0,7) e as frases vizinhas
   (0,3). Autocitações e nomes do próprio texto saem da afirmação.
2. **PT→EN**: glossário de termos técnicos (peso 0,9) e normalização de cognatos (`segmentação`≈`segmentation`,
   duplas, ph→f, y→i, -ção→-tion…), radical de 5 letras. Números e siglas pesam ×2.
3. **Janelas de passagem** de 1–3 frases pontuadas por BM25 (k1 1,2; b 0,5), com casamento aproximado (distância de edição 1).
4. **Re-ranqueamento semântico opcional** (`paraphrase-multilingual-MiniLM-L12-v2`, ONNX 8 bits, ~135 MB, roda no
   navegador via onnxruntime-web, autohospedado). A pontuação final mistura o léxico e a similaridade de cosseno.
5. **Rótulo por pontuação absoluta** (limiares em `evidence.ts`: `v2 {strong, weak, strongSem, weakSem}`); números
   ausentes e a região "resumo" só acrescentam notas.

## Calibração e limites (leia antes de confiar nos números)

- Os limiares foram escolhidos na curva precisão×revocação do "Localizado". Usamos uma divisão em 2 dobras (hash da
  chave bibtex, `scripts/eval/calib*.mts`) para checar sobreajuste; como são só 187 ocorrências de um trabalho, as
  estimativas por dobra são ruidosas e os números acima são do conjunto inteiro.
- A pontuação léxica **não prevê bem** se a *página* está certa (AUC ≈ 0,5): otimizar a concordância de status degenera
  em "tudo Localizado". Por isso o rótulo "Localizado" significa "há uma passagem sobre os mesmos termos", nunca "a fonte
  comprova a afirmação". Toda passagem é candidata e precisa de revisão humana.
- O gold por página é ruidoso: uma frase costuma ter várias afirmações e várias páginas aceitáveis.
- O conjunto é um único trabalho (PT→EN). Em outras áreas os números podem ser piores.
- O automático **não** chega ao nível da curadoria manual. O objetivo é mostrar o trecho certo entre as 3 primeiras
  opções em ~2/3 dos casos e deixar o resto claro como "Ressalva"/"Não localizado".
