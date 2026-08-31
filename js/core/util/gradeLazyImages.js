/**
 * Hidrata as imagens de uma grade perto da viewport e devolve ao estado `data-src`
 * as que ficaram longe.
 *
 * POR QUE EXISTE: as grades do app nasciam com `src` preenchido e `loading="lazy"`,
 * e esse atributo e Chrome 76 — o Chromium 53 das TVs IGNORA. Toda imagem carregava
 * de imediato e ficava decodificada para sempre, sem teto e sem reciclagem. Medido
 * na OLED65C9: o "ver todos" chegava a 140 posteres decodificados (52,2 megapixels)
 * e o Discover a 223 (78,8 MP, ~315MB de bitmap em RGBA), ainda subindo. Num
 * aparelho de 2016 o sistema mata o app para recuperar memoria — o relato de dois
 * testadores em webOS 3.
 *
 * A conta usa o INDICE do card, nao a posicao medida de cada um: a grade e uniforme,
 * entao duas leituras de layout (largura da grade e altura de um card) bastam para
 * saber em que linha cada indice esta. Ler getBoundingClientRect de 200+ cards a
 * cada evento de rolagem custaria mais que o problema que isto resolve.
 *
 * A margem de liberacao e 2,5x a de hidratacao de proposito: sem essa folga o card
 * parado na borda entraria em ciclo hidrata/libera a cada quadro do D-pad.
 */
const FATOR_MARGEM_LIBERACAO = 2.5;
// Quantas telas acima e abaixo ficam hidratadas. Com 1 tela, subir depressa com o
// D-pad mostrava um piscar de posteres em branco (medido: 15 dos 18 visiveis num
// instante, voltando a zero em ~2s) porque o movimento passava da margem antes de
// a imagem chegar. 1,5 cobre a rolagem rapida e ainda deixa a memoria estavel.
const FATOR_MARGEM_HIDRATACAO = 1.5;

export function atualizarImagensDeGrade({
  shell,
  grade,
  seletorCard = ".seeall-card",
  seletorImagem = ".seeall-card-poster-image"
} = {}) {
  if (!shell || !grade) {
    return 0;
  }
  const imagens = grade.querySelectorAll(seletorImagem);
  if (!imagens.length) {
    return 0;
  }
  const primeiroCard = grade.querySelector(seletorCard);
  const alturaCard = primeiroCard ? primeiroCard.offsetHeight : 0;
  const larguraCard = primeiroCard ? primeiroCard.offsetWidth : 0;
  if (!alturaCard || !larguraCard) {
    return 0;
  }
  const colunas = Math.max(1, Math.round(grade.clientWidth / larguraCard));
  const alturaVisivel = shell.clientHeight || 0;
  const topo = Number(shell.scrollTop || 0);
  const margemHidratar = alturaVisivel * FATOR_MARGEM_HIDRATACAO;
  const margemLiberar = alturaVisivel * FATOR_MARGEM_LIBERACAO;
  const inicioHidratar = topo - margemHidratar;
  const fimHidratar = topo + alturaVisivel + margemHidratar;
  const inicioLiberar = topo - margemLiberar;
  const fimLiberar = topo + alturaVisivel + margemLiberar;
  let mexidas = 0;

  for (let i = 0; i < imagens.length; i += 1) {
    const imagem = imagens[i];
    const linha = Math.floor(i / colunas);
    const y = linha * alturaCard;
    const guardada = String(imagem.dataset.lazySrc || "").trim();
    const pendente = String(imagem.dataset.src || "").trim();
    if (y + alturaCard >= inicioHidratar && y <= fimHidratar) {
      if (pendente && !imagem.getAttribute("src")) {
        imagem.setAttribute("src", pendente);
        imagem.dataset.lazySrc = pendente;
        imagem.removeAttribute("data-src");
        mexidas += 1;
      }
      continue;
    }
    if (y + alturaCard < inicioLiberar || y > fimLiberar) {
      // `removeAttribute` e obrigatorio: `src = ""` faz o Chromium 53 pedir a
      // propria URL do documento e enfileirar um erro de rede por imagem.
      if (guardada && imagem.getAttribute("src")) {
        imagem.removeAttribute("src");
        imagem.setAttribute("data-src", guardada);
        mexidas += 1;
      }
    }
  }
  return mexidas;
}
