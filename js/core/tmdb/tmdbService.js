import { TmdbSettingsStore } from "../../data/local/tmdbSettingsStore.js";
import { TMDB_API_KEY } from "../../config.js";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const imdbToTmdbCache = new Map();
const imdbToTmdbInFlight = new Map();
const tmdbToImdbCache = new Map();
const tmdbToImdbInFlight = new Map();

function getContentType(type) {
  const normalized = String(type || "").toLowerCase();
  if (["series", "tv", "show", "tvshow"].includes(normalized)) return "tv";
  if (["movie", "film"].includes(normalized)) return "movie";
  return normalized;
}

export function parseTmdbIdInput(value) {
  const rawId = String(value || "").trim();
  if (!rawId) return { idPart: "", kind: "unknown" };
  // Keep the same case-sensitive prefix handling as Android's
  // removePrefix("tmdb:").removePrefix("movie:").removePrefix("series:").
  const idPart = rawId
    .replace(/^tmdb:/, "")
    .replace(/^movie:/, "")
    .replace(/^series:/, "")
    .trim()
    .split(":")[0]
    .split("/")[0]
    .trim();
  if (/^\d+$/.test(idPart)) return { idPart, kind: "numeric" };
  if (idPart.startsWith("tt")) return { idPart, kind: "imdb" };
  return { idPart, kind: "unknown" };
}

function lookupKey(id, type) {
  return `${String(id || "")
    .trim()
    .toLowerCase()}::${getContentType(type)}`;
}

export const TmdbService = {
  async ensureTmdbId(id, type = "movie", options = {}) {
    const parsed = parseTmdbIdInput(id);
    // Android accepts an already numeric TMDB id without consulting settings,
    // API keys, or the network. This branch must stay before all Web-only
    // configuration gates.
    if (parsed.kind === "numeric") return parsed.idPart;
    if (parsed.kind !== "imdb") return null;

    const contentType = getContentType(type);
    const key = lookupKey(parsed.idPart, contentType);
    if (imdbToTmdbCache.has(key)) {
      return imdbToTmdbCache.get(key);
    }
    if (imdbToTmdbInFlight.has(key)) {
      return imdbToTmdbInFlight.get(key);
    }

    // Android checks its cache before any external lookup gate. Preserve a
    // cached conversion even when the optional Web TMDB feature is disabled;
    // only an uncached network lookup is subject to the Web configuration and
    // API-key requirements.
    const settings = TmdbSettingsStore.get();
    const requireEnabled = options?.requireEnabled !== false;
    const apiKey = String(TMDB_API_KEY || "").trim();
    if ((requireEnabled && !settings.enabled) || !apiKey) return null;

    const url = `${TMDB_BASE_URL}/find/${encodeURIComponent(parsed.idPart)}?external_source=imdb_id&api_key=${encodeURIComponent(apiKey)}`;
    const request = (async () => {
      const response = await fetch(url);
      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      const list = contentType === "tv" ? data.tv_results : data.movie_results;
      const first = Array.isArray(list) ? list[0] : null;
      if (!first?.id) {
        return null;
      }

      const resolvedId = String(first.id);
      imdbToTmdbCache.set(key, resolvedId);
      tmdbToImdbCache.set(lookupKey(resolvedId, contentType), parsed.idPart);
      return resolvedId;
    })();
    imdbToTmdbInFlight.set(key, request);
    try {
      return await request;
    } finally {
      if (imdbToTmdbInFlight.get(key) === request) {
        imdbToTmdbInFlight.delete(key);
      }
    }
  },

  async tmdbToImdb(tmdbId, type = "movie") {
    const apiKey = String(TMDB_API_KEY || "").trim();
    const numericId = String(tmdbId || "").trim();
    if (!apiKey || !/^\d+$/.test(numericId)) {
      return null;
    }

    const contentType = getContentType(type);
    const key = lookupKey(numericId, contentType);
    if (tmdbToImdbCache.has(key)) {
      return tmdbToImdbCache.get(key);
    }
    if (tmdbToImdbInFlight.has(key)) {
      return tmdbToImdbInFlight.get(key);
    }

    const url = `${TMDB_BASE_URL}/${contentType}/${encodeURIComponent(numericId)}/external_ids?api_key=${encodeURIComponent(apiKey)}`;
    const request = (async () => {
      const response = await fetch(url);
      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      const imdbId = String(data?.imdb_id || "").trim();
      if (!/^tt\d+$/i.test(imdbId)) {
        return null;
      }
      tmdbToImdbCache.set(key, imdbId);
      imdbToTmdbCache.set(lookupKey(imdbId, contentType), numericId);
      return imdbId;
    })();
    tmdbToImdbInFlight.set(key, request);
    try {
      return await request;
    } finally {
      if (tmdbToImdbInFlight.get(key) === request) {
        tmdbToImdbInFlight.delete(key);
      }
    }
  },

  clearCache() {
    imdbToTmdbCache.clear();
    tmdbToImdbCache.clear();
  }
};
