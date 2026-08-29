import { LocalStore } from "../storage/localStore.js";
import { PluginRuntime } from "./pluginRuntime.js";
import { PluginScraperRuntime } from "./pluginScraperRuntime.js";

const PLUGINS_ENABLED_KEY = "pluginsEnabled";

export const PluginManager = {
  get pluginsEnabled() {
    return Boolean(LocalStore.get(PLUGINS_ENABLED_KEY, false));
  },

  setPluginsEnabled(enabled) {
    LocalStore.set(PLUGINS_ENABLED_KEY, Boolean(enabled));
  },

  listPluginSources() {
    return PluginRuntime.listSources();
  },

  addPluginSource(source) {
    PluginRuntime.addSource(source);
  },

  removePluginSource(sourceId) {
    PluginRuntime.removeSource(sourceId);
  },

  setPluginSourceEnabled(sourceId, enabled) {
    PluginRuntime.setSourceEnabled(sourceId, enabled);
  },

  /**
   * Uma fonte com token ({tmdbId} e afins) e o formato antigo: template de URL,
   * resolvido localmente sem rede. Uma fonte SEM token e apontando para .json e
   * um repositorio de scrapers — que e o que a conta sincroniza hoje (medido na
   * C9: os dois repositorios do usuario ja chegam em pluginSources). Tratar o
   * segundo como template gerava um "stream" apontando para o manifest.json.
   */
  ehRepositorio(source) {
    const url = String(source?.urlTemplate || "").trim();
    if (!url || url.indexOf("{") >= 0) {
      return false;
    }
    return /\.json(\?|#|$)/i.test(url);
  },

  listarRepositorios() {
    return PluginRuntime.listSources().filter((source) => this.ehRepositorio(source));
  },

  async listarFornecedores({ forcar = false } = {}) {
    const repositorios = PluginRuntime.listSources().filter((source) => this.ehRepositorio(source));
    const resultados = await Promise.all(
      repositorios.map(async (source) => {
        try {
          const manifesto = await PluginScraperRuntime.carregarManifesto(source.urlTemplate, {
            forcar
          });
          return { source, manifesto, erro: null };
        } catch (erro) {
          return { source, manifesto: null, erro: erro?.message || String(erro) };
        }
      })
    );
    return resultados;
  },

  async executeScrapersStreaming({ tmdbId, mediaType, season = null, episode = null } = {}) {
    if (!this.pluginsEnabled) {
      return [];
    }
    this.ultimosProvedoresIncompativeis = [];

    const todas = PluginRuntime.listSources().filter((source) => source.enabled !== false);
    const legado = todas.filter((source) => !this.ehRepositorio(source));
    const repositorios = todas.filter((source) => this.ehRepositorio(source));

    const doTemplate = legado.length
      ? PluginRuntime.execute({ tmdbId, mediaType, season, episode })
      : [];

    if (!repositorios.length) {
      return doTemplate;
    }

    // Cada scraper e independente: um que falhe ou estoure o tempo nao pode
    // levar os outros junto, entao o erro fica no console e a lista segue.
    const porRepositorio = await Promise.all(
      repositorios.map(async (source) => {
        let manifesto;
        try {
          manifesto = await PluginScraperRuntime.carregarManifesto(source.urlTemplate);
        } catch (erro) {
          console.warn("[Nuvio plugins] manifesto falhou", source.name, erro);
          return [];
        }
        const ativos = (manifesto.scrapers || []).filter((scraper) => scraper.habilitado);
        const execucoes = await Promise.all(
          ativos.map(async (scraper) => {
            try {
              const streams = await PluginScraperRuntime.executarScraper(scraper, {
                tmdbId,
                mediaType,
                season,
                episode
              });
              if (!streams.length) {
                return null;
              }
              return {
                sourceId: `${source.id}:${scraper.id}`,
                sourceName: scraper.nome || manifesto.nome || source.name,
                streams
              };
            } catch (erro) {
              // Incompatibilidade de motor nao e "nao achei nada": e o provedor
              // que nao tem como rodar nesta TV. Guardado para a tela poder
              // dizer isso em vez de mostrar uma lista vazia.
              if (erro?.incompativelComOMotor) {
                this.ultimosProvedoresIncompativeis = this.ultimosProvedoresIncompativeis || [];
                if (this.ultimosProvedoresIncompativeis.indexOf(scraper?.nome) < 0) {
                  this.ultimosProvedoresIncompativeis.push(scraper?.nome || "");
                }
              }
              console.warn("[Nuvio plugins] scraper falhou", scraper?.nome, erro);
              return null;
            }
          })
        );
        return execucoes.filter(Boolean);
      })
    );

    return doTemplate.concat(porRepositorio.reduce((acc, item) => acc.concat(item), []));
  }
};
