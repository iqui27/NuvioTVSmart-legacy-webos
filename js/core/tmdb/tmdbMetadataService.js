import {
  normalizeTmdbLanguageCode,
  TmdbSettingsStore
} from "../../data/local/tmdbSettingsStore.js";
import { TMDB_API_KEY } from "../../config.js";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_SIZES = {
  poster: "w342",
  // Match Android TV: hero backdrops need enough source pixels for a 1080p TV.
  backdrop: "w1280",
  logo: "w300",
  // Match Android TV: episode cards are wider than 300px on the TV layout.
  still: "w500",
  // Entity browse cards and logos follow the Android TMDB screen sizes.
  entityPoster: "w500",
  entityBackdrop: "w780",
  entityLogo: "w500"
};
const TMDB_TRAILER_FALLBACK_LANGUAGE = "en-US";
const ENTITY_RAIL_MAX_ITEMS = 20;
const TOP_RATED_VOTE_COUNT_FLOOR = 200;
const ENTITY_RAIL_TYPES = ["popular", "top_rated", "recent"];
const entityHeaderCache = new Map();
const entityRailCache = new Map();
const entityBrowseCache = new Map();

function resolveType(contentType) {
  const normalized = String(contentType || "").toLowerCase();
  if (normalized === "series" || normalized === "tv" || normalized === "show") {
    return "tv";
  }
  return "movie";
}

function toImageUrl(path, kind = "backdrop") {
  if (!path) {
    return null;
  }
  const normalizedPath = String(path);
  if (/^https?:\/\//i.test(normalizedPath)) {
    return normalizedPath;
  }
  const size = TMDB_IMAGE_SIZES[kind] || kind;
  return `https://image.tmdb.org/t/p/${size}${normalizedPath}`;
}

function normalizeTmdbArtworkLanguage(language = "") {
  const normalized = normalizeTmdbLanguageCode(language);
  const [rawLanguage = "en", rawRegion = ""] = normalized.split("-", 2);
  const languageCode = rawLanguage.toLowerCase() || "en";
  const regionCode =
    rawRegion.length === 2
      ? rawRegion.toUpperCase()
      : languageCode === "pt"
        ? "PT"
        : languageCode === "es"
          ? "ES"
          : "";
  return {
    locale: regionCode ? `${languageCode}-${regionCode}` : languageCode,
    languageCode,
    regionCode
  };
}

function buildTmdbImageLanguageFilter(language = "") {
  const { locale, languageCode } = normalizeTmdbArtworkLanguage(language);
  return [...new Set([languageCode, locale, "en", "null"])].join(",");
}

function selectBestLocalizedLogoPath(logos = [], language = "") {
  const { languageCode, regionCode } = normalizeTmdbArtworkLanguage(language);
  const ranked = (Array.isArray(logos) ? logos : [])
    .map((logo, index) => {
      const logoLanguage = String(logo?.iso_639_1 || "").toLowerCase();
      const logoRegion = String(logo?.iso_3166_1 || "").toUpperCase();
      let priority = -1;
      if (logoLanguage === languageCode && regionCode && logoRegion === regionCode) {
        priority = 5;
      } else if (logoLanguage === languageCode && !logoRegion) {
        priority = 4;
      } else if (logoLanguage === languageCode) {
        priority = 3;
      } else if (logoLanguage === "en") {
        priority = 2;
      } else if (!logoLanguage) {
        priority = 1;
      }
      return {
        logo,
        index,
        priority,
        voteAverage: Number(logo?.vote_average || 0)
      };
    })
    // Never select artwork explicitly tagged with an unrelated language.
    .filter((entry) => entry.priority >= 0 && entry.logo?.file_path)
    .sort(
      (left, right) =>
        right.priority - left.priority ||
        right.voteAverage - left.voteAverage ||
        left.index - right.index
    );
  return ranked[0]?.logo?.file_path || null;
}

function normalizeTmdbTrailerLanguage(language = "") {
  const normalized = String(language || "")
    .trim()
    .replace(/_/g, "-");
  if (!normalized) {
    return TMDB_TRAILER_FALLBACK_LANGUAGE;
  }
  if (normalized.includes("-")) {
    const [locale, region] = normalized.split("-", 2);
    return region ? `${locale.toLowerCase()}-${region.toUpperCase()}` : locale.toLowerCase();
  }
  if (normalized.toLowerCase() === "en") {
    return TMDB_TRAILER_FALLBACK_LANGUAGE;
  }
  return normalized.toLowerCase();
}

