import {
  normalizeTmdbLanguageCode,
  TmdbSettingsStore
} from "../../data/local/tmdbSettingsStore.js";
import { TMDB_API_KEY } from "../../config.js";
import { tmdbShowReleaseInfo, tmdbYearPart } from "../util/tmdbReleaseRange.js";

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
const TMDB_ENGLISH_CREDIT_LANGUAGE = "en-US";
const NATIVE_PERSON_NAME_LANGUAGES = new Set(["ja", "ko", "zh"]);
const TMDB_RECOMMENDATION_MAX_ITEMS = 12;
const TMDB_LANGUAGE_DEFAULT_REGIONS = Object.freeze({
  ar: "SA",
  bg: "BG",
  bs: "BA",
  cs: "CZ",
  da: "DK",
  de: "DE",
  el: "GR",
  es: "ES",
  et: "EE",
  fi: "FI",
  fr: "FR",
  he: "IL",
  hi: "IN",
  hr: "HR",
  hu: "HU",
  id: "ID",
  it: "IT",
  ja: "JP",
  ko: "KR",
  lt: "LT",
  lv: "LV",
  nl: "NL",
  no: "NO",
  pl: "PL",
  pt: "PT",
  ro: "RO",
  ru: "RU",
  sk: "SK",
  sl: "SI",
  sr: "RS",
  sv: "SE",
  th: "TH",
  tr: "TR",
  uk: "UA",
  vi: "VN",
  zh: "CN"
});
const entityHeaderCache = new Map();
const entityRailCache = new Map();
const entityBrowseCache = new Map();
const moreLikeThisCache = new Map();

function resolveType(contentType) {
  const normalized = String(contentType || "").toLowerCase();
  if (normalized === "series" || normalized === "tv" || normalized === "show") {
    return "tv";
  }
  return "movie";
}

function languageBase(language = "") {
  return normalizeTmdbLanguageCode(language).split("-", 1)[0].toLowerCase();
}

function normalizeMoreLikeThisLanguage(language = "") {
  const normalized = normalizeTmdbLanguageCode(language);
  // Android maps the synthetic Spanish Latin-America locale to TMDB's
  // concrete Mexico locale before making recommendation/image requests.
  return normalized === "es-419" ? "es-MX" : normalized;
}

export function containsCjkOrHangul(text = "") {
  for (const character of String(text || "")) {
    const codePoint = character.codePointAt(0) || 0;
    if (
      (codePoint >= 0x1100 && codePoint <= 0x11ff) ||
      (codePoint >= 0x2e80 && codePoint <= 0x2fff) ||
      (codePoint >= 0x3040 && codePoint <= 0x30ff) ||
      (codePoint >= 0x3130 && codePoint <= 0x318f) ||
      (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
      (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7af) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xa960 && codePoint <= 0xa97f) ||
      (codePoint >= 0xd7b0 && codePoint <= 0xd7ff)
    ) {
      return true;
    }
  }
  return false;
}

export function resolvePersonName({
  localizedName = "",
  originalName = "",
  fallbackEnglishName = "",
  preferredLanguage = "en"
} = {}) {
  const name = String(localizedName || "").trim();
  const original = String(originalName || "").trim();
  const fallback = String(fallbackEnglishName || "").trim();
  const language = languageBase(preferredLanguage);

  if (!name) {
    return original || fallback || null;
  }
  if (NATIVE_PERSON_NAME_LANGUAGES.has(language)) {
    return name;
  }
  if (!containsCjkOrHangul(name)) {
    return name;
  }
  if (original && !containsCjkOrHangul(original)) {
    return original;
  }
  if (fallback && !containsCjkOrHangul(fallback)) {
    return fallback;
  }
  return fallback || original || name;
}

function resolveDisplayLabel({
  localized = "",
  original = "",
  fallbackEnglish = "",
  preferredLanguage = "en"
} = {}) {
  const name = String(localized || "").trim();
  const originalLabel = String(original || "").trim();
  const fallback = String(fallbackEnglish || "").trim();
  if (!name) {
    return originalLabel || fallback || null;
  }

  const language = languageBase(preferredLanguage);
  if (NATIVE_PERSON_NAME_LANGUAGES.has(language)) {
    return name;
  }
  if (!containsCjkOrHangul(name)) {
    return name;
  }
  if (originalLabel && !containsCjkOrHangul(originalLabel)) {
    return originalLabel;
  }
  if (fallback && !containsCjkOrHangul(fallback)) {
    return fallback;
  }
  return fallback || originalLabel || name;
}

