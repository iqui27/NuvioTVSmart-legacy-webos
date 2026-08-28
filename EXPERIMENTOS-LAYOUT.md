# Experimentos de layout — branch `exp-layout`

Exploração dirigida: como outras plataformas de TV resolvem layout/funcionalidade,
onde este app está atrás, e o que já foi prototipado. Tudo que tem número foi medido
na bancada (`npm run serve`, 1920×1080, `getBoundingClientRect`); o que não pôde ser
verificado está marcado como tal.

## 0. A descoberta que muda o resto: a bancada não renderizava o CSS da TV

A premissa da bancada era "o que você vê no navegador é o que a TV renderiza".
**Ela era falsa para uma fatia grande do CSS.** O `legacy-features.js` fixava as
cinco classes `no-*`, mas na TV o `app.js` também liga `legacy-webos` e
`performance-constrained` — e o `components.css` tem **166 regras** sob
`.legacy-webos` e **100** sob `.performance-constrained` (geometria do hero,
budgets de animação, tamanhos de fonte, player). Nada disso aparecia no navegador.

Prova medida: o logo do hero da home media `top:-40px` na bancada (estado que a TV
nunca exibiu) e `top:0` com as regras que a TV realmente usa. Ou seja: quem afinasse
o hero na bancada estaria afinando um layout inexistente.

**Prototipado (commit `144e3b3`):** o pin agora inclui as duas classes e o
`applyPerformanceMode` honra o pin quando `Platform.isBrowser()`. Na TV nada muda
(o ramo não dispara); `?modernFeatures=1` continua limpo para comparação.
Recomendo aceitar este commit antes de qualquer outro trabalho de layout — sem ele,
as medições da bancada não valem.

## 1. Referências: como as plataformas resolvem

Fontes: tvOS HIG (10-foot UI), diretrizes de design da LG para webOS, e observação
dos apps Netflix/Disney+/Prime Video/Jellyfin/Stremio em TV. Estes princípios são
consenso da indústria; não medi os apps de terceiros nesta sessão.

- **Zona segura (overscan).** Título/texto dentro de ~5% de margem (96px horizontais,
  54px verticais a 1080p). Netflix usa gutter esquerdo generoso e constante em todas
  as telas; nada textual encosta na borda. Nosso `--home-content-start` de 104px está
  correto — o problema era o hero legado violar o topo (corrigido, ver §3.1).
- **Hierarquia da home.** Hero grande com 1 fileira visível + 1 espiando (Netflix
  pós-2020, Disney+) ou hero menor com 2–3 fileiras (Prime). A nossa proporção
  (hero ~48%, fileiras 52%) está dentro do padrão moderno. Densidade de fileira:
  6–7 pôsteres 2:3 visíveis a 1080p; temos 6–7 com pôster de 212px — ok.
- **Tipografia 10-foot.** Corpo mínimo ~18–22px a 1080p, meta ~20–24px, títulos de
  fileira 24–32px. Nosso título de fileira computa 26px e a sinopse 22px — dentro
  da faixa. Texto com menos contraste que ~4.5:1 sobre imagem pede scrim.
- **Foco.** Regra de ouro: um único foco inequívoco, escala + borda + sombra, sem
  depender só de cor. O nosso anel branco com elevação nos cards segue o padrão.
  `:focus-visible` não existe no Chromium 53 — o app já usa classe `.focused`
  própria, que é o fallback certo.
- **Sinopses.** Todas as plataformas cortam em linhas inteiras com reticências
  (2–3 linhas no hero). Cortar glifo no meio é o erro clássico de app de TV barato —
  e era exatamente o que acontecia aqui (§3.1).
- **Tela de detalhe.** Ações primárias primeiro foco, meta em uma linha, sinopse
  clampada, abas (episódios/relacionados) abaixo da dobra. O nosso detalhe segue
  essa estrutura.
- **Seleção de fontes.** Stremio agrupa por addon com badges técnicos (qualidade,
  codec, tamanho) — o nosso stream screen já faz isso bem (badges MP4/4K/DD+ etc.,
  756px de margem útil, foco claro). Não mexer.
- **Player.** Overlays em três camadas (scrim topo/base + controles), tudo dentro
  da zona segura, auto-hide 3–5s. Não consegui verificar o player na bancada sem
  consumir stream do backend — ver §5.

## 2. O que já está bom (não mexer)

