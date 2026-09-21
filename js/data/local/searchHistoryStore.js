import { LocalStore } from "../../core/storage/localStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";

const KEY = "searchHistory";
export const SEARCH_HISTORY_MAX_ITEMS = 8;

function normalizeProfileId(profileId = null) {
  return String(profileId ?? ProfileManager.getActiveProfileId() ?? "1").trim() || "1";
}

function normalizeQuery(value) {
  return String(value || "").trim();
}

function normalizeQueries(value, maxItems = SEARCH_HISTORY_MAX_ITEMS) {
  const seen = new Set();
  const normalized = [];
  (Array.isArray(value) ? value : []).forEach((entry) => {
    const query = normalizeQuery(entry);
    const key = query.toLowerCase();
    if (!query || seen.has(key)) {
      return;
    }
    seen.add(key);
    normalized.push(query);
  });
  return normalized.slice(0, Math.max(1, Number(maxItems) || SEARCH_HISTORY_MAX_ITEMS));
}

function readAll() {
  const value = LocalStore.get(KEY, {});
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function listForProfile(profileId = null) {
  const all = readAll();
  return normalizeQueries(all[normalizeProfileId(profileId)]);
}

function writeForProfile(profileId, queries) {
  const normalizedProfileId = normalizeProfileId(profileId);
  const all = readAll();
  const normalized = normalizeQueries(queries);
  if (normalized.length) {
    all[normalizedProfileId] = normalized;
  } else {
    delete all[normalizedProfileId];
  }
  LocalStore.set(KEY, all);
  return normalized;
}

export const SearchHistoryStore = {
  list(profileId = null) {
    return listForProfile(profileId);
  },

  save(query, profileId = null, maxItems = SEARCH_HISTORY_MAX_ITEMS) {
    const normalized = normalizeQuery(query);
    if (!normalized) {
      return listForProfile(profileId);
    }

    const normalizedLower = normalized.toLowerCase();
    const current = listForProfile(profileId);
    const updated = [
      normalized,
      ...current.filter((existing) => {
        const existingLower = existing.toLowerCase();
        return existingLower !== normalizedLower && !normalizedLower.startsWith(existingLower);
      })
    ];
    return writeForProfile(profileId, updated.slice(0, Math.max(1, Number(maxItems) || 1)));
  },

  remove(query, profileId = null) {
    const normalized = normalizeQuery(query).toLowerCase();
    if (!normalized) {
      return listForProfile(profileId);
    }
    return writeForProfile(
      profileId,
      listForProfile(profileId).filter((entry) => entry.toLowerCase() !== normalized)
    );
  },

  clear(profileId = null) {
    return writeForProfile(profileId, []);
  }
};