function needsEnglishPersonNameFallback(data = {}, language = "en") {
  const normalizedLanguage = languageBase(language);
  if (!normalizedLanguage || normalizedLanguage === "en") {
    return false;
  }
  if (NATIVE_PERSON_NAME_LANGUAGES.has(normalizedLanguage)) {
    return false;
  }

  const people = [
    ...(Array.isArray(data?.credits?.cast) ? data.credits.cast : []),
    ...(Array.isArray(data?.credits?.crew) ? data.credits.crew : []),
    ...(Array.isArray(data?.created_by) ? data.created_by : [])
  ];
  return people.some((person) => {
    const name = String(person?.name || "").trim();
    const original = String(person?.original_name || "").trim();
    return Boolean(
      name && containsCjkOrHangul(name) && (!original || containsCjkOrHangul(original))
    );
  });
}

function addEnglishPersonNames(target, people = []) {
  (Array.isArray(people) ? people : []).forEach((person) => {
    const id = String(person?.id || "").trim();
    const name = String(person?.name || "").trim();
    if (id && name) {
      target.set(id, name);
    }
  });
}

async function fetchEnglishPersonNames({ type, tmdbId, apiKey, data, language } = {}) {
  if (!needsEnglishPersonNameFallback(data, language)) {
    return new Map();
  }

  try {
    const params = `api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(TMDB_ENGLISH_CREDIT_LANGUAGE)}&append_to_response=credits`;
    const url = `${TMDB_BASE_URL}/${type}/${encodeURIComponent(String(tmdbId))}?${params}`;
    const response = await fetch(url);
    if (!response.ok) {
      return new Map();
    }
    const englishData = await response.json();
    const names = new Map();
    addEnglishPersonNames(names, englishData?.credits?.cast);
    addEnglishPersonNames(names, englishData?.credits?.crew);
    addEnglishPersonNames(names, englishData?.created_by);
    return names;
  } catch (error) {
    console.warn("TMDB English person-name fallback failed", error);
    return new Map();
  }
}