- **Stream/fontes:** hierarquia, badges e foco estão no nível do Stremio.
- **Densidade e pitch das fileiras da home** (pitch ~334px, pôster 212px): padrão.
- **Continue assistindo:** card largo com progresso e "Xm restantes" — igual Netflix.
- **Settings:** estrutura mestre-detalhe correta, foco visível.
- **Busca:** grade e fluxo ok (ver item de gutter em §4).

## 3. Prototipado nesta branch (cada um em commit independente)

### 3.1 `ae57b9e` — hero legado: zona segura + fim da guilhotina de texto

Estado real da TV, medido com o bench fiel:

- logo em `top:0` (colado na borda; o motor moderno usa 40px);
- meta de 560px quebrava em 2–3 linhas (bloco de 119px);
- sinopse estourava a caixa de copy em 72px e o `overflow:hidden` cortava o texto
  **no meio da linha**, escondido sob o título "Continuar assistindo".

Mudanças: top-safe de 40px restaurado; logo 200→160px; meta/sinopse alargados para
640px (uma linha); e `applyModernHeroDescriptionBounds` passa a limitar o orçamento
de linhas ao espaço restante **dentro** da caixa (linhas inteiras), em vez do teto
fixo de 4 linhas que não cabia (113px livres vs 119px necessários).

Depois: logo em y=65 (≥40), meta 1 linha, sinopse 3 linhas inteiras com reticências,
fundo do texto == fundo da caixa (500==500). A mudança de JS beneficia qualquer
título: o orçamento é recalculado por conteúdo.

### 3.2 `97c3711` — biblioteca: "Nenhum all ainda"

A aba "Todos" interpolava o literal inglês `"all"` na string traduzida
(`library_empty_local_title`). Agora usa `cloud_library_empty_title`
("Nada por aqui ainda"), já traduzida em todos os idiomas. Verificado na bancada.

### 3.3 `6e50d03` — busca: gutter alinhado ao resto do app

Cabeçalho, títulos de seção e trilhas de resultado da busca começavam em x=48
enquanto home/detalhe usam 104 (`--home-content-start`). Medido: primeiro card em
x=48 antes, x=104 depois. Valores estáticos, sem risco no Chromium 53.

### 3.4 `144e3b3` — fidelidade da bancada (ver §0)

## 4. Backlog priorizado (valor/esforço) — ainda não prototipado

1. **Contraste da meta na tela de detalhe.** Ano/nota renderizam em
   `rgb(179,179,179)` ~21px por cima do backdrop sem scrim (medido no canto
   inferior direito, `[1685,889]`). Proposta: scrim local ou token mais claro.
   Custo: baixo. Risco: nenhum.
2. **Rótulos truncados no menu de Ajustes** ("Conteúdo e de..."). Proposta: coluna
   um pouco mais larga ou duas linhas. Custo: baixo. Risco: nenhum. Antes de mexer,
   medir com o bench fiel (a coluna é afetada por regras `performance-constrained`).
3. **Imagens vivas na home.** 539 `<img>` e ~2.081 nós de DOM com 25 fileiras
   montadas. Em Chrome desktop é nada; numa LG 2018 é memória de GPU e decodificação.
   Vale investigar se as fileiras fora da viewport mantêm `src` e, se sim, liberar
   (`src=""` fora de alcance, repor ao aproximar). Custo: médio. Risco: médio
   (regressão de navegação/flicker) — só com medição no aparelho.
4. **Padronizar o corte de texto em linhas inteiras fora do hero.** O mesmo padrão
   de guilhotina pode existir em outros clamps (há 60 usos de `-webkit-line-clamp`
   com alturas fixas). Auditar os que convivem com `max-height` fixo. Custo: médio.

## 5. O que não pôde ser verificado na bancada

- **Player e overlay de pausa:** exigem stream real (cota do backend). O CSS do
  overlay legado (`.legacy-webos .player-controls-overlay`, padding 48px) parece
  são, mas margem de segurança de pausa deve ser re-verificada **no aparelho** —
  agora a bancada ao menos renderia as mesmas regras.
- **Teclado da busca:** a bancada usa teclado físico; o IME do webOS só existe na TV.
- **Performance real** (fps de navegação, memória): só no aparelho.

## 6. Layout vs. funcionalidade nova

**Melhorias de layout** (decisão barata, reversível): tudo em §3 e itens 1–2, 4 do §4.

**Funcionalidade nova** (decisão de produto):

- Botão/CTA focável no estado vazio da biblioteca ("Buscar títulos") em vez de só texto.
- Teclado on-screen próprio na busca (Jellyfin/Stremio fazem isso para não depender
  do IME da plataforma) — custo alto, só se o IME da LG estiver incomodando.
- Virtualização/descarte de imagens da home (item 3 do §4) — é engenharia de
  performance, não layout.

