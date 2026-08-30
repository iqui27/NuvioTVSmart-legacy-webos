/**
 * Descobre, lendo os primeiros KB do arquivo, se um MP4 declara Dolby Vision no
 * sample entry — o unico sinal que separa o que toca do que nao toca nesta TV.
 *
 * POR QUE ISTO EXISTE, medido na OLED65C9 (webOS 4.10) com dois arquivos do
 * mesmo tipo de conteudo:
 *
 *   arquivo A  sample entry `dvhe`  -> MEDIA_ERR_DECODE (codigo 3)
 *   arquivo B  sample entry `hev1`  -> toca, e o usuario confirmou que engata
 *                                      Dolby Vision de verdade na TV
 *
 * Os dois sao HEVC Main 10, dv_profile 5, bl_signal_compatibility_id 0, ambos
 * 4K com bitrate parecido. A unica diferenca e o fourcc do sample entry. Ou
 * seja, a etiqueta "correta" para DV e justamente a que o pipeline HTML5 recusa,
 * enquanto a etiqueta generica passa e ainda ativa DV.
 *
 * DUAS COISAS QUE NAO SERVEM PARA ISTO, ambas verificadas:
 * 1. `canPlayType` responde "probably" para TUDO, inclusive
 *    'video/mp4; codecs="dvhe.05.06"', que e exatamente o caso que falha. Usar a
 *    resposta do navegador como filtro daria uma lista sem nenhum aviso.
 * 2. O nome do release nao separa os dois: os dois arquivos medidos trazem
 *    "DoVi"/"DV.P5" no nome. O bonus de DV que o ranking ja da por nome nao tem
 *    como distinguir quem toca de quem quebra.
 *
 * LIMITE HONESTO: so ha resposta quando o indice (`moov`) esta no inicio do
 * arquivo. No arquivo B ele esta no fim, entao 128KB de leitura nao revelaram
 * nada — e esse justamente tocou. Por isso o retorno tem tres estados e o
 * "desconhecido" NUNCA bloqueia nada: sem evidencia, nao se afirma.
 */

const BYTES_DE_LEITURA = 4096;
const TIMEOUT_MS = 2500;

export const DOLBY_VISION_INCOMPATIVEL = "dolby-vision-sample-entry";
export const DOLBY_VISION_COMPATIVEL = "compativel";
export const DOLBY_VISION_DESCONHECIDO = "desconhecido";

function pareceMp4(url) {
  const limpa = String(url || "")
    .split("?")[0]
    .toLowerCase();
  return /\.(mp4|m4v|mov)$/.test(limpa) || limpa.indexOf("/playback/") >= 0;
}

/**
 * Le os primeiros bytes e procura o fourcc no texto cru. Comparar bytes seria
 * mais elegante, mas o sample entry aparece como ASCII dentro do `stsd` e a
 * busca em texto e o que roda igual em qualquer engine que este app suporta.
 */
export function detectarEntradaDolbyVision(url) {
  const alvo = String(url || "").trim();
  if (!alvo || !pareceMp4(alvo)) {
    return Promise.resolve(DOLBY_VISION_DESCONHECIDO);
  }
  return new Promise((resolve) => {
    let encerrado = false;
    const encerrar = (valor) => {
      if (!encerrado) {
        encerrado = true;
        resolve(valor);
      }
    };
    const relogio = setTimeout(() => encerrar(DOLBY_VISION_DESCONHECIDO), TIMEOUT_MS);
    let pedido;
    try {
      pedido = new XMLHttpRequest();
      pedido.open("GET", alvo, true);
      pedido.setRequestHeader("Range", `bytes=0-${BYTES_DE_LEITURA - 1}`);
    } catch (_) {
      clearTimeout(relogio);
      encerrar(DOLBY_VISION_DESCONHECIDO);
      return;
    }
    pedido.onload = () => {
      clearTimeout(relogio);
      const inicio = String(pedido.responseText || "");
      // `moov` ausente = indice no fim do arquivo: nao da para afirmar nada.
      if (inicio.indexOf("moov") < 0) {
        encerrar(DOLBY_VISION_DESCONHECIDO);
        return;
      }
      if (inicio.indexOf("dvhe") >= 0 || inicio.indexOf("dvh1") >= 0) {
        encerrar(DOLBY_VISION_INCOMPATIVEL);
        return;
      }
      encerrar(DOLBY_VISION_COMPATIVEL);
    };
    pedido.onerror = () => {
      clearTimeout(relogio);
      encerrar(DOLBY_VISION_DESCONHECIDO);
    };
    try {
      pedido.send(null);
    } catch (_) {
      clearTimeout(relogio);
      encerrar(DOLBY_VISION_DESCONHECIDO);
    }
  });
}
