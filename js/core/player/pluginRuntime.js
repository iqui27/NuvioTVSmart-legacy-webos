import { TMDB_API_KEY } from "../../config.js";
import { PluginServiceClient } from "../../platform/pluginServiceClient.js";
import { PLUGIN_QUOTAS } from "./pluginPolicy.js";
import { PluginStore } from "../../data/local/pluginStore.js";

const activeWorkers = new Set();
const activeCancellers = new Map();
let runtimeTestPromise = null;

function workerUrl() {
  if (globalThis.__NUVIO_PLUGIN_WORKER_URL__) {
    return String(globalThis.__NUVIO_PLUGIN_WORKER_URL__);
  }
  try {
    return new URL("assets/runtime/plugin-worker.js", document.baseURI || location.href).toString();
  } catch (_) {
    return "assets/runtime/plugin-worker.js";
  }
}

function byteLength(value) {
  const input = String(value || "");
  return typeof TextEncoder === "function"
    ? new TextEncoder().encode(input).byteLength
    : unescape(encodeURIComponent(input)).length;
}

function defaultArgs({ tmdbId, mediaType, season = null, episode = null } = {}) {
  return {
    tmdbId: String(tmdbId || ""),
    mediaType: String(mediaType || ""),
    season: season == null ? null : Number(season),
    episode: episode == null ? null : Number(episode)
  };
}