## 7. Como reproduzir as medições

```
npm run serve   # http://127.0.0.1:4173/  (bench legado fiel, após 144e3b3)
                # ?modernFeatures=1 para o motor moderno
```

Janela a 1920×1080; medir com `getBoundingClientRect` (os tokens são estáticos na
TV — fora dessa largura o `clamp()` do navegador mente).

## 8. Composição de conteúdo da home (2026-08-27)

O pedido real do dono: "separar por streaming, gênero, lista curadoria (...)
melhorar como mostrar os filmes, do que só um monte de pôster solto com várias
fileiras iguais". Ou seja: composição e identidade das fileiras, não espaçamento.

### 8.1 Inventário medido do addon Xperience (manifesto real, 229KB)

605 catálogos declarados; a home dele usa 43 fileiras (17 do Xperience + 22
coleções + 4 do Cinemeta). Por bucket do identificador:

| bucket                                      | catálogos |          usados na home | observação                                                                                                                                           |
| ------------------------------------------- | --------: | ----------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| genre                                       |       111 |      2 (action, horror) | 25 gêneros distintos                                                                                                                                 |
| recs/ai                                     |        64 |                       4 | "For You"                                                                                                                                            |
| streaming                                   |        60 |          2 (só Netflix) | **16 serviços**: netflix, prime, disney, hbo, apple, hulu, paramount, peacock, crunchyroll, mgm, shudder, britbox, discovery, itvx, channel4, hidive |
| world                                       |        60 |                       0 | 10 idiomas (ja, ko, pt, fr...)                                                                                                                       |
| studio                                      |        51 |                       0 | 14 estúdios (a24, ghibli, pixar, marvel...)                                                                                                          |
| decade                                      |        32 |                       0 | anos 50→2020s                                                                                                                                        |
| snoak                                       |        28 | 2 (top100 movie/series) | curadoria                                                                                                                                            |
| collection (do addon)                       |        25 |                       0 | ≠ das coleções do app                                                                                                                                |
| actor / franchise / network                 |  21/20/18 |                       0 |                                                                                                                                                      |
| themed                                      |        15 |            1 (mindfuck) | time_loop, heists, zombies, whodunnit...                                                                                                             |
| anime / awards / director / tv              |   12 cada |                       0 |                                                                                                                                                      |
| trending/now/on_the_air/new                 |        11 |                       4 |                                                                                                                                                      |
| trakt                                       |         6 |         2 (anticipated) |                                                                                                                                                      |
| kids 7, fp 6, uk 5, runtime 4, kb 3, outros |       ~40 |                       0 |                                                                                                                                                      |

### 8.2 O mecanismo — e onde está o ganho de configuração

**Os 43 não são escolha dentro do app; são exatamente o que o addon expõe como
"home".** O app só aceita na home catálogo sem extra obrigatório
(`catalogRequiresExtras`, js/core/addons/homeCatalogs.js). No manifesto real,
só 17 catálogos vêm com `genre.isRequired=false` — precisamente os 17 que ele
usa. Os outros 586 vêm com `genre` obrigatório (opção "None" disponível) e por
isso ficam confinados à busca/discover.

Quem decide quais catálogos viram "home" é o **configurador do Xperience**
(xperience-app.com, mesma conta que gerou a URL com JWT). Ganho grande, custo
zero de código: ele entra lá, liga os catálogos de streaming/gênero/curadoria
que quer (Prime, Disney, HBO, comédia, sci-fi, awards...), reinstala/atualiza o
addon e o app adota as fileiras novas sozinho (`ensureOrderKeys` anexa chaves
novas à ordem). `disabled` dele está vazio — não há nada para "reativar" no app.

Alternativa por código (não implementada): tratar catálogo com `genre`
obrigatório que aceite "None" como elegível, buscando com `genre=None`. Viável,
mas despeja 586 candidatos na lista de ajustes e na ordem persistida; exigiria
default-disabled e UI de opt-in. Só vale se o configurador não atender.

### 8.3 Identidade visual por tipo de fileira — implementado (`c4cd6b7`)

A taxonomia já está no id do catálogo, então cada fileira agora ganha:

- `data-row-kind` (foryou/trending/streaming/genre/curated/themed/collection),
  derivado em js/ui/screens/home/homeRowKind.js; buckets validados contra o
  manifesto (todos os 33 prefixos cobertos).
- **Eyebrow** ao lado do título com cor por tipo ("Top 100 Today · CURADORIA"
  dourado, "Netflix - Filme · STREAMING" azul). foryou/trending ficam sem — o
  título já diz o que são.
