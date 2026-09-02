import { createProfileScopedStore } from "./profileScopedStore.js";
import { getEffectivePluginProfileId } from "./pluginStore.js";
import { safePluginId, stablePluginHash } from "../../core/player/pluginModels.js";

const CACHE_KEY = "pluginCodeCache";

function normalizeCache(raw) {
  const entries =
    raw?.entries && typeof raw.entries === "object" && !Array.isArray(raw.entries)
      ? raw.entries
      : {};
  const normalized = {};
  Object.entries(entries).forEach(([key, value]) => {
    if (!value || typeof value !== "object" || typeof value.code !== "string") return;
    const id = safePluginId(key, "plugin");
    normalized[id] = {
      code: value.code,
      bytes: Number(value.bytes || value.code.length) || value.code.length,
      url: String(value.url || ""),
      version: String(value.version || ""),
      updatedAt: Number(value.updatedAt || 0) || 0,
      lastUsedAt: Number(value.lastUsedAt || value.updatedAt || 0) || 0
    };
  });
  return { entries: normalized };
}

const scopedCache = createProfileScopedStore({ key: CACHE_KEY, normalize: normalizeCache });

function cacheKey(scraperId) {
  const raw = String(scraperId || "plugin");
  return `plugin_${stablePluginHash(raw)}_${safePluginId(raw, "plugin", 24)}`;
}

function legacyCacheKey(scraperId) {
  return safePluginId(scraperId, "plugin");
}

function profileId(profileId) {
  return getEffectivePluginProfileId(profileId);
}

function totalBytes(entries) {
  return Object.values(entries || {}).reduce(
    (total, entry) => total + Number(entry?.bytes || 0),
    0
  );
}

export const PluginCodeStore = {
  get(scraperId, profile) {
    const key = cacheKey(scraperId);
    const oldKey = legacyCacheKey(scraperId);
    const state = scopedCache.getForProfile(profileId(profile));
    const storedKey = state.entries[key] ? key : oldKey;
    const entry = state.entries[storedKey];
    if (!entry) return null;
    const touched = { ...entry, lastUsedAt: Date.now() };
    if (touched.lastUsedAt !== entry.lastUsedAt) {
      const entries = { ...state.entries, [key]: touched };
      if (storedKey !== key) delete entries[storedKey];
      scopedCache.replaceForProfile(profileId(profile), { entries }, { silentSync: true });
    }
    return touched;
  },

  save(scraperId, code, metadata = {}, { maxBytes = 16 * 1024 * 1024, profile = null } = {}) {
    const key = cacheKey(scraperId);
    const value = String(code || "");
    const bytes =
      typeof TextEncoder === "function"
        ? new TextEncoder().encode(value).byteLength
        : unescape(encodeURIComponent(value)).length;
    if (bytes > maxBytes) return false;
    const state = scopedCache.getForProfile(profileId(profile));
    const entries = { ...state.entries };
    entries[key] = {
      code: value,
      bytes,
      url: String(metadata.url || ""),
      version: String(metadata.version || ""),
      updatedAt: Date.now(),
      lastUsedAt: Date.now()
    };
    delete entries[legacyCacheKey(scraperId)];
    while (totalBytes(entries) > maxBytes) {
      const oldest = Object.entries(entries)
        .filter(([entryKey]) => entryKey !== key)
        .sort(
          ([, left], [, right]) => Number(left.lastUsedAt || 0) - Number(right.lastUsedAt || 0)
        )[0];
      if (!oldest) return false;
      delete entries[oldest[0]];
    }
    try {
      scopedCache.replaceForProfile(profileId(profile), { entries }, { silentSync: true });
      // LocalStore deliberately absorbs quota/serialization errors. Verify the
      // replacement so a full TV storage device cannot make a provider look
      // executable until the next restart.
      const persisted = scopedCache.getForProfile(profileId(profile));
      return persisted.entries[key]?.code === value;
    } catch (_) {
      return false;
    }
  },

  remove(scraperId, profile) {
    const key = cacheKey(scraperId);
    const oldKey = legacyCacheKey(scraperId);
    const state = scopedCache.getForProfile(profileId(profile));
    if (!state.entries[key] && !state.entries[oldKey]) return false;
    const entries = { ...state.entries };
    delete entries[key];
    delete entries[oldKey];
    scopedCache.replaceForProfile(profileId(profile), { entries }, { silentSync: true });
    return true;
  },

  clear(profile) {
    scopedCache.replaceForProfile(profileId(profile), { entries: {} }, { silentSync: true });
  },

  clearProfile(profile) {
    const normalizedProfileId = String(profile || "").trim();
    if (!normalizedProfileId || normalizedProfileId === "1") return false;
    if (profileId(normalizedProfileId) !== normalizedProfileId) return false;
    this.clear(normalizedProfileId);
    return true;
  },

  totalBytes(profile) {
    return totalBytes(scopedCache.getForProfile(profile).entries);
  }
};
