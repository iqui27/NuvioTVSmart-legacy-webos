# webOS 3.x (Chromium 38) — estado e a decisão que falta

## Onde está

A sintaxe está resolvida: o esbuild empacota em 53 (ele **recusa** 38, com
`Transforming const to the configured target environment ("chrome38") is not
supported yet`) e um passe Babel `preset-env` rebaixa os bundles para 38.

Os polyfills também: verificado executando `dist/core-js.bundle.js` num sandbox com
`Object.assign`, `Array.from`, `Array.prototype.find/findIndex` e
`String.prototype.includes/startsWith/endsWith/repeat` deletados — antes todos
`undefined`, depois todos `function`, e `fetch` idem via `whatwg-fetch`.
`Element.closest` tem shim. O autoprefixer agora mira 38 de verdade.

## O que ainda impede

**Custom properties.** São ~1.600 usos de `var(--…)` no CSS e elas só existem a
partir do Chrome 49. O Chromium 38 descarta cada declaração que as usa, então o
app subiria praticamente sem estilo.

E não é só estático: `js/ui/theme/themeManager.js:191` **define custom properties em
runtime**, com `document.documentElement.style.setProperty(key, value)` sobre o
conjunto de cores inteiro (chaves dinâmicas), mais 24 nomes literais espalhados
pelo app (`--player-subtitle-font-size`, `--home-modern-portrait-poster-width`,
`--parental-*` etc.). No 38, `setProperty("--x", …)` é no-op.

## As três saídas, com o custo de cada uma

1. **Inlinar no build + regerar tema como folhas prontas.** `postcss-custom-properties`
   resolve o estático; o runtime exigiria trocar `setProperty` por gerar um
   `<style>` com regras concretas por tema. É reescrever a camada de tema para uma
   plataforma só.
2. **Polyfill de custom properties em runtime** (tipo `css-vars-ponyfill`): ele
   re-parseia as folhas e reavalia `var()` a cada mudança. Funciona em motores
   antigos, mas o custo recai justamente sobre o aparelho mais fraco — o CSS do app
   tem 23 mil linhas, e re-parsear isso a cada troca de tema num SoC de 2016 é o
   tipo de coisa que transforma "abre" em "abre e trava".
3. **Declarar webOS 3 fora de escopo** e manter o piso em 4.0.0, documentando o
   porquê para o próximo que perguntar.

Nenhuma das três é obviamente certa, e a 2 é a única testável rápido: dá para
medir no aparelho do voluntário antes de decidir. Não há aparelho webOS 3 no
projeto, então qualquer caminho depende de alguém do lado de fora.

## O que NÃO é problema (verificado)

- Serviço webOS: o build dele nunca lê `chromiumVersion` (usa
  `webOsServiceNodeVersion`, inalterado) e já é ES5 puro.
- Guardas que já existem e seguram no 38: `IntersectionObserver`, `ResizeObserver`,
  `AbortController`, `requestIdleCallback`, `TextEncoder/Decoder` — todos atrás de
  `typeof`.
- A branch `legacy-tv` (webOS 4.x) não foi afetada: `chromiumVersion` continua 53 lá.

## Não determinado

- Se webOS 3.4 roda o mesmo Node 0.12.2 do 4.x (o serviço é ES5, então um Node
  igual ou mais novo funciona; um 0.10 seria risco).
- Se o hls.js/MSE do app funciona no Chromium 38.

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