function videoTypePriority(type = "") {
  const normalized = String(type || "")
    .trim()
    .toLowerCase();
  if (normalized === "trailer") return 0;
  if (normalized === "teaser") return 1;
  return 2;
}

function parsePublishedAtEpoch(value = "") {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : Number.MIN_SAFE_INTEGER;
}

function rankTmdbVideoCandidates(
  results = [],
  preferredLanguageCode = TMDB_TRAILER_FALLBACK_LANGUAGE
) {
  const preferredLanguage = String(preferredLanguageCode || TMDB_TRAILER_FALLBACK_LANGUAGE)
    .split("-")[0]
    .trim()
    .toLowerCase();
  const seenKeys = new Set();
  const candidates = (Array.isArray(results) ? results : [])
    .filter((entry) => String(entry?.site || "").toLowerCase() === "youtube")
    .filter((entry) => Boolean(String(entry?.key || "").trim()))
    .filter((entry) => {
      const normalizedType = String(entry?.type || "")
        .trim()
        .toLowerCase();
      return normalizedType === "trailer" || normalizedType === "teaser";
    })
    .filter((entry) => {
      const key = String(entry?.key || "").trim();
      if (seenKeys.has(key)) {
        return false;
      }
      seenKeys.add(key);
      return true;
    });

  const languageRank = (entry) => {
    const language = String(entry?.iso_639_1 || "")
      .trim()
      .toLowerCase();
    if (language === preferredLanguage) {
      return 0;
    }
    if (language === "en") {
      return 1;
    }
    return 2;
  };

  return candidates.sort((left, right) => {
    const typeDiff = videoTypePriority(left?.type) - videoTypePriority(right?.type);
    if (typeDiff !== 0) return typeDiff;
    const languageDiff = languageRank(left) - languageRank(right);
    if (languageDiff !== 0) return languageDiff;
    const officialDiff = Number(Boolean(right?.official)) - Number(Boolean(left?.official));
    if (officialDiff !== 0) return officialDiff;
    const sizeDiff = Number(right?.size || 0) - Number(left?.size || 0);
    if (sizeDiff !== 0) return sizeDiff;
    return parsePublishedAtEpoch(right?.published_at) - parsePublishedAtEpoch(left?.published_at);
  });
}

async function fetchTmdbVideos({ type, tmdbId, apiKey, language }) {
  const url = `${TMDB_BASE_URL}/${type}/${encodeURIComponent(String(tmdbId))}/videos?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(language)}`;
  const response = await fetch(url);
  if (!response.ok) {
    return [];
  }
  const data = await response.json();
  return Array.isArray(data?.results) ? data.results : [];
}

async function resolveTrailerCandidates({ type, tmdbId, apiKey, language, initialResults = [] }) {
  const preferredLanguage = normalizeTmdbTrailerLanguage(language);
  const preferred = rankTmdbVideoCandidates(initialResults, preferredLanguage);
  if (preferred.length || preferredLanguage === TMDB_TRAILER_FALLBACK_LANGUAGE) {
    return preferred;
  }
  const fallback = await fetchTmdbVideos({
    type,
    tmdbId,
    apiKey,
    language: TMDB_TRAILER_FALLBACK_LANGUAGE
  });
  return rankTmdbVideoCandidates(fallback, TMDB_TRAILER_FALLBACK_LANGUAGE);
}

function mapTrailerCandidates(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((entry) => {
      const key = String(entry?.key || "").trim();
      return {
        ytId: key,
        youtubeId: key,
        source: key ? `https://www.youtube.com/watch?v=${key}` : "",
        type: entry?.type || "Trailer",
        name: entry?.name || "Trailer",
        official: Boolean(entry?.official),
        publishedAt: entry?.published_at || "",
        size: Number(entry?.size || 0) || 0
      };
    })
    .filter((entry) => entry.ytId);
}

function mapCompanies(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((company) => {
      const rawId = company?.id ?? company?.tmdbId ?? company?.tmdb_id ?? null;
      const numericId = Number(rawId);
      return {
        name: company?.name || "",
        logo: toImageUrl(company?.logo_path || company?.logo || null, "logo"),
        tmdbId: Number.isInteger(numericId) && numericId > 0 ? numericId : null
      };
    })
    .filter((company) => company.name || company.logo);
}

