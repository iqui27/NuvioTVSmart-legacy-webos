import { AuthManager } from "../auth/authManager.js";
import { isMissingResourceError, isSyncBackoffActive } from "../sync/syncBackoffPolicy.js";
import { addonRepository } from "../../data/repository/addonRepository.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { ProfileManager } from "./profileManager.js";
import { getSyncClientId } from "../sync/syncClientIdentity.js";

const ADDONS_TABLE = "addons";
const TABLE = "tv_addons";
const SYNC_OVERVIEW_RPC = "get_sync_overview";

// Records the outcome of the latest pull so the Addons screen can show a
// visible sync state on TV.
let lastPullStatus = { state: "idle", count: 0, error: null, at: 0 };

function recordPullStatus(state, { count = 0, error = null, keptLocal = false } = {}) {
  lastPullStatus = {
    state,
    count: Number(count) || 0,
    error: error ? String(error.message || error) : null,
    // True when the pull succeeded but returned nothing and the local addon list
    // was preserved instead of being wiped. Surfaced so the Addons screen can
    // tell "synced" apart from "kept what you had because the cloud said none".
    keptLocal: Boolean(keptLocal),
    at: Date.now()
  };
}

function isOnConflictConstraintError(error) {
  if (!error) {
    return false;
  }
  if (typeof error.code === "string" && error.code === "42P10") {
    return true;
  }
  const message = String(error.message || "");
  return (
    message.includes("42P10") ||
    message.includes("no unique or exclusion constraint matching the ON CONFLICT specification")
  );
}

async function resolveProfileId() {
  const activeId = String(ProfileManager.getActiveProfileId() || "1");
  const direct = Number(activeId);
  if (Number.isFinite(direct) && direct > 0) {
    return Math.trunc(direct);
  }

  const profiles = await ProfileManager.getProfiles();
  const activeProfile = profiles.find((profile) => String(profile.id) === activeId);
  const candidate = Number(activeProfile?.profileIndex || activeProfile?.id || 1);
  return Number.isFinite(candidate) && candidate > 0 ? Math.trunc(candidate) : 1;
}

async function resolveAddonProfileId() {
  const profileId = await resolveProfileId();
  if (profileId === 1) {
    return 1;
  }

  const profiles = await ProfileManager.getProfiles();
  const activeProfile = profiles.find((profile) => {
    const id = Number(profile?.profileIndex || profile?.id || 1);
    return Number.isFinite(id) && Math.trunc(id) === profileId;
  });
  const usesPrimaryAddons = readRemoteBoolean(
    activeProfile?.usesPrimaryAddons ?? activeProfile?.uses_primary_addons,
    false
  );

  return usesPrimaryAddons ? 1 : profileId;
}

function normalizeProfileId(profileId = null) {
  const raw = Number(profileId == null ? 1 : profileId);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 1;
}

function readRemoteBoolean(value, fallback = true) {
  if (value == null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return fallback;
}

async function verifyEmptyRemoteAddonSnapshot(profileId) {
  const profileKey = String(normalizeProfileId(profileId));
  try {
    const response = await SupabaseApi.rpc(SYNC_OVERVIEW_RPC, {}, true);
    const overview =
      Array.isArray(response) && response.length === 1
        ? response[0]
        : response && typeof response === "object" && !Array.isArray(response)
          ? response
          : null;
    const addons =
      overview?.addons && typeof overview.addons === "object" && !Array.isArray(overview.addons)
        ? overview.addons
        : null;
    const profiles =
      overview?.profiles &&
      typeof overview.profiles === "object" &&
      !Array.isArray(overview.profiles)
        ? overview.profiles
        : null;
    const profileExists =
      profiles &&
      Object.prototype.hasOwnProperty.call(profiles, profileKey) &&
      profiles[profileKey] &&
      typeof profiles[profileKey] === "object" &&
      !Array.isArray(profiles[profileKey]);
    const hasAddonCount = addons && Object.prototype.hasOwnProperty.call(addons, profileKey);
    const rawAddonCount = hasAddonCount ? addons[profileKey] : 0;
    const addonCount = Number(rawAddonCount);
    const validAddonCount =
      (!hasAddonCount || typeof rawAddonCount === "number" || typeof rawAddonCount === "string") &&
      Number.isInteger(addonCount) &&
      addonCount >= 0;
    const verified = Boolean(profileExists && validAddonCount && addonCount === 0);
    console.warn("Addon sync empty snapshot verification", {
      targetProfileId: profileKey,
      profileExists: Boolean(profileExists),
      addonCount: validAddonCount ? addonCount : null,
      verified
    });
    return verified;
  } catch (error) {
    console.warn("Addon sync empty snapshot verification failed", error);
    return false;
  }
}

function extractAddonEntries(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => {
      const rawSortOrder = row?.sort_order ?? row?.sortOrder ?? row?.position ?? index;
      const sortOrder = Number(rawSortOrder);
      return {
        url: row?.url || row?.base_url || null,
        displayName:
          row?.display_name ||
          row?.displayName ||
          row?.custom_name ||
          row?.customName ||
          row?.alias ||
          row?.name ||
          null,
        name: row?.name || null,
        enabled: readRemoteBoolean(row?.enabled),
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : index,
        sourceIndex: index
      };
    })
    .sort((left, right) => left.sortOrder - right.sortOrder || left.sourceIndex - right.sourceIndex)
    .filter((entry) => entry.url)
    .filter(
      (entry, index, values) =>
        values.findIndex(
          (candidate) =>
            addonRepository.normalizeUrl(candidate.url) === addonRepository.normalizeUrl(entry.url)
        ) === index
    );
}

