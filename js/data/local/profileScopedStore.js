import { LocalStore } from "../../core/storage/localStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { getSyncBackoffRemainingMs } from "../../core/sync/syncBackoffPolicy.js";

const PROFILE_SCOPED_VERSION = 1;
const PROFILES_KEY = "profiles";
const SETTINGS_SYNC_DEBOUNCE_MS = 1500;
const SETTINGS_SYNC_PENDING_KEY = "profileSettingsSyncPendingProfiles";

const scheduledSettingsSyncTimers = new Map();
const settingsSyncInFlightByProfile = new Map();

function normalizeProfileId(profileId) {
  const raw = String(profileId ?? ProfileManager.getActiveProfileId() ?? "1").trim();
  return raw || "1";
}

function cloneValue(value) {
  if (value == null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function isProfileScopedEnvelope(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    value.__profileScoped === true &&
    Number(value.version || 0) === PROFILE_SCOPED_VERSION &&
    value.profiles &&
    typeof value.profiles === "object"
  );
}

function getKnownProfileIds() {
  const storedProfiles = LocalStore.get(PROFILES_KEY, null);
  const ids = Array.isArray(storedProfiles)
    ? storedProfiles
        .map((profile) => String(profile?.id || profile?.profileIndex || "").trim())
        .filter(Boolean)
    : [];
  if (!ids.includes("1")) {
    ids.unshift("1");
  }
  return Array.from(new Set(ids));
}

function createEmptyEnvelope() {
  return {
    __profileScoped: true,
    version: PROFILE_SCOPED_VERSION,
    profiles: {}
  };
}

function normalizeEnvelopeProfiles(profiles = {}, normalize) {
  const normalized = {};
  Object.entries(profiles || {}).forEach(([profileId, value]) => {
    const normalizedProfileId = normalizeProfileId(profileId);
    normalized[normalizedProfileId] = normalize(cloneValue(value) || {});
  });
  return normalized;
}

// Read-path memo, keyed on the raw localStorage string.
//
// `readEnvelope` backs every profile-scoped settings store, and it is not a
// cheap accessor: it parses the whole envelope, re-normalizes every profile in
// it, and stringifies the result twice to decide whether the renormalized value
// needs writing back. For `collectionsState` that is ~380 KB of JSON per read,
// and the per-key storage profiler measured 3 reads totalling 1147.8 KB in a
// single Home load.
//
// The raw stored string is the exact identity of what is stored, so memoizing
// against it is safe: any write (from here or anywhere else, including another
// tab) changes the string and invalidates the entry. Same pattern already proven
// in addonRepository.readProfileScopedEnvelope and homeCatalogStore.
const envelopeCache = new Map();

function readRawStoredValue(key) {
  try {
    return localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

function readEnvelope(key, normalize, legacyProfileIds = null) {
  const rawString = readRawStoredValue(key);
  const cached = envelopeCache.get(key);
  if (cached && cached.raw === rawString) {
    return cached.envelope;
  }
  const envelope = readEnvelopeUncached(key, normalize, legacyProfileIds);
  envelopeCache.set(key, {
    // Re-read: the uncached path can write a migrated or renormalized envelope,
    // which changes the string this entry has to be keyed on.
    raw: readRawStoredValue(key),
    envelope
  });
  return envelope;
}

function readEnvelopeUncached(key, normalize, legacyProfileIds = null) {
  const raw = LocalStore.get(key, null);
  if (isProfileScopedEnvelope(raw)) {
    const next = {
      ...raw,
      profiles: normalizeEnvelopeProfiles(raw.profiles, normalize)
    };
    if (JSON.stringify(next) !== JSON.stringify(raw)) {
      LocalStore.set(key, next);
    }
    return next;
  }

  if (raw == null) {
    return createEmptyEnvelope();
  }

  // A store may declare which profiles a pre-envelope value belonged to.
  // pluginStore does: its legacy value is the primary profile's alone, so
  // copying it into every known profile would hand one profile's plugins to
  // all of them.
  const profileIds = Array.isArray(legacyProfileIds)
    ? Array.from(new Set(legacyProfileIds.map((profileId) => normalizeProfileId(profileId))))
    : getKnownProfileIds();
  const normalizedLegacy = normalize(cloneValue(raw) || {});
  const migrated = createEmptyEnvelope();
  profileIds.forEach((profileId) => {
    migrated.profiles[profileId] = cloneValue(normalizedLegacy);
  });
  LocalStore.set(key, migrated);
  return migrated;
}

function persistEnvelope(key, envelope) {
  LocalStore.set(key, envelope);
  // Callers mutate the (memoized) envelope in place before persisting it, so the
  // cached object already matches what was just written. Only the raw key it is
  // memoized against has to be refreshed, otherwise the very next read throws
  // away a correct envelope and pays the full parse again.
  envelopeCache.set(key, { raw: readRawStoredValue(key), envelope });
}

function readPendingSettingsSyncProfiles() {
  const value = LocalStore.get(SETTINGS_SYNC_PENDING_KEY, {}) || {};
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function markProfileSettingsCloudSyncPending(profileId = null) {
  const normalizedProfileId = normalizeProfileId(profileId);
  const pending = readPendingSettingsSyncProfiles();
  pending[normalizedProfileId] = Math.max(
    Date.now(),
    Number(pending[normalizedProfileId] || 0) + 1
  );
  LocalStore.set(SETTINGS_SYNC_PENDING_KEY, pending);
}

export function getProfileSettingsCloudSyncPendingVersion(profileId = null) {
  const normalizedProfileId = normalizeProfileId(profileId);
  const pending = readPendingSettingsSyncProfiles();
  return pending[normalizedProfileId] == null ? null : pending[normalizedProfileId];
}

export function clearProfileSettingsCloudSyncPending(profileId = null, expectedVersion = null) {
  const normalizedProfileId = normalizeProfileId(profileId);
  const pending = readPendingSettingsSyncProfiles();
  if (!Object.prototype.hasOwnProperty.call(pending, normalizedProfileId)) {
    return;
  }
  if (expectedVersion != null && pending[normalizedProfileId] !== expectedVersion) {
    return;
  }
  delete pending[normalizedProfileId];
  LocalStore.set(SETTINGS_SYNC_PENDING_KEY, pending);
}

export function hasProfileSettingsCloudSyncPending(profileId = null) {
  const normalizedProfileId = normalizeProfileId(profileId);
  const pending = readPendingSettingsSyncProfiles();
  return Object.prototype.hasOwnProperty.call(pending, normalizedProfileId);
}

function ensureProfileValue(key, envelope, normalize, profileId, seedFromPrimary = true) {
  const normalizedProfileId = normalizeProfileId(profileId);
  if (Object.prototype.hasOwnProperty.call(envelope.profiles, normalizedProfileId)) {
    return envelope.profiles[normalizedProfileId];
  }

  const primaryValue = envelope.profiles["1"];
  const seed = seedFromPrimary && primaryValue != null ? cloneValue(primaryValue) : normalize({});
  envelope.profiles[normalizedProfileId] = normalize(seed || {});
  persistEnvelope(key, envelope);
  return envelope.profiles[normalizedProfileId];
}

export function queueProfileSettingsCloudSync(
  profileId = null,
  delayMs = SETTINGS_SYNC_DEBOUNCE_MS
) {
  const normalizedProfileId = normalizeProfileId(profileId);
  markProfileSettingsCloudSyncPending(normalizedProfileId);
  if (scheduledSettingsSyncTimers.has(normalizedProfileId)) {
    clearTimeout(scheduledSettingsSyncTimers.get(normalizedProfileId));
  }
  const timerId = setTimeout(() => {
    scheduledSettingsSyncTimers.delete(normalizedProfileId);
    const runPush = async () => {
      const activePush = settingsSyncInFlightByProfile.get(normalizedProfileId);
      if (activePush) {
        await activePush.catch(() => false);
      }
      const pushPromise = import("../../core/profile/profileSettingsSyncService.js")
        .then(({ ProfileSettingsSyncService }) =>
          ProfileSettingsSyncService.push(normalizedProfileId)
        )
        .catch((error) => {
          console.warn("Profile settings sync enqueue failed", error);
          return false;
        })
        .finally(() => {
          if (settingsSyncInFlightByProfile.get(normalizedProfileId) === pushPromise) {
            settingsSyncInFlightByProfile.delete(normalizedProfileId);
          }
        });
      settingsSyncInFlightByProfile.set(normalizedProfileId, pushPromise);
      const didPush = await pushPromise;
      if (!didPush && hasProfileSettingsCloudSyncPending(normalizedProfileId)) {
        const retryDelayMs = getSyncBackoffRemainingMs();
        if (retryDelayMs > 0) {
          queueProfileSettingsCloudSync(normalizedProfileId, Math.max(5000, retryDelayMs));
        }
      }
    };
    void runPush();
  }, delayMs);
  scheduledSettingsSyncTimers.set(normalizedProfileId, timerId);
}

export function createProfileScopedStore({
  key,
  normalize,
  merge,
  seedFromPrimary = true,
  legacyProfileIds = null
}) {
  const mergeValues =
    typeof merge === "function"
      ? merge
      : (current, partial) => ({ ...(current || {}), ...(partial || {}) });

  return {
    getForProfile(profileId) {
      const envelope = readEnvelope(key, normalize, legacyProfileIds);
      return cloneValue(ensureProfileValue(key, envelope, normalize, profileId, seedFromPrimary));
    },

    get() {
      return this.getForProfile(normalizeProfileId());
    },

    replaceForProfile(profileId, nextValue, { silentSync = false } = {}) {
      const envelope = readEnvelope(key, normalize, legacyProfileIds);
      const normalizedProfileId = normalizeProfileId(profileId);
      envelope.profiles[normalizedProfileId] = normalize(cloneValue(nextValue) || {});
      persistEnvelope(key, envelope);
      if (!silentSync) {
        queueProfileSettingsCloudSync(normalizedProfileId);
      }
      return cloneValue(envelope.profiles[normalizedProfileId]);
    },

    setForProfile(profileId, partial, { silentSync = false } = {}) {
      const current = this.getForProfile(profileId);
      return this.replaceForProfile(profileId, mergeValues(current, partial), { silentSync });
    },

    set(partial, options = {}) {
      return this.setForProfile(normalizeProfileId(options.profileId), partial, options);
    },

    clearProfile(profileId, { silentSync = false } = {}) {
      const envelope = readEnvelope(key, normalize, legacyProfileIds);
      const normalizedProfileId = normalizeProfileId(profileId);
      delete envelope.profiles[normalizedProfileId];
      persistEnvelope(key, envelope);
      if (!silentSync) {
        queueProfileSettingsCloudSync(normalizedProfileId);
      }
    }
  };
}