- **Numeração de posição** nas fileiras de chart (snoak_top100, cinemeta
  imdbRating) via CSS counters — badge 30×30 no canto do pôster, **zero nós de
  DOM extras**.

Medido na bancada (1920×1080, home real de perfil sincronizado, 24 fileiras):
eyebrow em 16 fileiras; head com e sem eyebrow tem a mesma altura (31.2px,
`.home-row-head` é flex row) → travessia vertical do D-pad inalterada; nós DOM
2081→2097 (+1 div/eyebrow); `<img>` inalteradas. Reconciliação por chave e paint
progressivo preservados (markup derivado só de rowData, byte-idêntico entre
render completo e reconcile).

### 8.4 Proposta de composição por seções (decisão de produto, não codificada)

Agrupar por kind reordenaria a ordem que ele mesmo salvou — não fiz isso por
código. A proposta, se ele quiser, é só reordenar em Ajustes → fileiras (ou eu
reordeno o `order` com backup):

1. Continuar assistindo / Em breve
2. Para você (recs + ai, 4 fileiras)
3. Em alta (trending, in theaters, on the air)
4. Curadoria (Top 100 numerado, Trakt Anticipated; + awards se ativar no addon)
5. Streaming (Netflix hoje; um bloco por serviço que ele assina, via addon)
6. Gêneros (action, horror; + os que ativar)
7. Coleções (23 fileiras — mais da metade da home; vale rebatizar as sem nome
   legível via título custom, que o app já suporta, `customTitles`)
8. Temáticos (mindfuck etc.)

Cabeçalhos de seção interstitiais (não-focáveis) são viáveis sem armadilha de
foco — são só rótulos —, mas adicionam altura de travessia; com o eyebrow por
fileira o ganho marginal é pequeno. Recomendo esperar a reação dele ao eyebrow.

### 8.5 Não verificado / ressalvas

- Nada foi instalado na TV nesta sessão; a leitura da TV foi só diagnóstico
  (CDP): 43 fileiras, layout modern, 421 img / 2880 nós no momento da leitura.
  `homeCatalogPrefs` dele foi salvo em backup e **não** foi alterado.
- O layout clássico recebeu o mesmo eyebrow por paridade de código, mas só o
  modern foi verificado visualmente na bancada.
- Cores do eyebrow em painel de TV real (gama/contraste) não conferidas.

## 9. A porta de saída da fileira (2026-08-27, tarde)

Pedido do dono: _"cada fileira mostrar alguns com o botão de abrir a lista
toda, porque aí teríamos como categorizar, mostrar a lista com diferentes
estilos de formato não só pôster, e diminuir o quanto é carregado na home."_

### 9.1 Duas premissas caíram na medição

**"Reduzir os itens por fileira"** — já estava feito.
`HOME_MAX_ITEMS_PER_ROW_LEGACY_TV = 8`. Não mexi nesse número.

**"O card See All não aparece porque `items.length > maxItems` é `8 > 8`"** —
o diagnóstico estava na função errada. Aquela linha (homeScreen.js ~2831) é do
caminho `classic`/`grid`, que a TV **não usa**. No layout `modern`, que é o da
TV, `renderModernRowSection` recebia `createSeeAllCardMarkup` como
`_createSeeAllCardMarkup` e **nunca o chamava**: o card não existia em lugar
nenhum do markup moderno. Corrigir só a comparação não teria mudado nada.

### 9.2 Como se sabe que "há mais" (suposição documentada)

Não há total. `catalogRepository` só reporta
`hasMore = supportsSkip && items.length > 0` — isto é, "o addon aceita `skip=` e
esta página não veio vazia". Nenhum manifesto no formato Stremio entrega um
total.

Critério adotado em `rowHasSeeAllDoor()` (modernHomeLayout.js), e reusado
também pelo caminho clássico para não haver dois critérios:

> **página cheia (`items.length >= maxItems`) = provavelmente há mais.**

Fileira curta (5 de 5 itens) **não** ganha porta: abrir uma "lista completa"
idêntica à fileira seria mentira. Custo de errar: um card a mais levando a uma
tela com os mesmos 8 itens. Nunca um destino errado, nunca um crash.

### 9.3 A fileira com porta virou prateleira fixa

Medido **antes** de travar: com a porta no fim do trilho, apertar Direita além
dela fazia a paginação horizontal anexar um 10º pôster **depois** da porta —
ela migrava para a coluna 9, 10, ... e deixava de ser "o fim da fileira".
Sequência medida de navCol: `1,2,3,4,5,6,7,8*,9` (`*` = porta).

