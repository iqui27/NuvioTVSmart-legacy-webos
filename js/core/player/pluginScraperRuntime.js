/**
 * Executa os scrapers de um repositorio de plugins.
 *
 * O que e um repositorio: uma URL de manifest.json que lista `scrapers`, cada um
 * com um `filename` apontando para um arquivo JavaScript no mesmo repositorio.
 * Esse arquivo define `getStreams(tmdbId, mediaType, season, episode)` e devolve
 * uma lista de streams. E o mesmo formato que o app de desktop/Android usa, e os
 * repositorios ja chegam nesta TV pela conta (pluginSyncService).
 *
 * Medido na OLED65C9 (webOS 4.10, Chromium 53) antes de escrever isto:
 * - `new Function` e `eval` funcionam (nao ha CSP bloqueando);
 * - baixar de raw.githubusercontent responde 200 com CORS liberado;
 * - um scraper real de 32KB COMPILA no Chromium 53;
 * - executado de forma isolada, devolveu um stream 1080p em 2,4s.
 *
 * DECISAO DE SEGURANCA, que e o ponto mais importante deste arquivo: isto executa
 * codigo de terceiros, que muda quando o autor do repositorio quiser. Duas
 * defesas deliberadas:
 * 1. O scraper roda dentro de uma funcao cujo escopo lexical NAO inclui os
 *    modulos do app; ele recebe um ambiente explicito (fetch, console, URL,
 *    TextDecoder, temporizadores). Nao e sandbox de verdade — `globalThis` ainda
 *    e alcancavel em runtime — mas evita o acesso casual e deixa a superficie
 *    declarada num lugar so.
 * 2. Nada roda sem o usuario ligar (PluginManager.pluginsEnabled) E ter um
 *    repositorio instalado. O padrao e desligado.
 *
 * Um scraper malicioso ainda poderia ler localStorage. Isso esta dito na tela de
 * Ajustes, e nao no codigo apenas — quem liga precisa saber o que esta ligando.
 */

const CACHE_MANIFESTO_MS = 6 * 60 * 60 * 1000;
const CACHE_SCRAPER_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_REDE_MS = 15000;
const TIMEOUT_SCRAPER_MS = 20000;
const MAX_BYTES_SCRAPER = 2 * 1024 * 1024;

const manifestoCache = new Map();
const scraperCache = new Map();

function agora() {
  return Date.now();
}

function comTimeout(promessa, ms, mensagem) {
  let id = 0;
  const limite = new Promise((_, reject) => {
    id = setTimeout(() => reject(new Error(mensagem)), ms);
  });
  return Promise.race([promessa, limite]).then(
    (valor) => {
      clearTimeout(id);
      return valor;
    },
    (erro) => {
      clearTimeout(id);
      throw erro;
    }
  );
}

/**
 * XHR e nao fetch: o app roda de file:// em engines antigas e o XHR e o caminho
 * que ja se sabe funcionar la (o probe de rede do player usa o mesmo).
 */
function baixarTexto(url, maxBytes = 0) {
  return comTimeout(
    new Promise((resolve, reject) => {
      let pedido;
      try {
        pedido = new XMLHttpRequest();
      } catch (erro) {
        reject(erro);
        return;
      }
      pedido.open("GET", url, true);
      pedido.onload = () => {
        const corpo = String(pedido.responseText || "");
        if (pedido.status < 200 || pedido.status >= 300) {
          reject(new Error(`HTTP ${pedido.status} ao buscar ${url}`));
          return;
        }
        if (maxBytes && corpo.length > maxBytes) {
          reject(new Error(`resposta acima do limite (${corpo.length} bytes)`));
          return;
        }
        resolve(corpo);
      };
      pedido.onerror = () => reject(new Error(`falha de rede ao buscar ${url}`));
      pedido.send(null);
    }),
    TIMEOUT_REDE_MS,
    `tempo esgotado ao buscar ${url}`
  );
}

function raizDoManifesto(urlManifesto) {
  const bruto = String(urlManifesto || "").trim();
  const corte = bruto.lastIndexOf("/");
  return corte > 0 ? bruto.slice(0, corte + 1) : bruto;
}

function normalizarManifesto(texto, urlManifesto) {
  let dados;
  try {
    dados = JSON.parse(texto);
  } catch (erro) {
    throw new Error("manifest.json invalido");
  }
  const lista = Array.isArray(dados?.scrapers)
    ? dados.scrapers
    : Array.isArray(dados?.plugins)
      ? dados.plugins
      : [];
  const raiz = raizDoManifesto(urlManifesto);
  return {
    nome: String(dados?.name || "").trim() || "Repositorio",
    versao: String(dados?.version || "").trim(),
    scrapers: lista
      .map((item) => ({
        id: String(item?.id || item?.name || "").trim(),
        nome: String(item?.name || item?.id || "").trim(),
        arquivo: String(item?.filename || item?.file || "").trim(),
        versao: String(item?.version || "").trim(),
        tipos: Array.isArray(item?.supportedTypes) ? item.supportedTypes : [],
        habilitado: item?.enabled !== false
      }))
      .filter((item) => item.id && item.arquivo)
      .map((item) => ({ ...item, url: raiz + item.arquivo }))
  };
}

