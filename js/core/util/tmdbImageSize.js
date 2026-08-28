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

export function tmdbImageAtSize(url, size) {
  const bruto = String(url || "");
  if (!bruto || !size) {
    return bruto;
  }
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
