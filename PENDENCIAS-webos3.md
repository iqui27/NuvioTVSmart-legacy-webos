# webOS 3.x (Chromium 38) — estado

Variante experimental para TVs LG de 2015-2016, motivada pela issue #1: um usuário
com LG 55UH617V se ofereceu para testar. **Nunca rodou em aparelho webOS 3** —
não existe um no projeto, e tudo abaixo é verificação estática.

## O que está resolvido

**Sintaxe.** O esbuild **recusa** ter o 38 como alvo (`Transforming const to the
configured target environment ("chrome38") is not supported yet` — ele não faz
lowering completo de escopo de bloco), então ele empacota no menor alvo que aceita
(53) e um passe Babel `preset-env` rebaixa os bundles para 38. Mesma técnica que o
build do serviço já usa para alcançar o Node 0.12. Inclui `assets/libs/ass.min.js`,
que escapava e sairia com 51 arrow functions.

**Polyfills.** Verificado executando `dist/core-js.bundle.js` num sandbox com os
builtins deletados: antes `undefined`, depois `function`. Cobre `Object.assign`
(que matava o boot, usado no topo de um módulo importado pelo router),
`Array.from`, `find`, `findIndex`, `String.includes/startsWith/endsWith/repeat`, e
`fetch` via `whatwg-fetch` — o core-js não fornece `fetch`, ele cobre ECMAScript e
não API de rede. `Element.closest` tem shim, e sem ele o D-pad não navegaria.

**Custom properties.** Eram o bloqueador principal: ~1577 usos de `var()`, e o
Chromium 38 descarta a declaração inteira que contém uma. Um plugin PostCSS próprio
resolve tudo para valores concretos no build (`postcss-custom-properties` não serve:
218 tokens são definidos escopados a seletores, e 43 nomes têm valores diferentes por
escopo). O dist da variante sai com **zero** `var(`, garantido por gate.

**Temas.** 14 folhas geradas no build — 12 paletas mais duas de override AMOLED,
empilhadas. Trocar de tema alterna a folha em vez de chamar `setProperty`.

## O que degrada, e por quê

Está na seção "Aproximacoes webOS 3" abaixo, item a item. Em resumo: tamanho e cor
de legenda nativa congelados, dimensões de poster calculadas em runtime congeladas
nas defaults estáticas, intensidade do efeito de profundidade fixa, e o renderer de
legenda ASS desligado (a lib externa depende de custom properties).

## O que ninguém consegue saber sem aparelho

- Se realmente boota no motor 38.
- Se o `hls.js`/MSE funciona lá.
- Qual versão do Node o serviço encontra no webOS 3 (o serviço é ES5 puro, então um
  Node igual ou mais novo que o 0.12 funciona; um 0.10 seria risco).
- O custo do bundle 31% maior (1,99 MB → 2,60 MB) num SoC de 2016 — o passe Babel
  troca escopo de bloco por closures, e parsear isso pode ser o gargalo real.

## Gates que protegem esta variante

`check:source`, `check:no-undef`, `test:css-vars`, `check:js-apis`,
`check:legacy-regex`, `check:legacy-css-vars`, `check:css-support`. Os dois últimos
conferem contra a base do caniuse e são a única verificação de compatibilidade
possível sem aparelho: o emulador da LG é imagem x86 (não roda em Apple Silicon) e o
binário do Chromium 38 para Mac é de 2014.

Limite medido: o `doiuse` **não** detecta `aspect-ratio`. Os gates cobrem a maior
parte, não tudo.

## Aproximacoes webOS 3 (runtime sem custom properties)

No Chromium 38 `setProperty("--x", ...)` e no-op. Cada call site foi tratado
com folha gerada, estilo inline ou congelamento na default de build. O que foi
CONGELADO degrada assim (tudo atras de `SUPPORTS_CSS_VARS` / `no-css-vars`;
nada muda no webOS 4):

- **Troca de tema** (`themeManager.js`): resolvida por folha gerada
  (`dist/css/theme-<nome>.css`, + `theme-amoled[-surfaces].css` empilhada).
  Degradacao residual: 4 declaracoes que misturam token de fundo com outra cor
  do tema (`.discover-hero` e `.cast-detail-shell`, `background`) ficam fora
  das folhas AMOLED e mantem o fundo da paleta em vez de preto puro.
- **Fonte do app** (`appFontLoader.js`): pilha aplicada inline no `<body>`.
  Regras com `font-family` explicito foram congeladas no build com a default
  de `RUNTIME_TOKEN_DEFAULTS` e nao acompanham a troca de fonte do usuario.
- **Legendas do player** (`playerScreen.js`): cor/tamanho/peso/sombra/offset
  aplicados inline no container `#playerHtmlSubtitles` (legendas externas).
  CONGELADO: o render nativo do `<video>` (`::cue`,
  `::-webkit-media-text-track-*`) nao aceita estilo inline — legendas
  embutidas nativas ficam com os defaults de build (branco, 34px, peso 600,
  sombra padrao, offset 72px) e ignoram os controles do usuario.
- **Legenda ASS** (`assRenderer.js`): DESLIGADA — ass.js escreve `--ass-*` em
  runtime e o CSS as consome via `calc(var(...))`. O gate falha antes de
  baixar a lib e o player cai para o VTT convertido (perde estilo/posicao ASS,
  mantem o texto). Mesmo contrato do gate de ResizeObserver.
- **Scroll manual da lista de streams** (`streamScreen.js`): ja coberto —
  `updateManualListScrollTransform` aplica o mesmo `translateY` inline nos
  filhos; o token so existia como atalho. Sem degradacao.
- **Posters da home** (`homeScreen.js`): CONGELADO. O CSS usa as dimensoes
  resolvidas no build; o JS usa os fallbacks de `parseCssPx` (228px etc.).
  Com `NUVIO_UI_SCALE=0.8` o CSS escala e o JS nao, entao a matematica de
  scroll/expansao da home moderna pode desalinhar alguns px do render. Aceito:
  as defaults estaticas sao boas e o desvio e cosmetico.
- **Marquee de settings** (`settingsScreen.js`): CONGELADO no fallback de
  build `32px` — o espaco entre as copias do texto deixa de ser proporcional
  a largura.
- **Overlay parental** (`playerScreen.js`): CONGELADO nos fallbacks
  `var(..., x)` de build (alturas/delays da animacao com valores tipicos).
  Excecao boa: `--parental-accent` cai para `var(--secondary-color)`, que as
  folhas de tema resolvem POR PALETA — o acento acompanha o tema.
- **Fundo da barra de acoes do player** (`playerScreen.js`,
  `--player-action-controls-open-bottom`): CONGELADO em 220px
  (`RUNTIME_TOKEN_DEFAULTS`) em vez do valor medido — o degrade inferior pode
  nao casar exatamente com a altura real do painel aberto.
- **Card depth** (`layoutPreferences.js`): liga/desliga continua funcionando
  (data-atributos); a INTENSIDADE (edge/sheen/coverage) fica CONGELADA nos
  fallbacks de build (0.28 / 0.1 / 12px).

Nada disto foi verificado em aparelho webOS 3 — nao ha aparelho no projeto;
verificacao estatica apenas (gates + leitura dos consumidores no CSS).