function applyPulledAddons(entries = [], localOnlyUrls = []) {
  const urls = entries.map((entry) => entry.url).filter(Boolean);
  const currentNames = addonRepository.getAddonDisplayNameOverrides();
  const currentEnabled = addonRepository.getAddonEnabledStates();
  // The name and enabled writes below are replace:true, so the local-only
  // addons have to be represented here too or they would keep their place in
  // the list while losing their display name and enabled flag.
  const localOnlyEntries = localOnlyUrls.map((url) => {
    const cleanUrl = addonRepository.canonicalizeUrl(url);
    return {
      url,
      displayName: currentNames[cleanUrl] || "",
      name: currentNames[cleanUrl] || "",
      enabled: currentEnabled[cleanUrl] !== false
    };
  });
  const mergedEntries = [...entries, ...localOnlyEntries];

  addonRepository.setAddonDisplayNameOverrides(
    mergedEntries.map((entry) => {
      const cleanUrl = addonRepository.canonicalizeUrl(entry.url);
      return {
        url: entry.url,
        name:
          entry.displayName ||
          entry.name ||
          addonRepository.getAddonDisplayNameOverride(cleanUrl) ||
          ""
      };
    }),
    { replace: true }
  );
  addonRepository.setAddonEnabledStates(mergedEntries, { replace: true });
  return urls;
}

function prepareRemoteAddonSnapshot(rows, { allowVerifiedEmptySnapshot = false } = {}) {
  const entries = extractAddonEntries(rows);
  const urls = entries.map((entry) => entry.url).filter(Boolean);
  const localUrls = addonRepository.getInstalledAddonUrls();

  // Android TV does not treat an empty remote snapshot as authoritative when
  // local addons already exist. An empty response must not erase the addon list
  // (or its names/enabled states) used by catalog, stream, and subtitle repositories.
  if (urls.length === 0 && !allowVerifiedEmptySnapshot) {
    if (localUrls.length > 0) {
      console.warn(
        `Addon sync pull returned an empty remote list while local has ${localUrls.length} entries; preserving local addons`
      );
    }
    return { urls: [...localUrls], shouldApply: false };
  }

  // Union rather than replace, cloud order first. LOCAL DIVERGENCE, kept
  // against upstream on purpose.
  //
  // The startup cycle pulls before it pushes (startupSyncService.requestSyncNow
  // with pushAfterPull), so a replace here deletes any addon that exists only on
  // this device and the following push then propagates the deletion. An addon
  // installed while the backend was unreachable -- which is exactly when the push
  // that would have uploaded it failed -- could never survive the next boot.
  // Upstream's empty-snapshot guard above does not cover this: it only fires when
  // the remote list is empty, not when it is merely missing this device's addons.
  //
  // The tradeoff is deliberate and worth stating: a removal performed on another
  // device no longer wins against this device's local copy, so it can reappear
  // here until removed locally too. Losing an addon the user installed is the
  // worse failure, and local removal still works and still pushes.
  const cloudSet = new Set(urls.map((url) => addonRepository.canonicalizeUrl(url)));
  const localOnlyUrls = localUrls.filter(
    (url) => !cloudSet.has(addonRepository.canonicalizeUrl(url))
  );
  if (localOnlyUrls.length) {
    console.info("Addon sync keeping addons present only on this device", {
      count: localOnlyUrls.length
    });
  }

  applyPulledAddons(entries, localOnlyUrls);
  return { urls: [...urls, ...localOnlyUrls], shouldApply: true };
}