function selectAgeRating(data = {}, type = "movie") {
  if (type === "tv") {
    const ratings = Array.isArray(data?.content_ratings?.results)
      ? data.content_ratings.results
      : [];
    const preferred =
      ratings.find((item) => String(item?.iso_3166_1 || "").toUpperCase() === "US") ||
      ratings.find((item) => String(item?.rating || "").trim());
    return String(preferred?.rating || "").trim() || null;
  }
  const releases = Array.isArray(data?.release_dates?.results) ? data.release_dates.results : [];
  const preferred =
    releases.find((item) => String(item?.iso_3166_1 || "").toUpperCase() === "US") ||
    releases.find((item) => Array.isArray(item?.release_dates) && item.release_dates.length);
  const certification = (Array.isArray(preferred?.release_dates) ? preferred.release_dates : [])
    .map((entry) => String(entry?.certification || "").trim())
    .find(Boolean);
  return certification || null;
}

function normalizeEntityKind(value) {
  return String(value || "")
    .trim()
    .toLowerCase() === "network"
    ? "network"
    : "company";
}

function normalizeEntityId(value) {
  const normalized = String(value ?? "").trim();
  return /^\d+$/.test(normalized) && Number(normalized) > 0 ? normalized : "";
}

function normalizeEntitySourceType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "movie" ? "movie" : "tv";
}

function buildEntityMediaOrder(entityKind, sourceType) {
  if (entityKind === "network") {
    return ["tv"];
  }
  return normalizeEntitySourceType(sourceType) === "movie" ? ["movie", "tv"] : ["tv", "movie"];
}

function entitySortBy(mediaType, railType) {
  if (railType === "top_rated") {
    return "vote_average.desc";
  }
  if (railType === "recent") {
    return mediaType === "tv" ? "first_air_date.desc" : "primary_release_date.desc";
  }
  return "popularity.desc";
}

function mapEntityDiscoverResult(result = {}, mediaType = "movie") {
  const title =
    result?.title || result?.name || result?.original_title || result?.original_name || "";
  const numericId = Number(result?.id);
  if (!title || !Number.isInteger(numericId) || numericId <= 0) {
    return null;
  }

  const poster =
    toImageUrl(result?.poster_path || null, "entityPoster") ||
    toImageUrl(result?.backdrop_path || null, "entityBackdrop");
  if (!poster) {
    return null;
  }

  const releaseDate = mediaType === "tv" ? result?.first_air_date : result?.release_date;
  const background = toImageUrl(result?.backdrop_path || null, "backdrop");
  const rating = Number(result?.vote_average);
  return {
    id: `tmdb:${numericId}`,
    type: mediaType === "tv" ? "series" : "movie",
    name: title,
    poster,
    background,
    backdrop: background,
    landscapePoster: background,
    description: result?.overview || "",
    releaseInfo: String(releaseDate || "").slice(0, 4),
    tmdbRating: Number.isFinite(rating) ? Number(rating.toFixed(1)) : null
  };
}

function fallbackEntityHeader(entityKind, entityId, fallbackName = "") {
  return {
    id: Number(entityId),
    kind: entityKind,
    name: String(fallbackName || "").trim() || "Unknown",
    logo: null,
    originCountry: null,
    secondaryLabel: null,
    description: null
  };
}

