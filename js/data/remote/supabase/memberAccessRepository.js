import { AuthState } from "../../../core/auth/authState.js";
import { AuthManager } from "../../../core/auth/authManager.js";
import { LocalStore } from "../../../core/storage/localStore.js";
import { SupabaseApi } from "./supabaseApi.js";
import { AvatarRepository } from "./avatarRepository.js";
import { ProfileBackgroundRepository } from "./profileBackgroundRepository.js";

const CACHE_KEY = "memberAccessCache";
const STALE_AFTER_MS = 15 * 60 * 1000;
const NONE_ACCESS = Object.freeze({ tier: null, entitlements: [] });
const MEMBER_TIERS = new Set(["SUPPORTER", "SUPPORTER_PLUS"]);
const COSMETIC_ENTITLEMENTS = new Set([
  "GOLD_THEME",
  "JADE_THEME",
  "ROSE_GOLD_THEME",
  "ARCTIC_BLUE_THEME",
  "GRAPHITE_THEME",
  "PROFILE_BACKGROUNDS",
  "PROFILE_AVATARS"
]);

let currentAccess = NONE_ACCESS;
let currentFetchedAt = 0;
let refreshPromise = null;
const listeners = new Set();

function normalizeAccess(payload) {
  const row = Array.isArray(payload)
    ? payload[0] || {}
    : payload?.data && typeof payload.data === "object"
      ? Array.isArray(payload.data)
        ? payload.data[0] || {}
        : payload.data
      : payload || {};
  const rawEntitlements = row?.entitlements;
  const entitlements = Array.isArray(rawEntitlements)
    ? rawEntitlements
    : typeof rawEntitlements === "string"
      ? rawEntitlements.split(",")
      : [];
  const tier = String(row?.tier || "").trim();
  return {
    tier: MEMBER_TIERS.has(tier) ? tier : null,
    entitlements: [
      ...new Set(
        entitlements
          .map((value) => String(value || "").trim())
          .filter((value) => COSMETIC_ENTITLEMENTS.has(value))
      )
    ]
  };
}

function sameAccess(left, right) {
  return (
    String(left?.tier || "") === String(right?.tier || "") &&
    JSON.stringify(left?.entitlements || []) === JSON.stringify(right?.entitlements || [])
  );
}

function notify(access) {
  listeners.forEach((listener) => {
    try {
      listener(access);
    } catch (error) {
      console.warn("Member access listener failed", error);
    }
  });
}

function setCurrent(access, fetchedAt = Date.now(), persist = true) {
  const normalized = normalizeAccess(access);
  const changed = !sameAccess(currentAccess, normalized);
  currentAccess = normalized;
  currentFetchedAt = Number(fetchedAt || 0) || 0;
  if (persist) {
    LocalStore.set(CACHE_KEY, { fetchedAt: currentFetchedAt, access: currentAccess });
  }
  if (changed) {
    notify(currentAccess);
  }
  return currentAccess;
}

function loadCache() {
  const cached = LocalStore.get(CACHE_KEY, null);
  if (!cached?.access) {
    return null;
  }
  return {
    fetchedAt: Number(cached.fetchedAt || 0) || 0,
    access: normalizeAccess(cached.access)
  };
}

function hydrateCachedAccess() {
  if (!AuthManager.isAuthenticated || currentFetchedAt) {
    return;
  }
  const cached = loadCache();
  if (cached) {
    setCurrent(cached.access, cached.fetchedAt, false);
  }
}

async function refreshRemote() {
  if (refreshPromise) {
    return refreshPromise;
  }
  refreshPromise = (async () => {
    try {
      if (!AuthManager.isAuthenticated) {
        return setCurrent(NONE_ACCESS, 0, false);
      }
      const response = await SupabaseApi.rpc("get_my_member_access", {}, true);
      return setCurrent(normalizeAccess(response));
    } catch (error) {
      console.warn("Unable to load member access", error);
      return currentAccess;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

AuthManager.subscribe((state) => {
  if (state === AuthState.SIGNED_OUT) {
    currentAccess = NONE_ACCESS;
    currentFetchedAt = 0;
    refreshPromise = null;
    LocalStore.remove(CACHE_KEY);
    AvatarRepository.invalidateCache();
    ProfileBackgroundRepository.invalidateCache();
    notify(currentAccess);
  }
});

export function hasMemberEntitlement(access, entitlement) {
  const target = String(entitlement || "").trim();
  return Boolean(target && (access?.entitlements || []).includes(target));
}

export const MemberAccessRepository = {
  async getAccess({ force = false } = {}) {
    if (!AuthManager.isAuthenticated) {
      return setCurrent(NONE_ACCESS, 0, false);
    }

    if (!force) {
      hydrateCachedAccess();
    }

    const ageMs = Date.now() - currentFetchedAt;
    const isFresh = currentFetchedAt > 0 && ageMs >= 0 && ageMs < STALE_AFTER_MS;
    if (!force && isFresh) {
      return currentAccess;
    }
    if (!force && currentFetchedAt > 0) {
      void refreshRemote();
      return currentAccess;
    }
    return refreshRemote();
  },

  refresh() {
    return refreshRemote();
  },

  getCachedAccess() {
    if (!AuthManager.isAuthenticated) {
      return setCurrent(NONE_ACCESS, 0, false);
    }
    hydrateCachedAccess();
    return currentAccess;
  },

  hasEntitlement(access, entitlement) {
    return hasMemberEntitlement(access, entitlement);
  },

  subscribe(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    listeners.add(listener);
    listener(currentAccess);
    return () => listeners.delete(listener);
  },

  getCurrentAccess() {
    return currentAccess;
  },

  clear() {
    currentAccess = NONE_ACCESS;
    currentFetchedAt = 0;
    refreshPromise = null;
    LocalStore.remove(CACHE_KEY);
    AvatarRepository.invalidateCache();
    ProfileBackgroundRepository.invalidateCache();
    notify(currentAccess);
  }
};
