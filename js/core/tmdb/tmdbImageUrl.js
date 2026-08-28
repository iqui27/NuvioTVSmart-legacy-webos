const TMDB_IMAGE_HOST_PATTERN = /^(?:https?:)?\/\/image\.tmdb\.org\//i;

/**
 * Leva a arte de fundo do TMDB para w1280, subindo o que vem pequeno demais
 * (w780 de metadado antigo/addon) e BAIXANDO o que vem grande demais.
 *
 * A parte de baixar existe porque `original` custa quase um segundo por troca de
 * hero nesta TV. Medido na OLED65C9: o backdrop chegava do addon em
 * `t/p/original`, 3840x2160 = 8,3 megapixels, para desenhar 1920x1062. Um trace
 * do Chromium durante a descida de 12 fileiras da Home mostrou
 * ImageDecodeTaskImpl somando 4373ms em 47 tarefas, com uma decodificacao unica
 * de 1125ms — e o hero troca de arte a cada movimento entre fileiras. Depois de
 * fixar w1280 (0,92MP): pior quadro caiu de 1290ms para 137ms e o travamento
 * total da descida de 6261ms para 2988ms.
 *
 * Antes disto a funcao SO subia w780, entao `original` passava intacto — que era
 * justamente o caso mais caro.
 *
 * URL que nao seja do TMDB volta byte a byte igual.
 */
export function normalizeTmdbBackdropUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized || !TMDB_IMAGE_HOST_PATTERN.test(normalized)) {
    return normalized;
  }
  return normalized.replace(/(\/t\/p\/)(original|w\d+)\//i, (todo, base, tamanho) => {
    if (/^original$/i.test(tamanho)) {
      return `${base}w1280/`;
    }
    const largura = Number(tamanho.slice(1));
    return Number.isFinite(largura) && largura < 1280 ? `${base}w1280/` : `${base}${tamanho}/`;
  });
}

/**
 * Sobe uma arte do TMDB para `original`, para uso em tela ESTATICA.
 *
 * Contraparte deliberada de normalizeTmdbBackdropUrl, que baixa tudo para w1280.
 * A diferenca entre as duas nao e a qualidade desejada, e QUANTAS VEZES a imagem
 * e decodificada: na Home o hero troca de arte a cada movimento entre fileiras,
 * e ali `original` custou 1125ms num unico decode. Na tela de detalhe a arte e
 * carregada uma vez e fica, dentro de uma abertura que ja leva ~2s.
 *
 * O motivo de precisar de `original`: o viewport do app e 1920x1080 mas o
 * devicePixelRatio nesta TV e 2, entao o painel desenha 3840x2160. Uma arte
 * w1280 esticada para 1920 CSS vira upscale de 3x em pixel fisico, que e o que
 * se ve como imagem "pixelada" num televisor 4K.
 *
 * URL que nao seja do TMDB volta byte a byte igual.
 */
export function tmdbArteParaTelaEstatica(value, tamanho = "original") {
  const normalized = String(value || "").trim();
  if (!normalized || !TMDB_IMAGE_HOST_PATTERN.test(normalized)) {
    return normalized;
  }
  return normalized.replace(/(\/t\/p\/)(original|w\d+)\//i, `$1${tamanho}/`);
}
