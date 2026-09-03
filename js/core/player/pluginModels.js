export const PLUGIN_STATE_VERSION = 2;

export const PLUGIN_REPOSITORY_TYPES = Object.freeze({
  NUVIO_JS: "NUVIO_JS",
  EXTERNAL_DEX: "EXTERNAL_DEX",
  LEGACY: "LEGACY",
  UNKNOWN: "UNKNOWN"
});

export const PLUGIN_PLATFORM_IDS = Object.freeze({
  WEB: "web",
  TIZEN: "tizen",
  WEBOS: "webos"
});

export const MAX_PLUGIN_REPOSITORIES = 256;
export const MAX_PLUGIN_SCRAPERS = 512;
export const MAX_MANIFEST_SCRAPERS = 128;

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function requiredManifestText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function validManifestStringList(value, fallback = []) {
  if (value === undefined) return fallback;
  if (value === null) return null;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return null;
  }
  return list(value);
}

function optionalManifestStringList(value) {
  return value == null ? [] : validManifestStringList(value);
}

/**
 * Android accepts repository inputs that use a non-HTTP scheme and normalizes
 * them to HTTPS before it performs repository detection. Keep that behavior
 * in the shared Web model so direct adds and cloud reconciliation use the same
 * canonical identity.
 */
export function sanitizePluginRepositoryInput(value) {
  const trimmed = text(value);
  const schemeEnd = trimmed.indexOf("://");
  if (schemeEnd > 0) {
    const scheme = trimmed.slice(0, schemeEnd).toLowerCase();
    if (scheme !== "http" && scheme !== "https") {
      return `https://${trimmed.slice(schemeEnd + 3)}`;
    }
  }
  return trimmed;
}

/**
 * Match Android's short-code detector. A short code is resolved through the
 * same cutt.ly redirect flow as Android before repository classification.
 */
export function isPluginShortCode(value) {
  const trimmed = text(value);
  if (!trimmed || trimmed.includes("://") || trimmed.includes("/") || trimmed.includes(".")) {
    return false;
  }
  return /^[A-Za-z0-9_-]+$/.test(trimmed);
}

export function isVideoEasyScraper(scraperId, scraperName = "", filename = "") {
  return [scraperId, scraperName, filename].some((value) =>
    String(value || "")
      .toLowerCase()
      .includes("videasy")
  );
}

const LOCAL_PLUGIN_PREFIXES = new Set(["kitsu", "anilist", "mal"]);
const ABSOLUTE_ANIME_PREFIXES = new Set(["kitsu", "mal", "anilist", "anidb"]);

/**
 * Android can execute local plugins for tracker IDs even when TMDB cannot
 * resolve the item. Keep the accepted prefixes identical to StreamRepository.
 */
export function isLocalPluginVideoId(value) {
  const prefix = text(value).split(":")[0].toLowerCase();
  return LOCAL_PLUGIN_PREFIXES.has(prefix) && text(value).toLowerCase().startsWith(`${prefix}:`);
}

export function cleanLocalPluginVideoId(value) {
  const raw = text(value);
  const parts = raw.split(":");
  const isKitsu = parts[0]?.toLowerCase() === "kitsu";
  const lastPart = parts[parts.length - 1] || "";
  return isKitsu && parts.length > 2 && parsePluginInt(lastPart) !== null
    ? parts.slice(0, -1).join(":")
    : raw;
}

function parsePluginInt(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= -2147483648 && number <= 2147483647 ? number : null;
}

function isSignedInteger(value) {
  return /^[+-]?\d+$/.test(value);
}

function isAndroidLong(value) {
  if (!isSignedInteger(value)) return false;
  const negative = String(value).startsWith("-");
  const digits = String(value).replace(/^[+-]/, "").replace(/^0+/, "") || "0";
  const limit = negative ? "9223372036854775808" : "9223372036854775807";
  return digits.length < limit.length || (digits.length === limit.length && digits <= limit);
}

export function absoluteAnimeEpisodeNumber(value) {
  const parts = text(value).split(":");
  if (parts.length !== 3) return null;
  const prefix = parts[0].toLowerCase();
  if (!ABSOLUTE_ANIME_PREFIXES.has(prefix)) return null;
  if (!isAndroidLong(parts[1]) || !isSignedInteger(parts[2])) return null;
  return parsePluginInt(parts[2]);
}