export const PluginRuntime = {
  listSources() {
    return PluginStore.get().legacySources;
  },

  saveSources(sources) {
    const normalized = Array.isArray(sources) ? sources : [];
    const current = PluginStore.get();
    // Legacy URL-template sources are retained for migration/display only and
    // are not part of Android's remote `plugins` repository payload.
    const next = PluginStore.replace({
      ...current,
      legacySources: normalized,
      syncDirty: current.syncDirty
    });
    return JSON.stringify(current.legacySources) !== JSON.stringify(next.legacySources);
  },

  addSource(source) {
    const current = this.listSources();
    const url = String(source?.urlTemplate || source?.url || "").trim();
    if (!url || current.some((entry) => entry.urlTemplate === url)) return false;
    return this.saveSources([...current, { ...source, urlTemplate: url, enabled: false }]);
  },

  removeSource(sourceId) {
    return this.saveSources(this.listSources().filter((source) => source.id !== sourceId));
  },

  setSourceEnabled(sourceId, enabled) {
    return this.saveSources(
      this.listSources().map((source) =>
        source.id === sourceId ? { ...source, enabled: Boolean(enabled) } : source
      )
    );
  },

  // URL-template sources are retained for migration and display only. They
  // deliberately have no execution path on Web TV.
  execute() {
    return [];
  },

  async selfTest({ quota = PLUGIN_QUOTAS.limited } = {}) {
    if (typeof Worker !== "function") throw new Error("Worker API unavailable");
    if (typeof WebAssembly !== "object") throw new Error("WebAssembly API unavailable");
    if (!runtimeTestPromise) {
      runtimeTestPromise = this.executePlugin({
        code: "module.exports.getStreams = function(){ return []; };",
        filename: "runtime-self-test.js",
        scraperId: "runtime-self-test",
        args: { tmdbId: "", mediaType: "movie", season: null, episode: null },
        quota,
        skipService: true
      }).catch((error) => {
        runtimeTestPromise = null;
        throw error;
      });
    }
    return runtimeTestPromise;
  },

  async executePlugin({
    code,
    filename = "plugin.js",
    scraperId = "plugin",
    profileId = "",
    repositoryId = "",
    settings = {},
    args = {},
    quota = PLUGIN_QUOTAS.limited,
    timeoutMs = quota.providerTimeoutMs || 60000,
    skipService = false,
    signal = null
  } = {}) {
    if (byteLength(code) > Number(quota.maxCodeBytes || PLUGIN_QUOTAS.limited.maxCodeBytes)) {
      throw new Error("Plugin code exceeds the platform quota");
    }
    if (!skipService) await PluginServiceClient.ensureReady();
    if (typeof Worker !== "function") throw new Error("Worker API unavailable");

    const worker = new Worker(workerUrl());
    activeWorkers.add(worker);
    const executionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const pendingRequestIds = new Set();
    let timeoutId = 0;
    let settled = false;
    let abortListener = null;

    const terminate = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (abortListener) signal?.removeEventListener?.("abort", abortListener);
      pendingRequestIds.forEach((requestId) => void PluginServiceClient.cancel(requestId));
      pendingRequestIds.clear();
      activeWorkers.delete(worker);
      activeCancellers.delete(worker);
      try {
        worker.terminate();
      } catch (_) {}
    };

    return new Promise((resolve, reject) => {
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        terminate();
        if (error) reject(error);
        else resolve(value);
      };
      activeCancellers.set(worker, () => finish(new Error("Plugin execution cancelled")));
      abortListener = () => finish(new Error("Plugin execution cancelled"));
      if (signal?.aborted) {
        finish(new Error("Plugin execution cancelled"));
        return;
      }
      signal?.addEventListener?.("abort", abortListener, { once: true });
      timeoutId = setTimeout(() => finish(new Error("Plugin execution timed out")), timeoutMs);
      worker.onerror = (event) =>
        finish(new Error(String(event?.message || "Plugin worker failed")));
      worker.onmessage = (event) => {
        const message = event?.data || {};
        if (message.type === "fetch") {
          const requestId = String(message.requestId || "");
          pendingRequestIds.add(requestId);
          PluginServiceClient.fetch({
            ...(message.payload || {}),
            requestId,
            executionId,
            profileId: String(profileId || ""),
            repositoryId: String(repositoryId || ""),
            scraperId: String(scraperId || ""),
            deadline: Date.now() + Number(quota.providerTimeoutMs || 30000),
            timeoutMs: Number(quota.providerTimeoutMs || 30000),
            maxBodyBytes: Number(quota.maxFetchBytes || 1024 * 1024),
            maxResponseBytes: Number(quota.maxFetchBytes || 1024 * 1024),
            // The Android runner resolves transport failures as status-0
            // response objects. Management requests keep their normal
            // throwing behavior because they are outside the plugin contract.
            androidResponseContract: true,
            signal
          })
            .then((payload) => {
              pendingRequestIds.delete(requestId);
              if (!settled) worker.postMessage({ type: "fetchResult", requestId, payload });
            })
            .catch((error) => {
              pendingRequestIds.delete(requestId);
              if (!settled)
                worker.postMessage({
                  type: "fetchResult",
                  requestId,
                  error: String(error?.message || error)
                });
            });
          return;
        }
        if (message.type === "cancel") {
          const requestId = String(message.requestId || "");
          if (requestId && pendingRequestIds.has(requestId)) {
            void PluginServiceClient.cancel(requestId);
          }
          return;
        }
        if (message.type === "result") {
          finish(null, Array.isArray(message.results) ? message.results : []);
          return;
        }
        if (message.type === "error")
          finish(new Error(String(message.error || "Plugin execution failed")));
      };
      try {
        worker.postMessage({
          type: "execute",
          executionId,
          code: String(code || ""),
          filename,
          scraperId,
          settings: settings && typeof settings === "object" ? settings : {},
          profileId: String(profileId || ""),
          repositoryId: String(repositoryId || ""),
          tmdbApiKey: TMDB_API_KEY,
          args: defaultArgs(args),
          quota,
          timeoutMs,
          deadline: Date.now() + Number(timeoutMs || 60000)
        });
      } catch (error) {
        finish(error);
      }
    });
  },

  cancelAll() {
    [...activeCancellers.values()].forEach((cancel) => {
      try {
        cancel();
      } catch (_) {}
    });
    activeWorkers.forEach((worker) => {
      try {
        worker.terminate();
      } catch (_) {}
    });
    activeCancellers.clear();
    activeWorkers.clear();
    runtimeTestPromise = null;
  },

  getActiveWorkerCount() {
    return activeWorkers.size;
  }
};
