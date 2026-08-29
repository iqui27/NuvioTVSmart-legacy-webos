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

/**
 * Transpila, no proprio aparelho, o scraper que o motor nao entende.
 *
 * MEDIDO NA OLED65C9 (webOS 4.10, Chromium 53) — a variante webOS 3 e mais
 * lenta, entao trate estes numeros como piso, nao como teto:
 *   baixar o Babel (3MB)      767ms
 *   avaliar o Babel          1712ms
 *   transpilar 32KB (FSHD)   2372ms   -> compila depois em 9ms
 *   transpilar 40KB (MegaE)  1749ms   -> compila depois em 14ms
 *   transpilar 234KB (Peach)10330ms   -> compila depois em 68ms
 *
 * Tres decisoes que vem desses numeros:
 * 1. O Babel e baixado SOB DEMANDA. Quem nao usa plugins, ou usa numa TV cujo
 *    motor entende o scraper, nunca paga os 3MB nem os 1,7s — nao entra no
 *    pacote nem no boot.
 * 2. O resultado vai para o localStorage. Transpilar e uma vez por versao do
 *    arquivo, nao uma vez por busca; sem isso, aqueles 10s do Peachify
 *    voltariam a cada pesquisa.
 * 3. Acima de MAX_KB_TRANSPILAR nao vale a pena: o custo cresce com o tamanho e
 *    numa TV de 2016 um arquivo desses passaria de meio minuto. Melhor dizer que
 *    o provedor e grande demais do que deixar a busca parecer travada.
 */
const BABEL_URL = "https://unpkg.com/@babel/standalone@7/babel.min.js";
const PREFIXO_CACHE = "pluginScraperEs5:";
const MAX_KB_TRANSPILAR = 320;
const MAX_ENTRADAS_CACHE = 3;
// Medido na C9: o localStorage do app ja carrega 1436KB em 50 chaves (addons,
// progresso, perfis) e o maior bloco que aceitou gravar foi 2MB. Este cache NAO
// pode disputar espaco com os dados do usuario — encher a cota faria o app
// falhar ao salvar progresso, que e perda de verdade, enquanto perder o cache
// so custa alguns segundos. Acima deste piso de uso, nao gravamos nada.
const TETO_USO_LOCALSTORAGE_KB = 2600;
let babelCarregando = null;

export function motorEntendeEs2015() {
  try {
    // eslint-disable-next-line no-new-func
    new Function("const _t = 1; return _t;");
    return true;
  } catch (_) {
    return false;
  }
}

function lerCacheEs5(url) {
  try {
    const bruto = localStorage.getItem(PREFIXO_CACHE + url);
    if (!bruto) {
      return null;
    }
    const dados = JSON.parse(bruto);
    return dados && typeof dados.codigo === "string" ? dados : null;
  } catch (_) {
    return null;
  }
}

/**
 * `localStorage.setItem` e escrita sincrona e pode estourar a cota. Nao usamos
 * LocalStore aqui de proposito: ele engole a excecao, e uma cota estourada
 * viraria perda silenciosa. Ao estourar, descartamos as entradas mais antigas e
 * seguimos SEM cache — transpilar de novo e lento, mas funciona.
 */
function usoLocalStorageKB() {
  let total = 0;
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const chave = localStorage.key(i);
      total += (chave || "").length + (localStorage.getItem(chave) || "").length;
    }
  } catch (_) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Math.round(total / 1024);
}

function gravarCacheEs5(url, codigo) {
  const chave = PREFIXO_CACHE + url;
  if (usoLocalStorageKB() + Math.round(codigo.length / 1024) > TETO_USO_LOCALSTORAGE_KB) {
    // Segue sem cache de proposito: converter de novo custa segundos, encher a
    // cota custaria os dados do usuario.
    podarCacheEs5(0);
    return false;
  }
  const valor = JSON.stringify({ quando: agora(), codigo });
  try {
    localStorage.setItem(chave, valor);
    podarCacheEs5();
    return true;
  } catch (_) {
    try {
      limparCacheEs5();
      localStorage.setItem(chave, valor);
      return true;
    } catch (__) {
      return false;
    }
  }
}

function listarChavesCacheEs5() {
  const chaves = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const chave = localStorage.key(i);
      if (chave && chave.indexOf(PREFIXO_CACHE) === 0) {
        chaves.push(chave);
      }
    }
  } catch (_) {
    return [];
  }
  return chaves;
}