export function resolvePluginSeasonEpisode(videoId, season, episode) {
  const absolute = absoluteAnimeEpisodeNumber(videoId);
  return absolute == null ? { season, episode } : { season: null, episode: absolute };
}

function list(value) {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,;]+/)
      : [];
  return values
    .map((entry) => text(entry).toLowerCase())
    .filter(Boolean)
    .filter((entry, index, entries) => entries.indexOf(entry) === index);
}

export function normalizePluginRepositoryType(value, fallback = PLUGIN_REPOSITORY_TYPES.UNKNOWN) {
  const normalized = text(value)
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (normalized === PLUGIN_REPOSITORY_TYPES.NUVIO_JS || normalized === "JS") {
    return PLUGIN_REPOSITORY_TYPES.NUVIO_JS;
  }
  if (
    normalized === PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX ||
    normalized === "DEX" ||
    normalized === "CLOUDSTREAM" ||
    normalized === "CLOUDSTREAM_DEX" ||
    normalized === "EXTERNAL"
  ) {
    return PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX;
  }
  if (normalized === PLUGIN_REPOSITORY_TYPES.LEGACY || normalized === "URL_TEMPLATE") {
    return PLUGIN_REPOSITORY_TYPES.LEGACY;
  }
  return fallback;
}

/**
 * DEX repositories are metadata-only on Web TV, including legacy rows whose
 * type was not persisted correctly but whose URL is unambiguously a .cs3
 * artifact. Keep this predicate centralized so every mutation path protects
 * the Android-owned repository without changing its synced enabled value.
 */