export const PluginScraperRuntime = {
  async carregarManifesto(urlManifesto, { forcar = false } = {}) {
    const chave = String(urlManifesto || "").trim();
    if (!chave) {
      throw new Error("URL de manifesto vazia");
    }
    const cacheado = manifestoCache.get(chave);
    if (!forcar && cacheado && agora() - cacheado.quando < CACHE_MANIFESTO_MS) {
      return cacheado.valor;
    }
    const texto = await baixarTexto(chave, MAX_BYTES_SCRAPER);
    const valor = normalizarManifesto(texto, chave);
    manifestoCache.set(chave, { quando: agora(), valor });
    return valor;
  },

  /**
   * Compila o scraper e devolve a funcao getStreams.
   *
   * O `return typeof getStreams === "function" ? getStreams : null` no fim vale
   * para os dois formatos que aparecem na pratica: o arquivo que declara a
   * funcao solta e o que faz `module.exports`/`globalThis.getStreams`.
   */
  async carregarScraper(scraper, { forcar = false } = {}) {
    const chave = String(scraper?.url || "").trim();
    if (!chave) {
      throw new Error("scraper sem URL");
    }
    const cacheado = scraperCache.get(chave);
    if (!forcar && cacheado && agora() - cacheado.quando < CACHE_SCRAPER_MS) {
      return cacheado.valor;
    }
    const codigo = await baixarTexto(chave, MAX_BYTES_SCRAPER);
    const moduleShim = { exports: {} };
    const fabrica = new Function(
      "globalThis",
      "window",
      "self",
      "fetch",
      "console",
      "URL",
      "URLSearchParams",
      "TextDecoder",
      "setTimeout",
      "clearTimeout",
      "module",
      "exports",
      `${codigo}
;return (typeof getStreams === "function" && getStreams) ||
        (module && module.exports && (module.exports.getStreams || module.exports)) ||
        null;`
    );
    const ambiente = {};
    const encontrado = fabrica(
      ambiente,
      ambiente,
      ambiente,
      typeof fetch === "function" ? fetch.bind(null) : undefined,
      console,
      typeof URL !== "undefined" ? URL : undefined,
      typeof URLSearchParams !== "undefined" ? URLSearchParams : undefined,
      typeof TextDecoder !== "undefined" ? TextDecoder : undefined,
      setTimeout,
      clearTimeout,
      moduleShim,
      moduleShim.exports
    );
    if (typeof encontrado !== "function") {
      throw new Error(`${scraper.nome || chave}: getStreams nao encontrado`);
    }
    scraperCache.set(chave, { quando: agora(), valor: encontrado });
    return encontrado;
  },

  /**
   * Normaliza o retorno do scraper para o formato de stream do app.
   *
   * `headers` e o campo que nao pode ser perdido: quase todo stream desses
   * provedores exige Referer/User-Agent, e o <video> da TV nao envia cabecalho
   * nenhum. Repassando como `behaviorHints.proxyHeaders.request`, o caminho que
   * ja existe (WebOsPlaybackProxy + servico local) assume dali.
   */
  normalizarStreams(bruto, scraper) {
    const lista = Array.isArray(bruto) ? bruto : bruto ? [bruto] : [];
    return lista
      .map((item) => {
        const url = String(item?.url || item?.stream || "").trim();
        if (!url) {
          return null;
        }
        const cabecalhos = item?.headers && typeof item.headers === "object" ? item.headers : null;
        const qualidade = Number(item?.quality || 0);
        return {
          name: String(item?.name || scraper?.nome || "Plugin").trim(),
          title: String(item?.title || item?.description || "").trim(),
          url,
          quality: Number.isFinite(qualidade) && qualidade > 0 ? qualidade : null,
          pluginId: scraper?.id || "",
          pluginName: scraper?.nome || "",
          behaviorHints: cabecalhos
            ? { notWebReady: true, proxyHeaders: { request: cabecalhos } }
            : undefined
        };
      })
      .filter(Boolean);
  },

  async executarScraper(scraper, { tmdbId, mediaType, season, episode }) {
    const getStreams = await this.carregarScraper(scraper);
    const bruto = await comTimeout(
      Promise.resolve(getStreams(String(tmdbId || ""), mediaType, season, episode)),
      TIMEOUT_SCRAPER_MS,
      `${scraper.nome || scraper.id}: tempo esgotado`
    );
    return this.normalizarStreams(bruto, scraper);
  },

  limparCache() {
    manifestoCache.clear();
    scraperCache.clear();
  }
};