async function fetchEnglishTitle({ type, tmdbId, apiKey } = {}) {
  const params = `api_key=${encodeURIComponent(apiKey)}&language=en`;
  const url = `${TMDB_BASE_URL}/${type}/${encodeURIComponent(String(tmdbId))}?${params}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return "";
    }
    const data = await response.json();
    return String(data?.title || data?.name || "")
      .trim()
      .replace(/\s+/g, " ");
  } catch (error) {
    console.warn("TMDB English title fallback failed", error);
    return "";
  }
}

function resolveCreditEntries(items, englishNames, language) {
  if (!Array.isArray(items)) {
    return items;
  }
  return items.map((item) => {
    const name = resolvePersonName({
      localizedName: item?.name,
      originalName: item?.original_name,
      fallbackEnglishName: englishNames.get(String(item?.id || "")),
      preferredLanguage: language
    });
    return name && name !== item?.name ? { ...item, name } : item;
  });
}

function resolveCredits(credits, englishNames, language) {
  if (!credits || typeof credits !== "object") {
    return credits || null;
  }
  return {
    ...credits,
    ...(Array.isArray(credits.cast)
      ? { cast: resolveCreditEntries(credits.cast, englishNames, language) }
      : {}),
    ...(Array.isArray(credits.crew)
      ? { crew: resolveCreditEntries(credits.crew, englishNames, language) }
      : {})
  };
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

function selectBestLocalizedImagePath(images = [], normalizedLanguage = "en") {
  const entries = Array.isArray(images) ? images : [];
  if (!entries.length) {
    return null;
  }

  const languageCode = String(normalizedLanguage || "en")
    .split("-", 1)[0]
    .toLowerCase();
  const explicitRegion = String(normalizedLanguage || "")
    .split("-", 2)[1]
    ?.toUpperCase();
  const regionCode =
    explicitRegion?.length === 2
      ? explicitRegion
      : TMDB_LANGUAGE_DEFAULT_REGIONS[languageCode] ||
        (languageCode === "pt" ? "PT" : languageCode === "es" ? "ES" : "");

  return (
    entries
      .map((image, index) => {
        const imageLanguage = String(image?.iso_639_1 || "").toLowerCase();
        const imageRegion = String(image?.iso_3166_1 || "").toUpperCase();
        const priority =
          imageLanguage === languageCode && imageRegion === regionCode
            ? 5
            : imageLanguage === languageCode && !imageRegion
              ? 4
              : imageLanguage === languageCode
                ? 3
                : imageLanguage === "en"
                  ? 2
                  : !imageLanguage
                    ? 1
                    : 0;
        return { image, index, priority };
      })
      .sort((left, right) => right.priority - left.priority || left.index - right.index)[0]?.image
      ?.file_path || null
  );
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

async function fetchTmdbImages({ type, tmdbId, apiKey, includeImageLanguage }) {
  const url = `${TMDB_BASE_URL}/${type}/${encodeURIComponent(String(tmdbId))}/images?api_key=${encodeURIComponent(apiKey)}&include_image_language=${encodeURIComponent(includeImageLanguage)}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch (_error) {
    return null;
  }
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

async function fetchTmdbShowDetails({ tmdbId, apiKey, language }) {
  const url = `${TMDB_BASE_URL}/tv/${encodeURIComponent(String(tmdbId))}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(language)}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch (_error) {
    return null;
  }
}

async function resolveRecommendationReleaseInfo(item, { type, apiKey, language }) {
  if (type !== "tv") {
    return String(item?.release_date || "").slice(0, 4) || "";
  }

  const startYear = tmdbYearPart(item?.first_air_date);
  if (startYear == null) {
    return "";
  }

  const details = await fetchTmdbShowDetails({
    tmdbId: item?.id,
    apiKey,
    language
  });
  return tmdbShowReleaseInfo(item?.first_air_date, details?.last_air_date, details?.status) || "";
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
    const lang = normalizeMoreLikeThisLanguage(language || settings.language);
    const imageLanguages = buildTmdbImageLanguageFilter(lang);
    const params = `api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(lang)}&append_to_response=images,credits,release_dates,content_ratings,videos,external_ids&include_image_language=${encodeURIComponent(imageLanguages)}`;
    const url = `${TMDB_BASE_URL}/${type}/${encodeURIComponent(String(tmdbId))}?${params}`;

    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const englishPersonNames = await fetchEnglishPersonNames({
      type,
      tmdbId,
      apiKey,
      data,
      language: lang
    });
    const resolvedCredits = resolveCredits(data?.credits, englishPersonNames, lang);
    const logoPath = selectBestLocalizedLogoPath(data?.images?.logos, lang);
    const releaseInfoValue =
      type === "tv"
        ? tmdbShowReleaseInfo(data.first_air_date, data.last_air_date, data.status)
        : String(data.release_date || "").slice(0, 4);
    const companies = mapCompanies(data?.production_companies);
    const networks = mapCompanies(data?.networks);
    const spokenLanguage = Array.isArray(data?.spoken_languages) ? data.spoken_languages[0] : null;
    const productionCountryValue = Array.isArray(data?.production_countries)
      ? data.production_countries
          .map((item) => item?.iso_3166_1 || "")
          .filter(Boolean)
          .join(", ")
      : "";
    const originCountryValue =
      Array.isArray(data?.origin_country) && data.origin_country.length
        ? data.origin_country.join(", ")
        : "";
    const countryValue = productionCountryValue || originCountryValue;
    const rawLocalizedTitle = String(data?.title || data?.name || "").trim();
    const originalTitle = String(data?.original_title || data?.original_name || "").trim();
    const originalLanguage = String(data?.original_language || "")
      .trim()
      .toLowerCase();
    const droppedUntranslatedTitle =
      rawLocalizedTitle &&
      originalTitle &&
      rawLocalizedTitle === originalTitle &&
      !lang.startsWith("en") &&
      originalLanguage &&
      !lang.startsWith(originalLanguage);
    let localizedTitle = droppedUntranslatedTitle ? "" : rawLocalizedTitle;
    const isCjkLanguage = ["ja", "ko", "zh"].includes(languageBase(lang));
    if (lang !== "en" && !isCjkLanguage && containsCjkOrHangul(localizedTitle || originalTitle)) {
      const englishTitle = await fetchEnglishTitle({ type, tmdbId, apiKey });
      localizedTitle =
        resolveDisplayLabel({
          localized: rawLocalizedTitle,
          original: originalTitle,
          fallbackEnglish: englishTitle,
          preferredLanguage: lang
        }) || "";
    }
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
      localizedTitle: localizedTitle || null,
      description: data.overview || null,
      backdrop: toImageUrl(data.backdrop_path, "backdrop"),
      poster: toImageUrl(data.poster_path, "poster"),
      logo: toImageUrl(logoPath, "logo"),
      genres: Array.isArray(data.genres)
        ? data.genres.map((genre) => genre.name).filter(Boolean)
        : [],
      rating: typeof data.vote_average === "number" ? data.vote_average : null,
      releaseInfo: releaseInfoValue || null,
      released: type === "tv" ? data.first_air_date || null : data.release_date || null,
      runtime: Number.isFinite(runtimeValue) && runtimeValue > 0 ? `${runtimeValue} min` : null,
      status: data?.status || null,
      ageRating: selectAgeRating(data, type),
      country: countryValue || null,
      language: spokenLanguage?.iso_639_1 || spokenLanguage?.english_name || null,
      originalLanguage: data?.original_language || null,
      imdbId: data?.external_ids?.imdb_id || null,
      credits: resolvedCredits,
      companies,
      productionCompanies: companies,
      networks,
      trailers,
      trailerYtIds: trailers.map((entry) => entry.ytId).filter(Boolean),
      collectionId: data?.belongs_to_collection?.id ? String(data.belongs_to_collection.id) : null,
      collectionName: data?.belongs_to_collection?.name || null
    };
  },

  // Post-play uses the same dedicated trailer phase as Android's
  // TrailerService. It intentionally does not require TMDB enrichment to be
  // enabled or the `useTrailers` enrichment toggle to be on: the caller has
  // already passed the post-play/in-app-trailer feature gate.
  async fetchTrailerCandidates({ tmdbId, contentType, language = null } = {}) {
    const apiKey = String(TMDB_API_KEY || "").trim();
    const numericId = String(tmdbId || "").trim();
    if (!apiKey || !/^\d+$/.test(numericId)) {
      return [];
    }
    const type = resolveType(contentType);
    const settings = TmdbSettingsStore.get();
    const lang = normalizeMoreLikeThisLanguage(
      language || settings.language || TMDB_TRAILER_FALLBACK_LANGUAGE
    );
    try {
      const candidates = await resolveTrailerCandidates({
        type,
        tmdbId: numericId,
        apiKey,
        language: lang
      });
      return mapTrailerCandidates(candidates);
    } catch (error) {
      console.warn("TMDB post-play trailer lookup failed", error);
      return [];
    }
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

  async fetchMoreLikeThis({
    tmdbId,
    contentType,
    language = null,
    maxItems = TMDB_RECOMMENDATION_MAX_ITEMS
  } = {}) {
    const settings = TmdbSettingsStore.get();
    const apiKey = String(TMDB_API_KEY || "").trim();
    const numericId = String(tmdbId || "").trim();
    if (!settings.enabled || !settings.useMoreLikeThis || !apiKey || !/^\d+$/.test(numericId)) {
      return [];
    }

    const type = resolveType(contentType);
    const normalizedLanguage = normalizeMoreLikeThisLanguage(language || settings.language);
    const itemLimit = Math.max(1, Number(maxItems) || 1);
    const cacheKey = `${numericId}:${type}:${normalizedLanguage}:more_like:${itemLimit}`;
    if (moreLikeThisCache.has(cacheKey)) {
      return moreLikeThisCache.get(cacheKey);
    }

    const includeImageLanguage = [
      languageBase(normalizedLanguage),
      normalizedLanguage,
      "en",
      "null"
    ].join(",");
    const url = `${TMDB_BASE_URL}/${type}/${encodeURIComponent(numericId)}/recommendations?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(normalizedLanguage)}&page=1`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        return [];
      }
      const data = await response.json();
      const rawResults = (Array.isArray(data?.results) ? data.results : []).filter(
        (item) => Number(item?.id) > 0
      );
      const preferredLanguage = languageBase(normalizedLanguage);
      const isLocalized = (item) =>
        String(item?.original_language || "")
          .trim()
          .toLowerCase() === preferredLanguage;
      const voteCount = (item) => {
        const value = Number(item?.vote_count);
        return Number.isFinite(value) ? value : 0;
      };
      const voteAverage = (item) => {
        const value = Number(item?.vote_average);
        return Number.isFinite(value) ? value : 0;
      };
      const sortedResults = [...rawResults].sort(
        (left, right) =>
          Number(isLocalized(right)) - Number(isLocalized(left)) ||
          voteCount(right) - voteCount(left) ||
          voteAverage(right) - voteAverage(left)
      );
      const qualityFilteredResults = sortedResults.filter(
        (item) => isLocalized(item) || voteCount(item) >= 20 || voteAverage(item) >= 6
      );
      const recommendationResults = (
        qualityFilteredResults.length ? qualityFilteredResults : sortedResults
      ).slice(0, itemLimit);

      const items = (
        await Promise.all(
          recommendationResults.map(async (item) => {
            const recommendationType = ["tv", "movie"].includes(
              String(item?.media_type || "")
                .trim()
                .toLowerCase()
            )
              ? String(item.media_type).trim().toLowerCase()
              : type;
            const recommendationContentType = recommendationType === "tv" ? "series" : "movie";
            const title = [item?.title, item?.name, item?.original_title, item?.original_name]
              .map((value) => String(value || "").trim())
              .find(Boolean);
            if (!title) {
              return null;
            }

            const images = await fetchTmdbImages({
              type: recommendationType,
              tmdbId: item.id,
              apiKey,
              includeImageLanguage
            });
            const localizedBackdropPath = selectBestLocalizedImagePath(
              images?.backdrops,
              normalizedLanguage
            );
            const backdrop = toImageUrl(localizedBackdropPath || item?.backdrop_path, "backdrop");
            const fallbackPoster = toImageUrl(item?.poster_path, "entityBackdrop");
            const releaseInfo = await resolveRecommendationReleaseInfo(item, {
              type: recommendationType,
              apiKey,
              language: normalizedLanguage
            });
            const description =
              typeof item?.overview === "string" && item.overview.trim() ? item.overview : null;
            const rating = typeof item?.vote_average === "number" ? item.vote_average : null;

            return {
              id: `tmdb:${String(item.id)}`,
              type: recommendationContentType,
              apiType: recommendationContentType,
              name: title,
              title,
              poster: backdrop || fallbackPoster,
              rawPosterUrl: fallbackPoster,
              posterShape: "landscape",
              background: backdrop,
              backdrop,
              landscapePoster: backdrop,
              logo: null,
              description,
              releaseInfo,
              imdbRating: rating,
              genres: []
            };
          })
        )
      ).filter(Boolean);

      moreLikeThisCache.set(cacheKey, items);
      return items;
    } catch (error) {
      console.warn("TMDB post-play recommendations failed", error);
      return [];
    }
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
    const recommendationResults = (Array.isArray(data?.results) ? data.results : [])
      .filter((item) => Number(item?.id) > 0)
      .slice(0, TMDB_RECOMMENDATION_MAX_ITEMS);
    const items = await Promise.all(
      recommendationResults.map(async (item) => ({
        id: item?.id ? `tmdb:${String(item.id)}` : "",
        type: type === "tv" ? "series" : "movie",
        name: item?.title || item?.name || "Untitled",
        poster: toImageUrl(item?.poster_path || null, "poster"),
        background: toImageUrl(item?.backdrop_path || null, "backdrop"),
        backdrop: toImageUrl(item?.backdrop_path || null, "backdrop"),
        landscapePoster: toImageUrl(item?.backdrop_path || null, "backdrop"),
        description: item?.overview || "",
        releaseInfo: await resolveRecommendationReleaseInfo(item, {
          type,
          apiKey,
          language: lang
        }),
        tmdbRating:
          typeof item?.vote_average === "number" ? Number(item.vote_average.toFixed(1)) : null
      }))
    );
    return items.filter((item) => item.id);
  }
};