Então `runPagination` agora sai cedo em fileira que tem porta. A porta **é** a
paginação; a lista inteira vive atrás dela, onde `catalogSeeAllScreen` já pagina
com `skip=`. É também a parte que de fato reduz o que a home carrega.
Depois da trava: `1,2,3,4,5,6,7,8*,8*,8*,8*`.

### 9.4 Medições (bancada 1920×1080, home carregada, 24 fileiras)

|                  | antes   | depois                              |
| ---------------- | ------- | ----------------------------------- |
| cards            | 220     | 237 (+17 portas)                    |
| `<img>`          | 540     | **540** (a porta não tem imagem)    |
| portas           | 0       | 17 (as 7 sem porta são as coleções) |
| tamanho da porta | 229×132 | 229×347 (= pôster)                  |

D-pad: colunas 0..8 contíguas, mesmo `data-nav-row`; Enter abre `catalogSeeAll`;
Voltar retorna à Home **com o foco de volta na porta** (col 8).

Armadilha resolvida no reconciliador: `focusedItemIndex` é lido do `navCol` do
nó focado para que um card anexado pela paginação sobreviva ao re-render. A
porta fica em `navCol === visibleItems.length`, então ler o índice dela pediria
à fileira **um pôster a mais** do que ela tem → markup diferente → nó
substituído → foco perdido. `reconcileHomeCatalogRows` agora ignora o índice
quando o foco está na porta.

### 9.5 A tela de destino: quase não mexer

Medi antes de propor. `catalogSeeAll` **já** é uma grade densa de pôsteres (6
colunas de 291×442 a 1920×1080), **já** tem fallback `no-css-grid` gerado pelo
build para o Chromium 53, **já** pagina e **já** tem foco inicial previsível.
Reconstruí-la em três layouts por tipo (grade para gênero, lista numerada com
sinopse para chart, agrupamento por serviço para streaming) seria muito layout
e muito modelo de foco novos para um ganho especulativo. **Recomendação: não
reconstruir** até haver reação do dono ao que existe.

O que mudou é só o que a fileira já tinha dito ao usuário e o destino jogava
fora, tudo derivado de `getHomeRowKind` a partir do `addonId`/`catalogId` que o
descriptor já carrega (zero plumbing novo, impossível discordar do eyebrow):

- eyebrow de categoria no cabeçalho (`data-catalog-kind`);
- numeração de posição em catálogo de ranking, via contador CSS;
- **gutter 48px → 104px**: o primeiro card estava em x=48 enquanto todo pôster
  da Home começa em 104. Mesmo bug já corrigido na busca em `a195662`.

### 9.6 Paginar no destino: já existe, e é sã no D-pad

`shouldAutoLoadMore(index)` dispara quando o card focado está a ≤10 do fim da
lista — isto é, **guiado pelo foco, não pelo scroll**. É exatamente o que a
tarefa 3 pedia, e já estava implementado. Nada a fazer.

### 9.7 Não verificado / suspeitas

- **Nada foi instalado na TV nesta sessão.** Tudo aqui é bancada 1920×1080 com
  `legacy-webos`/`performance-constrained`. `homeCatalogPrefs` não foi tocado.
- **Suspeita não confirmada, não corrigida:** `catalogSeeAllScreen` avança
  `this.nextSkip = skip + 100` e inicializa `nextSkip = items.length ? 100 : 0`,
  ambos assumindo página de 100. O catálogo "IMDb Top 250" devolveu 50 itens na
  bancada. Se o tamanho de página do addon for menor que 100, a segunda página
  **pula** os itens do meio. A paginação da home faz o certo
  (`nextSkip = skip + incomingItems.length`). Não corrigi porque não medi o
  tamanho de página real de cada addon, e chutar aqui troca um bug por outro.
- Catálogo de ranking (`snoak_top100`) não apareceu nesta sessão da bancada; a
  numeração do destino foi verificada forçando `data-catalog-ranked` (caixa do
  `::after` 30×30 absolute). **Cuidado:** `getComputedStyle(...).content`
  devolve a string `counter(seeall-rank)` mesmo funcionando — não é sinal de
  quebra.
- Cores do eyebrow do destino em painel de TV real não conferidas.
- A fileira que perde a paginação horizontal perde também a navegação lateral
  além de 8 itens. É a troca pedida pelo dono, mas é uma **remoção de
  funcionalidade** — se ele não gostar, o ponto exato de reversão é o
  early-return de `rowHasSeeAllDoor` dentro de `runPagination`.
