import { TmdbSettingsStore } from "../../data/local/tmdbSettingsStore.js";
import { TMDB_API_KEY } from "../../config.js";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const imdbToTmdbCache = new Map();
const imdbToTmdbInFlight = new Map();
const tmdbToImdbCache = new Map();
const tmdbToImdbInFlight = new Map();

function getContentType(type) {
  const normalized = String(type || "").toLowerCase();
  if (normalized === "series" || normalized === "tv" || normalized === "show") {
    return "tv";
  }
  return "movie";
}

function lookupKey(id, type) {
  return `${String(id || "")
    .trim()
    .toLowerCase()}::${getContentType(type)}`;
}

export const TmdbService = {
  async ensureTmdbId(id, type = "movie", options = {}) {
    const settings = TmdbSettingsStore.get();
    const requireEnabled = options?.requireEnabled !== false;
    const apiKey = String(TMDB_API_KEY || "").trim();
    if ((requireEnabled && !settings.enabled) || !apiKey) {
      return null;
    }

    const rawId = String(id || "").trim();
    if (!rawId) {
      return null;
    }

    const idPart = rawId
      .replace(/^tmdb:/i, "")
      .replace(/^movie:/i, "")
      .replace(/^series:/i, "")
      .trim();
    const normalizedIdPart = idPart.split(":")[0]?.split("/")[0]?.trim() || "";

    if (/^\d+$/.test(normalizedIdPart)) {
      return normalizedIdPart;
    }

    if (!normalizedIdPart.startsWith("tt")) {
      return null;
    }

    const contentType = getContentType(type);
    const key = lookupKey(normalizedIdPart, contentType);
    if (imdbToTmdbCache.has(key)) {
      return imdbToTmdbCache.get(key);
    }
    if (imdbToTmdbInFlight.has(key)) {
      return imdbToTmdbInFlight.get(key);
    }

    const url = `${TMDB_BASE_URL}/find/${encodeURIComponent(normalizedIdPart)}?external_source=imdb_id&api_key=${encodeURIComponent(apiKey)}`;
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
      tmdbToImdbCache.set(lookupKey(resolvedId, contentType), normalizedIdPart);
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