function podarCacheEs5(limite = MAX_ENTRADAS_CACHE) {
  const chaves = listarChavesCacheEs5();
  if (chaves.length <= limite) {
    return;
  }
  const comIdade = chaves
    .map((chave) => {
      let quando = 0;
      try {
        quando = Number(JSON.parse(localStorage.getItem(chave) || "{}").quando || 0);
      } catch (_) {
        quando = 0;
      }
      return { chave, quando };
    })
    .sort((a, b) => a.quando - b.quando);
  comIdade.slice(0, comIdade.length - limite).forEach(({ chave }) => {
    try {
      localStorage.removeItem(chave);
    } catch (_) {
      /* nada a fazer */
    }
  });
}

function limparCacheEs5() {
  listarChavesCacheEs5().forEach((chave) => {
    try {
      localStorage.removeItem(chave);
    } catch (_) {
      /* nada a fazer */
    }
  });
}

function carregarBabel() {
  if (typeof window !== "undefined" && window.Babel && window.Babel.transform) {
    return Promise.resolve(window.Babel);
  }
  if (babelCarregando) {
    return babelCarregando;
  }
  babelCarregando = baixarTexto(BABEL_URL, 8 * 1024 * 1024)
    .then((codigo) => {
      // eslint-disable-next-line no-eval
      (0, eval)(codigo);
      const babel = typeof window !== "undefined" ? window.Babel : null;
      if (!babel || !babel.transform) {
        throw new Error("Babel nao expos transform");
      }
      return babel;
    })
    .catch((erro) => {
      babelCarregando = null;
      throw erro;
    });
  return babelCarregando;
}

async function converterParaEs5(url, codigo) {
  const kb = Math.round(codigo.length / 1024);
  if (kb > MAX_KB_TRANSPILAR) {
    const grande = new Error(
      `provedor grande demais para converter nesta TV (${kb}KB, teto ${MAX_KB_TRANSPILAR}KB)`
    );
    grande.incompativelComOMotor = true;
    throw grande;
  }
  const cacheado = lerCacheEs5(url);
  if (cacheado) {
    return cacheado.codigo;
  }
  const babel = await carregarBabel();
  const convertido = babel.transform(codigo, {
    presets: [["env", { targets: { chrome: "38" } }]],
    compact: true
  }).code;
  gravarCacheEs5(url, convertido);
  return convertido;
}

/**
 * Compila o codigo do scraper. Separada para que o SyntaxError de um motor
 * antigo possa ser distinguido de um erro de execucao pelo chamador.
 */
function criarFabrica(codigo) {
  return new Function(
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
    let fabrica;
    try {
      fabrica = criarFabrica(codigo);
    } catch (erro) {
      // O scraper e baixado em RUNTIME, entao ele NAO passa pelo Babel do nosso
      // build: chega no aparelho exatamente como o autor escreveu. Num Chromium
      // 38 (webOS 3) qualquer `const`, arrow ou template literal vira
      // SyntaxError aqui. Medido nos 4 provedores do repositorio saimuel: tres
      // usam sintaxe ES2015 e so um e ES5, ou seja a maioria nao tem como rodar
      // naquele motor. Sem esta distincao o usuario ve "nenhuma fonte
      // encontrada" e fica sem saber que o problema e a TV, nao a busca.
      const ehSintaxe = erro instanceof SyntaxError || /syntax/i.test(String(erro?.message || ""));
      if (!ehSintaxe) {
        throw new Error(`${scraper?.nome || chave}: ${String(erro?.message || erro)}`);
      }
      // Sintaxe que este motor nao entende: tenta converter no proprio aparelho.
      // So chega aqui quem realmente precisa — num motor moderno a compilacao
      // acima ja teria funcionado.
      try {
        const emEs5 = await converterParaEs5(chave, codigo);
        fabrica = criarFabrica(emEs5);
      } catch (erroConversao) {
        const detalhe = erroConversao?.incompativelComOMotor
          ? String(erroConversao.message || "")
          : `nao foi possivel converter para este motor (${String(erroConversao?.message || erroConversao)})`;
        const falha = new Error(`${scraper?.nome || chave}: ${detalhe}`);
        falha.incompativelComOMotor = true;
        throw falha;
      }
    }
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