export const TmdbMetadataService = {
  async fetchEnrichment({ tmdbId, contentType, language = null } = {}) {
    const settings = TmdbSettingsStore.get();
    const apiKey = String(TMDB_API_KEY || "").trim();
    if (!settings.enabled || !apiKey || !tmdbId) {
      return null;
    }

    const type = resolveType(contentType);
    const lang = normalizeTmdbLanguageCode(language || settings.language);
    const imageLanguages = buildTmdbImageLanguageFilter(lang);
    const params = `api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(lang)}&append_to_response=images,credits,release_dates,content_ratings,videos,external_ids&include_image_language=${encodeURIComponent(imageLanguages)}`;
    const url = `${TMDB_BASE_URL}/${type}/${encodeURIComponent(String(tmdbId))}?${params}`;

    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const logoPath = selectBestLocalizedLogoPath(data?.images?.logos, lang);
    const releaseYear =
      type === "tv"
        ? String(data.first_air_date || "").slice(0, 4)
        : String(data.release_date || "").slice(0, 4);
    const companies = mapCompanies(data?.production_companies);
    const networks = mapCompanies(data?.networks);
    const spokenLanguage = Array.isArray(data?.spoken_languages) ? data.spoken_languages[0] : null;
    const countryValue =
      Array.isArray(data?.origin_country) && data.origin_country.length
        ? data.origin_country.join(", ")
        : Array.isArray(data?.production_countries)
          ? data.production_countries
              .map((item) => item?.iso_3166_1 || item?.name || "")
              .filter(Boolean)
              .join(", ")
          : "";
    const runtimeValue =
      type === "tv"
        ? Number((Array.isArray(data?.episode_run_time) ? data.episode_run_time[0] : 0) || 0)
        : Number(data?.runtime || 0);
    const trailerCandidates = await resolveTrailerCandidates({
      type,
      tmdbId,
      apiKey,
      language: lang,
      initialResults: Array.isArray(data?.videos?.results) ? data.videos.results : []
    });
    const trailers = mapTrailerCandidates(trailerCandidates);

    return {
      localizedTitle: data.title || data.name || null,
      description: data.overview || null,
      backdrop: toImageUrl(data.backdrop_path, "backdrop"),
      poster: toImageUrl(data.poster_path, "poster"),
      logo: toImageUrl(logoPath, "logo"),
      genres: Array.isArray(data.genres)
        ? data.genres.map((genre) => genre.name).filter(Boolean)
        : [],
      rating: typeof data.vote_average === "number" ? data.vote_average : null,
      releaseInfo: releaseYear || null,
      released: type === "tv" ? data.first_air_date || null : data.release_date || null,
      runtime: Number.isFinite(runtimeValue) && runtimeValue > 0 ? `${runtimeValue} min` : null,
      status: data?.status || null,
      ageRating: selectAgeRating(data, type),
      country: countryValue || null,
      language: spokenLanguage?.iso_639_1 || spokenLanguage?.english_name || null,
      originalLanguage: data?.original_language || null,
      imdbId: data?.external_ids?.imdb_id || null,
      credits: data.credits || null,
      companies,
      productionCompanies: companies,
      networks,
      trailers,
      trailerYtIds: trailers.map((entry) => entry.ytId).filter(Boolean),
      collectionId: data?.belongs_to_collection?.id ? String(data.belongs_to_collection.id) : null,
      collectionName: data?.belongs_to_collection?.name || null
    };
  },

  async fetchEntityBrowse({
    entityKind,
    entityId,
    sourceType,
    fallbackName = "",
    language = null
  } = {}) {
    const apiKey = String(TMDB_API_KEY || "").trim();
    const normalizedId = normalizeEntityId(entityId);
    if (!apiKey || !normalizedId) {
      return null;
    }

    const kind = normalizeEntityKind(entityKind);
    const source = normalizeEntitySourceType(sourceType);
    const settings = TmdbSettingsStore.get();
    const lang = normalizeTmdbLanguageCode(language || settings.language);
    const cacheKey = `${kind}:${normalizedId}:${source}:${lang}`;
    if (entityBrowseCache.has(cacheKey)) {
      return entityBrowseCache.get(cacheKey);
    }

    const header = await this.fetchEntityHeader({
      entityKind: kind,
      entityId: normalizedId,
      fallbackName,
      apiKey
    });
    const rails = [];
    for (const mediaType of buildEntityMediaOrder(kind, source)) {
      for (const railType of ENTITY_RAIL_TYPES) {
        const pageResult = await this.fetchEntityRailPage({
          entityKind: kind,
          entityId: normalizedId,
          mediaType,
          railType,
          language: lang,
          apiKey,
          page: 1
        });
        if (!pageResult.items.length) {
          continue;
        }
        rails.push({
          key: `${mediaType}:${railType}`,
          mediaType,
          railType,
          items: pageResult.items,
          currentPage: 1,
          hasMore: pageResult.hasMore,
          isLoading: false
        });
      }
    }

    if (!header && !rails.length) {
      return null;
    }

    const data = {
      header: header || fallbackEntityHeader(kind, normalizedId, fallbackName),
      rails
    };
    entityBrowseCache.set(cacheKey, data);
    return data;
  },

  async fetchEntityHeader({ entityKind, entityId, fallbackName = "", apiKey } = {}) {
    const kind = normalizeEntityKind(entityKind);
    const normalizedId = normalizeEntityId(entityId);
    const key = `${kind}:${normalizedId}:header`;
    if (entityHeaderCache.has(key)) {
      return entityHeaderCache.get(key);
    }

    const fallback = String(fallbackName || "").trim();
    try {
      const url = `${TMDB_BASE_URL}/${kind}/${encodeURIComponent(normalizedId)}?api_key=${encodeURIComponent(apiKey || TMDB_API_KEY)}`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        const originCountry = Array.isArray(data?.origin_country)
          ? data.origin_country.filter(Boolean).join(", ")
          : String(data?.origin_country || "").trim();
        const header = {
          id: Number(data?.id || normalizedId),
          kind,
          name: String(data?.name || fallback || "Unknown").trim() || "Unknown",
          logo: toImageUrl(data?.logo_path || data?.logo || null, "entityLogo"),
          originCountry: originCountry || null,
          secondaryLabel: String(data?.headquarters || "").trim() || null,
          description: kind === "company" ? String(data?.description || "").trim() || null : null
        };
        entityHeaderCache.set(key, header);
        return header;
      }
    } catch (error) {
      console.warn("TMDB entity header load failed", error);
    }

    if (fallback) {
      const fallbackHeader = fallbackEntityHeader(kind, normalizedId, fallback);
      entityHeaderCache.set(key, fallbackHeader);
      return fallbackHeader;
    }
    return null;
  },

  async fetchEntityRailPage({
    entityKind,
    entityId,
    mediaType,
    railType,
    language = null,
    apiKey,
    page = 1
  } = {}) {
    const kind = normalizeEntityKind(entityKind);
    const normalizedId = normalizeEntityId(entityId);
    const normalizedMediaType = mediaType === "tv" ? "tv" : "movie";
    const normalizedRailType = ENTITY_RAIL_TYPES.includes(railType) ? railType : "popular";
    const normalizedPage = Math.max(1, Number(page) || 1);
    if (!normalizedId || (kind === "network" && normalizedMediaType === "movie")) {
      return { items: [], hasMore: false };
    }

    const settings = TmdbSettingsStore.get();
    const lang = normalizeTmdbLanguageCode(language || settings.language);
    const key = `${kind}:${normalizedId}:${normalizedMediaType}:${normalizedRailType}:${lang}:${normalizedPage}`;
    if (entityRailCache.has(key)) {
      return entityRailCache.get(key);
    }

    const params = new URLSearchParams({
      api_key: String(apiKey || TMDB_API_KEY || ""),
      language: lang,
      page: String(normalizedPage),
      sort_by: entitySortBy(normalizedMediaType, normalizedRailType)
    });
    if (kind === "company") {
      params.set("with_companies", normalizedId);
    } else {
      params.set("with_networks", normalizedId);
      params.set("with_status", "0|3|4");
    }

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    if (normalizedMediaType === "tv" && (normalizedRailType === "recent" || kind === "network")) {
      params.set("first_air_date.lte", today);
    } else if (normalizedRailType === "recent") {
      params.set("primary_release_date.lte", today);
    }
    if (normalizedRailType === "top_rated") {
      params.set("vote_count.gte", String(TOP_RATED_VOTE_COUNT_FLOOR));
    }

    const result = { items: [], hasMore: false };
    try {
      const response = await fetch(`${TMDB_BASE_URL}/discover/${normalizedMediaType}?${params}`);
      if (!response.ok) {
        return result;
      }
      const data = await response.json();
      const items = (Array.isArray(data?.results) ? data.results : [])
        .map((item) => mapEntityDiscoverResult(item, normalizedMediaType))
        .filter(Boolean)
        .slice(0, ENTITY_RAIL_MAX_ITEMS);
      result.items = items;
      result.hasMore =
        normalizedPage < Number(data?.total_pages || normalizedPage) && items.length > 0;
    } catch (error) {
      console.warn("TMDB entity rail load failed", error);
    }
    if (result.items.length) {
      entityRailCache.set(key, result);
    }
    return result;
  },

  async fetchSeasonRatings({ tmdbId, seasonNumber, language = null } = {}) {
    const settings = TmdbSettingsStore.get();
    const apiKey = String(TMDB_API_KEY || "").trim();
    if (!settings.enabled || !apiKey || !tmdbId || !Number.isFinite(Number(seasonNumber))) {
      return [];
    }

    const lang = normalizeTmdbLanguageCode(language || settings.language);
    const url = `${TMDB_BASE_URL}/tv/${encodeURIComponent(String(tmdbId))}/season/${encodeURIComponent(String(seasonNumber))}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(lang)}`;
    const response = await fetch(url);
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    const episodes = Array.isArray(data?.episodes) ? data.episodes : [];
    return episodes
      .map((episode) => ({
        episode: Number(episode?.episode_number || 0),
        rating:
          typeof episode?.vote_average === "number" ? Number(episode.vote_average.toFixed(1)) : null
      }))
      .filter((item) => item.episode > 0);
  },

  async fetchEpisodeEnrichment({ tmdbId, seasonNumbers = [], language = null } = {}) {
    const settings = TmdbSettingsStore.get();
    const apiKey = String(TMDB_API_KEY || "").trim();
    if (!settings.enabled || !settings.useEpisodes || !apiKey || !tmdbId) {
      return new Map();
    }

    const lang = normalizeTmdbLanguageCode(language || settings.language);
    const seasons = [
      ...new Set(
        (Array.isArray(seasonNumbers) ? seasonNumbers : [])
          .map((season) => Number(season))
          .filter((season) => Number.isFinite(season) && season >= 0)
      )
    ];
    if (!seasons.length) {
      return new Map();
    }

    const entries = await Promise.all(
      seasons.map(async (seasonNumber) => {
        const url = `${TMDB_BASE_URL}/tv/${encodeURIComponent(String(tmdbId))}/season/${encodeURIComponent(String(seasonNumber))}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(lang)}`;
        const response = await fetch(url);
        if (!response.ok) {
          return [];
        }
        const data = await response.json();
        return (Array.isArray(data?.episodes) ? data.episodes : [])
          .map((episode) => ({
            key: `${seasonNumber}:${Number(episode?.episode_number || 0)}`,
            title: episode?.name || "",
            overview: episode?.overview || "",
            airDate: episode?.air_date || "",
            thumbnail: toImageUrl(episode?.still_path || null, "still"),
            runtime: Number(episode?.runtime || 0) || null
          }))
          .filter((episode) => !episode.key.endsWith(":0"));
      })
    );

    const map = new Map();
    entries.flat().forEach((episode) => {
      map.set(episode.key, episode);
    });
    return map;
  },

  async fetchMovieCollection({ collectionId, language = null } = {}) {
    const settings = TmdbSettingsStore.get();
    const apiKey = String(TMDB_API_KEY || "").trim();
    if (!settings.enabled || !apiKey || !collectionId) {
      return [];
    }

    const lang = normalizeTmdbLanguageCode(language || settings.language);
    const url = `${TMDB_BASE_URL}/collection/${encodeURIComponent(String(collectionId))}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(lang)}`;
    const response = await fetch(url);
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    return (Array.isArray(data?.parts) ? data.parts : [])
      .map((item) => ({
        id: item?.id ? `tmdb:${String(item.id)}` : "",
        type: "movie",
        name: item?.title || item?.name || "Untitled",
        poster: toImageUrl(item?.poster_path || null, "poster"),
        background: toImageUrl(item?.backdrop_path || null, "backdrop"),
        landscapePoster: toImageUrl(item?.backdrop_path || null, "backdrop"),
        releaseInfo: String(item?.release_date || "").slice(0, 4) || ""
      }))
      .filter((item) => item.id);
  },

  async fetchRecommendations({ tmdbId, contentType, language = null } = {}) {
    const settings = TmdbSettingsStore.get();
    const apiKey = String(TMDB_API_KEY || "").trim();
    if (!settings.enabled || !settings.useMoreLikeThis || !apiKey || !tmdbId) {
      return [];
    }

    const type = resolveType(contentType);
    const lang = normalizeTmdbLanguageCode(language || settings.language);
    const url = `${TMDB_BASE_URL}/${type}/${encodeURIComponent(String(tmdbId))}/recommendations?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(lang)}&page=1`;
    const response = await fetch(url);
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    return (Array.isArray(data?.results) ? data.results : [])
      .map((item) => ({
        id: item?.id ? `tmdb:${String(item.id)}` : "",
        type: type === "tv" ? "series" : "movie",
        name: item?.title || item?.name || "Untitled",
        poster: toImageUrl(item?.poster_path || null, "poster"),
        background: toImageUrl(item?.backdrop_path || null, "backdrop"),
        backdrop: toImageUrl(item?.backdrop_path || null, "backdrop"),
        landscapePoster: toImageUrl(item?.backdrop_path || null, "backdrop"),
        description: item?.overview || "",
        releaseInfo:
          String(type === "tv" ? item?.first_air_date || "" : item?.release_date || "").slice(
            0,
            4
          ) || "",
        tmdbRating:
          typeof item?.vote_average === "number" ? Number(item.vote_average.toFixed(1)) : null
      }))
      .filter((item) => item.id);
  }
};