async function reconcileRemoteAddonSnapshot(rows, options = {}) {
  const { urls, shouldApply } = prepareRemoteAddonSnapshot(rows, options);
  if (shouldApply) {
    await addonRepository.setAddonOrder(urls, { silent: true, allowReadOnly: true });
  }
  return urls;
}

async function reconcileFetchedAddonSnapshot(rows, profileId, requestedProfileId) {
  if (String(ProfileManager.getActiveProfileId()) !== String(requestedProfileId)) {
    return addonRepository.getInstalledAddonUrls();
  }
  const allowVerifiedEmptySnapshot =
    Array.isArray(rows) &&
    rows.length === 0 &&
    addonRepository.getInstalledAddonUrls().length > 0 &&
    (await verifyEmptyRemoteAddonSnapshot(profileId));
  if (String(ProfileManager.getActiveProfileId()) !== String(requestedProfileId)) {
    return addonRepository.getInstalledAddonUrls();
  }
  return reconcileRemoteAddonSnapshot(rows, { allowVerifiedEmptySnapshot });
}

export const LibrarySyncService = {
  getLastPullStatus() {
    return lastPullStatus;
  },

  async pull() {
    let readError = null;
    try {
      if (isSyncBackoffActive()) {
        recordPullStatus("deferred");
        return addonRepository.getInstalledAddonUrls();
      }
      if (!AuthManager.isAuthenticated) {
        recordPullStatus("signed-out");
        return [];
      }
      const requestedProfileId = String(ProfileManager.getActiveProfileId() || "1");
      const localUrls = addonRepository.getInstalledAddonUrls();
      const profileId = await resolveAddonProfileId();
      if (String(ProfileManager.getActiveProfileId()) !== requestedProfileId) {
        recordPullStatus("stale", { count: localUrls.length });
        return addonRepository.getInstalledAddonUrls();
      }
      const ownerId = await AuthManager.getEffectiveUserId();
      if (String(ProfileManager.getActiveProfileId()) !== requestedProfileId) {
        recordPullStatus("stale", { count: localUrls.length });
        return addonRepository.getInstalledAddonUrls();
      }
      let addonTableMissing = false;

      try {
        const addonRows = await SupabaseApi.select(
          ADDONS_TABLE,
          `user_id=eq.${encodeURIComponent(ownerId)}&profile_id=eq.${profileId}&select=*&order=sort_order.asc`,
          true
        );
        const addonUrls = await reconcileFetchedAddonSnapshot(
          addonRows,
          profileId,
          requestedProfileId
        );
        recordPullStatus("ok", { count: addonUrls.length });
        return addonUrls;
      } catch (addonsTableError) {
        addonTableMissing = isMissingResourceError(addonsTableError);
        if (!addonTableMissing) {
          readError = addonsTableError;
          recordPullStatus("error", { count: localUrls.length, error: readError });
          console.warn("Addon sync pull addons-table read failed", addonsTableError);
          return localUrls;
        }
        console.warn("Addon sync pull addons-table read failed", addonsTableError);
      }

      let tvTableMissing = false;
      try {
        const rows = await SupabaseApi.select(
          TABLE,
          `owner_id=eq.${encodeURIComponent(ownerId)}&select=*&order=position.asc`,
          true
        );
        const urls = await reconcileFetchedAddonSnapshot(rows, profileId, requestedProfileId);
        recordPullStatus("ok", { count: urls.length });
        return urls;
      } catch (tvTableError) {
        tvTableMissing = isMissingResourceError(tvTableError);
        if (!tvTableMissing) {
          readError = tvTableError;
          recordPullStatus("error", { count: localUrls.length, error: readError });
          console.warn("Addon sync pull tv-table read failed", tvTableError);
          return localUrls;
        }
        console.warn("Addon sync pull tv-table read failed", tvTableError);
      }

      if (addonTableMissing && tvTableMissing) {
        try {
          const rpcRows = await SupabaseApi.rpc(
            "sync_pull_addons",
            { p_profile_id: profileId },
            true
          );
          const urls = await reconcileFetchedAddonSnapshot(rpcRows, profileId, requestedProfileId);
          recordPullStatus("ok", { count: urls.length });
          return urls;
        } catch (rpcError) {
          readError = rpcError;
          console.warn("Addon sync pull RPC failed", rpcError);
        }
      }

      if (readError) {
        recordPullStatus("error", { count: localUrls.length, error: readError });
      } else {
        recordPullStatus("ok", { count: localUrls.length });
      }
      if (localUrls.length) {
        return localUrls;
      }
      return [];
    } catch (error) {
      recordPullStatus("error", { error });
      console.warn("Library sync pull failed", error);
      return [];
    }
  },

  async push() {
    if (isSyncBackoffActive()) {
      return false;
    }
    try {
      if (!AuthManager.isAuthenticated) {
        return false;
      }
      const requestedProfileId = await resolveProfileId();
      const profileId = await resolveAddonProfileId();
      // Android treats a secondary profile that inherits the primary addon
      // set as read-only. Do not publish the primary profile's local state
      // merely because this profile became active.
      if (requestedProfileId !== profileId) {
        return true;
      }
      const urls = addonRepository.getInstalledAddonUrls();
      if ((await resolveProfileId()) !== requestedProfileId) {
        return false;
      }

      try {
        await SupabaseApi.rpc(
          "sync_push_addons",
          {
            p_profile_id: profileId,
            p_addons: urls.map((url, index) => ({
              url,
              sort_order: index,
              enabled: addonRepository.isAddonEnabled(url),
              ...(addonRepository.getAddonDisplayNameOverride(url)
                ? { name: addonRepository.getAddonDisplayNameOverride(url) }
                : {})
            })),
            p_origin_client_id: getSyncClientId()
          },
          true
        );
        return true;
      } catch (rpcError) {
        if (!isMissingResourceError(rpcError)) {
          throw rpcError;
        }
        console.warn("Addon sync push RPC is unavailable, falling back to legacy table", rpcError);
      }

      const ownerId = await AuthManager.getEffectiveUserId();
      try {
        await SupabaseApi.delete(
          ADDONS_TABLE,
          `user_id=eq.${encodeURIComponent(ownerId)}&profile_id=eq.${profileId}`,
          true
        );
        const addonRows = urls.map((url, index) => {
          const name = addonRepository.getAddonDisplayNameOverride(url);
          return {
            user_id: ownerId,
            profile_id: profileId,
            url,
            sort_order: index,
            enabled: addonRepository.isAddonEnabled(url),
            ...(name ? { name } : {})
          };
        });
        if (addonRows.length) {
          try {
            await SupabaseApi.upsert(ADDONS_TABLE, addonRows, "user_id,profile_id,url", true);
          } catch (upsertError) {
            if (!isOnConflictConstraintError(upsertError)) {
              throw upsertError;
            }
            await SupabaseApi.upsert(ADDONS_TABLE, addonRows, null, true);
          }
        }
        return true;
      } catch (addonsTableError) {
        if (!isMissingResourceError(addonsTableError)) {
          console.warn("Addon sync push addons-table fallback failed", addonsTableError);
          return false;
        }
        console.warn(
          "Addon sync push addons-table missing, trying tv_addons fallback",
          addonsTableError
        );
      }

      const rows = urls.map((baseUrl, index) => ({
        owner_id: ownerId,
        base_url: baseUrl,
        position: index
      }));
      try {
        await SupabaseApi.delete(TABLE, `owner_id=eq.${encodeURIComponent(ownerId)}`, true);
        if (rows.length) {
          await SupabaseApi.upsert(TABLE, rows, "owner_id,base_url", true);
        }
        return true;
      } catch (tvTableError) {
        console.warn("Addon sync push tv_addons fallback failed", tvTableError);
        return false;
      }
    } catch (error) {
      console.warn("Library sync push failed", error);
      return false;
    }
  }
};
