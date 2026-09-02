import { LocalStore } from "../../core/storage/localStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { createProfileScopedStore } from "./profileScopedStore.js";
import { getSyncBackoffRemainingMs } from "../../core/sync/syncBackoffPolicy.js";
import {
  createDefaultPluginState,
  createLegacySource,
  normalizePluginState
} from "../../core/player/pluginModels.js";

const PLUGIN_STATE_KEY = "pluginState";
const LEGACY_SOURCES_KEY = "pluginSources";
const LEGACY_ENABLED_KEY = "pluginsEnabled";
const PLUGIN_SYNC_DEBOUNCE_MS = 750;

const pluginSyncTimers = new Map();
const pluginSyncInFlight = new Map();

function readProfiles() {
  const profiles = LocalStore.get("profiles", []);
  return Array.isArray(profiles) ? profiles : [];
}

export function getEffectivePluginProfileId(profileId = ProfileManager.getActiveProfileId()) {
  const normalized = String(profileId || "1");
  const profile = readProfiles().find(
    (entry) => String(entry?.id || entry?.profileIndex || "") === normalized
  );
  return profile?.usesPrimaryPlugins && normalized !== "1" ? "1" : normalized;
}

const scopedStore = createProfileScopedStore({
  key: PLUGIN_STATE_KEY,
  normalize: normalizePluginState
});

function migrateLegacyIfNeeded(profileId) {
  const effectiveProfileId = getEffectivePluginProfileId(profileId);
  const existing = scopedStore.getForProfile(effectiveProfileId);
  const hasState =
    existing.repositories.length || existing.scrapers.length || existing.legacySources.length;
  if (hasState || LocalStore.get(`${PLUGIN_STATE_KEY}:migrationComplete`, false)) {
    return existing;
  }

  const legacySources = LocalStore.get(LEGACY_SOURCES_KEY, []);
  const migrated = normalizePluginState({
    ...createDefaultPluginState(),
    legacySources: Array.isArray(legacySources) ? legacySources : [],
    settings: {
      pluginsEnabled: LocalStore.get(LEGACY_ENABLED_KEY, true) !== false,
      groupStreamsByRepository: false,
      scraperSettings: {}
    },
    syncDirty: Array.isArray(legacySources) && legacySources.length > 0
  });
  scopedStore.replaceForProfile(effectiveProfileId, migrated, { silentSync: true });
  LocalStore.set(`${PLUGIN_STATE_KEY}:migrationComplete`, true);
  return migrated;
}

function readState(profileId = ProfileManager.getActiveProfileId()) {
  return migrateLegacyIfNeeded(profileId);
}

function writeState(profileId, state) {
  const effectiveProfileId = getEffectivePluginProfileId(profileId);
  const normalized = normalizePluginState(state);
  scopedStore.replaceForProfile(effectiveProfileId, normalized, { silentSync: true });
  if (normalized.syncDirty) {
    queuePluginCloudSync(effectiveProfileId);
  }
  return normalized;
}

function queuePluginCloudSync(profileId, delayMs = PLUGIN_SYNC_DEBOUNCE_MS) {
  const normalizedProfileId = String(getEffectivePluginProfileId(profileId) || "1");
  const previousTimer = pluginSyncTimers.get(normalizedProfileId);
  if (previousTimer) {
    clearTimeout(previousTimer);
  }
  const timer = setTimeout(
    () => {
      pluginSyncTimers.delete(normalizedProfileId);
      const activePush = pluginSyncInFlight.get(normalizedProfileId);
      const run = async () => {
        if (activePush) {
          await activePush.catch(() => false);
        }
        const pushPromise = import("../../core/profile/pluginSyncService.js")
          .then(({ PluginSyncService }) => PluginSyncService.push(normalizedProfileId))
          .catch((error) => {
            console.warn("Plugin cloud sync enqueue failed", error);
            return false;
          })
          .finally(() => {
            if (pluginSyncInFlight.get(normalizedProfileId) === pushPromise) {
              pluginSyncInFlight.delete(normalizedProfileId);
            }
          });
        pluginSyncInFlight.set(normalizedProfileId, pushPromise);
        const didPush = await pushPromise;
        if (!didPush) {
          const retryDelayMs = getSyncBackoffRemainingMs();
          if (retryDelayMs > 0) {
            queuePluginCloudSync(normalizedProfileId, Math.max(5000, retryDelayMs));
          }
        }
      };
      void run();
    },
    Math.max(0, Number(delayMs) || 0)
  );
  pluginSyncTimers.set(normalizedProfileId, timer);
}

export const PluginStore = {
  get(profileId = ProfileManager.getActiveProfileId()) {
    return readState(profileId);
  },

  replace(nextState, profileId = ProfileManager.getActiveProfileId()) {
    return writeState(profileId, nextState);
  },

  update(mutator, profileId = ProfileManager.getActiveProfileId()) {
    const current = readState(profileId);
    const next = typeof mutator === "function" ? mutator(current) : current;
    return writeState(profileId, next || current);
  },

  canEdit(profileId = ProfileManager.getActiveProfileId()) {
    const normalized = String(profileId || "1");
    const profile = readProfiles().find(
      (entry) => String(entry?.id || entry?.profileIndex || "") === normalized
    );
    return normalized === "1" || profile?.usesPrimaryPlugins !== true;
  },

  markDirty(profileId = ProfileManager.getActiveProfileId()) {
    return this.update((state) => ({ ...state, syncDirty: true }), profileId);
  },

  clearDirty(profileId = ProfileManager.getActiveProfileId()) {
    return this.update((state) => ({ ...state, syncDirty: false }), profileId);
  },

  clearProfile(profileId) {
    const normalizedProfileId = String(profileId || "").trim();
    if (!normalizedProfileId || normalizedProfileId === "1") return false;
    // A secondary profile that inherits the primary plugin set has no private
    // plugin state to remove. Never clear profile 1 through that alias.
    if (getEffectivePluginProfileId(normalizedProfileId) !== normalizedProfileId) return false;
    scopedStore.clearProfile(normalizedProfileId, { silentSync: true });
    return true;
  },

  migrateLegacySource(source, index = 0, profileId = ProfileManager.getActiveProfileId()) {
    return this.update(
      (state) => ({
        ...state,
        legacySources: [...state.legacySources, createLegacySource(source, index)],
        syncDirty: true
      }),
      profileId
    );
  },

  key: PLUGIN_STATE_KEY,
  legacyKeys: Object.freeze([LEGACY_SOURCES_KEY, LEGACY_ENABLED_KEY])
};
