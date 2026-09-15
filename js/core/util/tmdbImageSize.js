/**
 * Reescreve o segmento de tamanho de uma URL de imagem do TMDB.
 *
 * Por que isto existe: os posteres e logos que aparecem na Home e no ver-todos
 * vem dos ADDONS, nao do nosso tmdbMetadataService, e chegam em `w500` ou
 * `original` — o tamanho que o addon escolheu, nao o que a tela usa. Medido na
 * OLED65C9 na Home: 42,7 megapixels decodificados para exibir 8,7 (4,9x de
 * desperdicio), com 91 imagens acima do dobro da largura necessaria. O caso
 * extremo era o logo do hero, que baixava 2394x425 para desenhar 440x160.
 *
 * Decodificar imagem e trabalho do compositor, nao do nosso JS: um perfil de CPU
 * durante a navegacao mostrou 85% ocioso e o custo concentrado em `(program)`,
 * com o nosso script somando ~2%. Ou seja, cortar pixel na origem e a alavanca
 * que sobra.
 *
 * Sem efeito sobre URL que nao seja do TMDB — o padrao exige o host e o
 * caminho /t/p/<tamanho>/, entao qualquer outra coisa volta intacta.
 */
const PADRAO_TMDB = /^(https?:\/\/image\.tmdb\.org\/t\/p\/)([A-Za-z0-9]+)(\/.+)$/;

/*
 * DEGRAU DO PLANO DE 720 (issue #1, webOS 3).
 *
 * Os tamanhos pedidos pelas telas foram medidos na OLED65C9, onde o plano
 * grafico e 1920x1080. A variante webOS 3 desenha num plano de 1280x720 -- o
 * package-webos declara `resolution: "1280x720"` para Chromium < 49 e o CSS e
 * reemitido com os px escalados por 2/3 (LEGACY_SCALE). O mesmo cartao que
 * ocupa 221x339 na C9 ocupa ~147x226 la: 44% dos pixels.
 *
 * Isso importa mais nesse aparelho do que na C9 por um motivo especifico:
 * `HTMLImageElement.decode()` e Chromium 64+ e a webOS 3 e Chromium 38, entao a
 * metade do commitHomeLazyImageSources que tira o decode do quadro da tecla e
 * INERTE la. Sobra a fila de 2 por quadro -- e cortar pixel na origem, que e
 * isto aqui.
 *
 * Um degrau, nao um calculo: o tamanho pedido cai para o anterior da escada do
 * TMDB. Conferindo a cobertura contra a largura REALMENTE desenhada no plano de
 * 720, que e o que decide se a imagem fica borrada:
 *
 *   poster paisagem     desenha ~293px   w500  = 1,71x
 *   logo do hero        desenha ~293px   w342  = 1,17x
 *   backdrop do hero    desenha ~853px   w780  = 0,91x
 *
 * O backdrop e o unico abaixo de 1x, e de proposito: ele ja e desenhado
 * esticado e desfocado atras do texto, e w1280 num plano de 720 sao 2,7 milhoes
 * de pixels decodificados para uma imagem que ninguem olha de perto.
 *
 * NAO USA w300: e tamanho de backdrop no TMDB, nao de poster, e pedir um
 * tamanho fora da lista do endpoint devolve 404. E por isso que nao existe
 * degrau intermediario para o poster -- de w342 so se desce para w185.
 *
 * O DEGRAU DO POSTER DE CATALOGO (w342 -> w185) EXISTIU E FOI REVERTIDO.
 * Medido na TV do Mane155 (webOS 3.4.3): a tela de perfil ate os posteres caiu
 * de 15 s para 10 s com ele, mas ele respondeu "a qualidade fica um pouco
 * borrada". Os dois fatos convivem porque nao sao a mesma imagem: o caminho do
 * primeiro paint e o backdrop do hero e a arte da tela estatica -- um unico
 * decode de 8,3 megapixels que virou 0,92 --, enquanto o poster de catalogo
 * hidrata DEPOIS, fora do numero que ele mediu. Ou seja, o degrau do poster
 * provavelmente nao pagou nada dos 5 s e era o unico que dava para VER.
 * Desceu de 2,33x para 1,26x de cobertura, e 1,26x num painel Full HD
 * escalando a partir de um plano de 720 e pouco.
 * Se o proximo relato disser que os 10 s viraram 15 de novo, o degrau volta e
 * a conclusao acima e que estava errada.
 */
const DEGRAU_PLANO_REDUZIDO = {
  w1280: "w780",
  w780: "w500",
  w500: "w342"
};

// Abaixo disto o plano e pequeno o bastante para valer o degrau. 2/3 = 0,667.
const LIMIAR_PLANO_REDUZIDO = 0.8;

let fatorDoPlanoMemo = null;

/**
 * Quanto do tamanho declarado no CSS de 1920 sobra na tela, de 0 a 1.
 *
 * Duas reducoes possiveis e elas se multiplicam, porque em tese podem coexistir:
 * a folha de 720 (`sufixo`, escala de build em `fatorCss`) e o transform de
 * ultimo recurso do index.html (`escala`), que so entra quando o aparelho ignora
 * o `resolution` do appinfo. No build de webOS 4 o objeto nem existe, entao o
 * fator e 1 e nada aqui muda -- os tamanhos da C9 continuam intactos.
 */
export function fatorDoPlano() {
  if (fatorDoPlanoMemo !== null) {
    return fatorDoPlanoMemo;
  }
  const plano = globalThis.__NUVIO_UI_PLANE__;
  if (!plano || typeof plano !== "object") {
    fatorDoPlanoMemo = 1;
    return 1;
  }
  const css = Number(plano.fatorCss);
  const transform = Number(plano.escala);
  const fator =
    (Number.isFinite(css) && css > 0 ? css : 1) *
    (Number.isFinite(transform) && transform > 0 ? transform : 1);
  fatorDoPlanoMemo = fator > 0 && fator <= 1 ? fator : 1;
  return fatorDoPlanoMemo;
}

/** So para teste: o fator e lido uma vez e memoizado. */
export function redefinirFatorDoPlanoParaTeste() {
  fatorDoPlanoMemo = null;
}

function tamanhoParaEstePlano(size) {
  if (fatorDoPlano() > LIMIAR_PLANO_REDUZIDO) {
    return size;
  }
  return DEGRAU_PLANO_REDUZIDO[size] || size;
}

export function tmdbImageAtSize(url, sizePedido) {
  const bruto = String(url || "");
  if (!bruto || !sizePedido) {
    return bruto;
  }
  const size = tamanhoParaEstePlano(sizePedido);
  const partes = PADRAO_TMDB.exec(bruto);
  if (!partes) {
    return bruto;
  }
  // Nao aumenta: se o addon ja mandou algo menor que o pedido, respeita.
  const atual = partes[2];
  if (atual !== "original" && /^w(\d+)$/.test(atual) && /^w(\d+)$/.test(size)) {
    const larguraAtual = Number(atual.slice(1));
    const larguraPedida = Number(size.slice(1));
    if (larguraAtual <= larguraPedida) {
      return bruto;
    }
  }
  return `${partes[1]}${size}${partes[3]}`;
}
