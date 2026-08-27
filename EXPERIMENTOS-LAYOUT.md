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