export function isExternalDexRepository(repository) {
  return (
    normalizePluginRepositoryType(repository?.type) === PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX ||
    /\.cs3(?:$|[?#])/i.test(String(repository?.url || ""))
  );
}

function stripDefaultPort(url) {
  try {
    const parsed = new URL(url);
    if (
      (parsed.protocol === "http:" && parsed.port === "80") ||
      (parsed.protocol === "https:" && parsed.port === "443")
    ) {
      parsed.port = "";
    }
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch (_) {
    return String(url || "")
      .trim()
      .replace(/[?#].*$/, "")
      .replace(/\/$/, "");
  }
}

export function canonicalizePluginUrl(value, { manifest = false } = {}) {
  const raw = sanitizePluginRepositoryInput(value);
  if (!raw) {
    return "";
  }
  const normalized = stripDefaultPort(raw);
  if (!normalized) {
    return "";
  }
  if (manifest) {
    try {
      const parsed = new URL(normalized);
      if (/\.json$/i.test(parsed.pathname)) {
        return parsed.toString().replace(/\/$/, "");
      }
      parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/manifest.json`;
      return parsed.toString().replace(/\/$/, "");
    } catch (_) {
      if (/\.json(?:[?#].*)?$/i.test(normalized)) {
        return normalized;
      }
      return `${normalized.replace(/\/$/, "")}/manifest.json`;
    }
  }
  return normalized;
}

export function resolvePluginUrl(value, baseUrl = "") {
  const raw = text(value);
  if (!raw) {
    return "";
  }
  try {
    return new URL(raw, baseUrl || undefined).toString();
  } catch (_) {
    return raw;
  }
}

export function stablePluginHash(value) {
  // Keep IDs deterministic without relying on array positions. Two independent
  // 32-bit hashes make accidental collisions materially less likely while
  // remaining compatible with the old TV JavaScript engines.
  let first = 2166136261;
  let second = 2246822519;
  const input = String(value || "");
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 16777619);
    second ^= code + 0x9e3779b9;
    second = Math.imul(second, 3266489917);
  }
  return `${(first >>> 0).toString(36).padStart(7, "0")}-${(second >>> 0).toString(36).padStart(7, "0")}`;
}

export function safePluginId(value, fallback = "plugin", maxLength = 128) {
  const normalized = text(value, fallback)
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, Math.max(16, Number(maxLength) || 128));
  return normalized || fallback;
}

export function randomPluginUuid() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    try {
      return cryptoApi.randomUUID();
    } catch (_) {
      // Fall through to the portable UUID implementation below.
    }
  }

  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === "function") {
    try {
      cryptoApi.getRandomValues(bytes);
    } catch (_) {
      // Some older TV WebViews expose crypto but not getRandomValues.
    }
  }
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 0) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join("-");
}

export function repositoryIdForUrl(url) {
  return `repo_${stablePluginHash(canonicalizePluginUrl(url))}`;
}

/**
 * Android's Nuvio JS scraper identity is the local repository UUID followed
 * by the manifest provider id. Keep this separate from the legacy deterministic
 * helper used when normalizing old Smart state.
 */
export function androidJsScraperId(repositoryId, manifestId) {
  const repository = String(repositoryId || "").trim() || "repository";
  const provider = String(manifestId || "").trim() || "scraper";
  return `${repository}:${provider}`;
}

export function scraperIdForManifest(repositoryId, manifestId, filename = "scraper") {
  const base = safePluginId(manifestId, safePluginId(filename, "scraper"));
  const suffix = stablePluginHash(`${manifestId || ""}\n${filename || ""}`);
  const prefix = `${safePluginId(repositoryId, "repo")}_`;
  const maxBaseLength = Math.max(1, 128 - prefix.length - suffix.length - 2);
  return `${prefix}${base.slice(0, maxBaseLength)}_${suffix}`;
}

export function pluginSupportsType(supportedTypes, mediaType) {
  const target = text(mediaType).toLowerCase();
  const targets =
    target === "series"
      ? ["series", "tv", "anime"]
      : target === "other"
        ? ["other", "tv"]
        : [target];
  return list(supportedTypes).some((entry) => targets.includes(entry));
}

export function normalizePluginManifest(raw, manifestUrl = "") {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const name = requiredManifestText(raw.name);
  const version = requiredManifestText(raw.version);
  if (!name || !version || !Array.isArray(raw.scrapers)) {
    return null;
  }
  if (
    (raw.description != null && typeof raw.description !== "string") ||
    (raw.author != null && typeof raw.author !== "string")
  ) {
    return null;
  }
  const scrapers = raw.scrapers.slice(0, MAX_MANIFEST_SCRAPERS);
  const normalizedScrapers = [];
  const seen = new Set();
  let invalidScraper = false;
  scrapers.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      invalidScraper = true;
      return;
    }
    const id = requiredManifestText(entry.id);
    const scraperName = requiredManifestText(entry.name);
    const scraperVersion = requiredManifestText(entry.version);
    const filename = requiredManifestText(entry.filename);
    if (!id || !scraperName || !scraperVersion || !filename) {
      invalidScraper = true;
      return;
    }
    const supportedTypes = validManifestStringList(entry.supportedTypes, ["movie", "tv"]);
    const contentLanguage = optionalManifestStringList(entry.contentLanguage);
    const supportedPlatforms = optionalManifestStringList(entry.supportedPlatforms);
    const disabledPlatforms = optionalManifestStringList(entry.disabledPlatforms);
    const formats = optionalManifestStringList(entry.formats);
    if (
      !supportedTypes ||
      !contentLanguage ||
      !supportedPlatforms ||
      !disabledPlatforms ||
      !formats ||
      (entry.description != null && typeof entry.description !== "string") ||
      (entry.logo != null && typeof entry.logo !== "string") ||
      (entry.enabled !== undefined && typeof entry.enabled !== "boolean")
    ) {
      invalidScraper = true;
      return;
    }
    // Android treats the manifest id as the provider identity. Keep the first
    // declaration when a malformed manifest repeats that id with another
    // filename; otherwise the same provider could receive two user toggles.
    const key = id.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    normalizedScrapers.push({
      ...entry,
      id,
      name: scraperName,
      description: text(entry.description),
      version: scraperVersion,
      filename,
      supportedTypes,
      enabled: entry.enabled === undefined ? true : entry.enabled,
      logo: resolvePluginUrl(entry.logo, manifestUrl) || null,
      contentLanguage,
      supportedPlatforms,
      disabledPlatforms,
      formats,
      codeUrl: resolvePluginUrl(filename, manifestUrl)
    });
  });
  if (invalidScraper) {
    return null;
  }
  return {
    ...raw,
    name,
    version,
    description: text(raw.description),
    author: text(raw.author),
    scrapers: normalizedScrapers
  };
}

export function normalizeExternalRepositoryMetadata(raw, sourceUrl = "") {
  if (Array.isArray(raw)) {
    const plugins = raw.filter((entry) => entry && typeof entry === "object").slice(0, 512);
    if (!plugins.length) return null;
    return {
      name: text(sourceUrl.split("/").pop()?.split("?")[0], "CloudStream repository").replace(
        /\.json$/i,
        ""
      ),
      description: "",
      manifestVersion: 1,
      pluginLists: [],
      plugins
    };
  }
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const pluginLists = Array.isArray(raw.pluginLists)
    ? raw.pluginLists.map((entry) => resolvePluginUrl(entry, sourceUrl)).filter(Boolean)
    : [];
  const plugins = Array.isArray(raw.plugins)
    ? raw.plugins.filter((entry) => entry && typeof entry === "object").slice(0, 512)
    : [];
  if (!pluginLists.length && !plugins.length) {
    return null;
  }
  return {
    ...raw,
    name: text(raw.name || raw.title, "CloudStream repository"),
    description: text(raw.description),
    manifestVersion: Number(raw.manifestVersion || 1) || 1,
    pluginLists,
    plugins
  };
}

export function createLegacySource(source = {}) {
  const url = text(source.urlTemplate || source.url || source.url_template);
  const explicitIdentity = text(source.id || source.name);
  const identity = url || explicitIdentity || stablePluginHash(JSON.stringify(source));
  return {
    ...source,
    id: `legacy_${stablePluginHash(identity)}`,
    name: text(source.name, "Legacy source"),
    urlTemplate: url,
    enabled: source.enabled !== false,
    source: "legacy-url-template",
    executable: false
  };
}

export function createDefaultPluginState() {
  return {
    schemaVersion: PLUGIN_STATE_VERSION,
    repositories: [],
    scrapers: [],
    settings: {
      pluginsEnabled: true,
      groupStreamsByRepository: false,
      scraperSettings: {}
    },
    legacySources: [],
    unknownRemoteRows: [],
    rawRemoteRows: [],
    syncDirty: false,
    runtime: {
      lastStatus: "unknown",
      lastError: "",
      lastCheckedAt: 0
    }
  };
}

export function normalizePluginState(raw) {
  const base = createDefaultPluginState();
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const repositoryUrls = new Set();
  const repositoryIds = new Set();
  const repositories = Array.isArray(value.repositories)
    ? value.repositories
        .slice(0, MAX_PLUGIN_REPOSITORIES)
        .map((entry, index) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const url = canonicalizePluginUrl(entry.url || entry.manifestUrl || entry.manifest_url);
          if (!url) {
            return null;
          }
          const declaredType = normalizePluginRepositoryType(
            entry.type || entry.repoType || entry.repo_type
          );
          const type = /\.cs3(?:$|[?#])/i.test(url)
            ? PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX
            : declaredType;
          const id = safePluginId(entry.id, repositoryIdForUrl(url));
          const urlKey = url.toLowerCase();
          const idKey = id.toLowerCase();
          if (repositoryUrls.has(urlKey) || repositoryIds.has(idKey)) return null;
          repositoryUrls.add(urlKey);
          repositoryIds.add(idKey);
          return {
            ...entry,
            id,
            name: text(entry.name, `Repository ${index + 1}`),
            url,
            description: text(entry.description),
            enabled: entry.enabled !== false,
            type,
            lastUpdated: Number(entry.lastUpdated || entry.last_updated || 0) || 0,
            scraperCount: Math.max(
              0,
              Math.trunc(Number(entry.scraperCount || entry.scraper_count || 0) || 0)
            ),
            metadata: entry.metadata && typeof entry.metadata === "object" ? entry.metadata : null
          };
        })
        .filter(Boolean)
    : [];
  const scraperById = new Map();
  const scraperIdentityKeys = new Set();
  const scrapers = Array.isArray(value.scrapers)
    ? value.scrapers
        .slice(0, MAX_PLUGIN_SCRAPERS)
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const repositoryId = safePluginId(entry.repositoryId || entry.repository_id, "repo");
          const identity =
            entry.manifestId ||
            entry.manifest_id ||
            entry.filename ||
            entry.sourceUrl ||
            entry.name ||
            stablePluginHash(JSON.stringify(entry));
          const identityKey =
            `${repositoryId}\n${identity}\n${entry.filename || entry.sourceUrl || ""}`.toLowerCase();
          if (scraperIdentityKeys.has(identityKey)) {
            return null;
          }
          scraperIdentityKeys.add(identityKey);
          // Preserve persisted IDs verbatim because they key the code and
          // settings stores. Newly normalized rows use Android's JS identity;
          // deterministic fallback IDs remain only for legacy repositories
          // whose data predates the Android-compatible identity.
          let id = text(entry.id) || androidJsScraperId(repositoryId, identity);
          if (scraperById.has(id)) {
            id = androidJsScraperId(
              repositoryId,
              `${identity}_${stablePluginHash(JSON.stringify(entry))}`
            );
          }
          if (scraperById.has(id)) {
            id = `${id}_${stablePluginHash(JSON.stringify(entry))}`;
          }
          const repository = repositories.find((candidate) => candidate.id === repositoryId);
          const repositoryType = repository?.type || PLUGIN_REPOSITORY_TYPES.NUVIO_JS;
          const declaredType = entry.type ?? entry.repoType ?? entry.repo_type;
          const scraperType =
            repositoryType === PLUGIN_REPOSITORY_TYPES.NUVIO_JS
              ? normalizePluginRepositoryType(declaredType, PLUGIN_REPOSITORY_TYPES.NUVIO_JS)
              : repositoryType;
          const normalized = {
            ...entry,
            id,
            repositoryId,
            name: text(entry.name, id),
            description: text(entry.description),
            version: text(entry.version, "1"),
            filename: text(entry.filename),
            supportedTypes: list(entry.supportedTypes || entry.supported_types || ["movie", "tv"]),
            enabled: entry.enabled !== false,
            manifestEnabled: entry.manifestEnabled !== false,
            logo: text(entry.logo) || null,
            contentLanguage: list(entry.contentLanguage || entry.content_language),
            supportedPlatforms: list(entry.supportedPlatforms || entry.supported_platforms),
            disabledPlatforms: list(entry.disabledPlatforms || entry.disabled_platforms),
            formats: list(entry.formats || entry.supportedFormats || entry.supported_formats),
            type: scraperType,
            manifestId: text(entry.manifestId || entry.manifest_id),
            codeUrl: text(entry.codeUrl || entry.code_url)
          };
          if (scraperById.has(id)) {
            return null;
          }
          scraperById.set(id, true);
          return normalized;
        })
        .filter(Boolean)
    : [];
  const legacyInput = Array.isArray(value.legacySources) ? value.legacySources : [];
  const settings = value.settings && typeof value.settings === "object" ? value.settings : {};
  const scraperSettings =
    settings.scraperSettings &&
    typeof settings.scraperSettings === "object" &&
    !Array.isArray(settings.scraperSettings)
      ? settings.scraperSettings
      : {};
  return {
    ...base,
    ...value,
    schemaVersion: PLUGIN_STATE_VERSION,
    repositories,
    scrapers,
    settings: {
      ...base.settings,
      ...settings,
      pluginsEnabled: settings.pluginsEnabled !== false,
      groupStreamsByRepository: settings.groupStreamsByRepository === true,
      scraperSettings
    },
    legacySources: legacyInput.map((entry, index) => createLegacySource(entry, index)),
    unknownRemoteRows: Array.isArray(value.unknownRemoteRows)
      ? value.unknownRemoteRows.slice(0, MAX_PLUGIN_REPOSITORIES)
      : [],
    rawRemoteRows: Array.isArray(value.rawRemoteRows)
      ? value.rawRemoteRows.slice(0, MAX_PLUGIN_REPOSITORIES)
      : [],
    syncDirty: value.syncDirty === true,
    runtime: {
      ...base.runtime,
      ...(value.runtime && typeof value.runtime === "object" ? value.runtime : {})
    }
  };
}

export function isExecutablePluginRepository(repository) {
  return (
    normalizePluginRepositoryType(repository?.type) === PLUGIN_REPOSITORY_TYPES.NUVIO_JS &&
    !/\.cs3(?:$|[?#])/i.test(String(repository?.url || ""))
  );
}

export function isExecutableScraper(scraper, repository, platformId = "") {
  if (
    !isExecutablePluginRepository(repository) ||
    normalizePluginRepositoryType(scraper?.type) !== PLUGIN_REPOSITORY_TYPES.NUVIO_JS
  ) {
    return false;
  }
  if (scraper?.enabled === false) {
    return false;
  }
  // Android currently persists manifest/platform flags as metadata but does
  // not gate execution on them. Preserve the fields for display/sync while
  // matching Android's actual JS behavior.
  void platformId;
  return true;
}
