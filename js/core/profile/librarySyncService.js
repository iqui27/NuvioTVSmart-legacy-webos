import { AuthManager } from "../auth/authManager.js";
import { isMissingResourceError, isSyncBackoffActive } from "../sync/syncBackoffPolicy.js";
import { addonRepository } from "../../data/repository/addonRepository.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { ProfileManager } from "./profileManager.js";

const ADDONS_TABLE = "addons";
const TABLE = "tv_addons";

// Records the outcome of the latest pull so the Addons screen can show a
// visible sync state on TV.
let lastPullStatus = { state: "idle", count: 0, error: null, at: 0 };

// Verdadeiro quando o último applyPulledAddons manteve addons que só existem
// neste aparelho (a nuvem respondeu com linhas, mas sem eles). Divergência
// CONFIRMADA: o pull sozinho nunca a corrige, porque o push de addons só roda
// em evento de mudança local (onInstalledAddonsChanged) e um addon restaurado
// de backup/união nunca dispara esse evento — medido em TV real: nuvem com 5/6
// addons do perfil 1 e 4/8 do perfil 2 indefinidamente. O caso keptLocal
// (resposta VAZIA) fica de fora de propósito: vazio pode ser indisponibilidade
// transitória, e um push ali substituiria a nuvem às cegas.
let lastPullHadLocalOnly = false;

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
  const usesPrimaryAddons =
    typeof activeProfile?.usesPrimaryAddons === "boolean"
      ? activeProfile.usesPrimaryAddons
      : typeof activeProfile?.uses_primary_addons === "boolean"
        ? activeProfile.uses_primary_addons
        : true;

  return usesPrimaryAddons ? 1 : profileId;
}

function extractAddonEntries(rows = []) {
  return (rows || [])
    .map((row) => ({
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
      enabled: row?.enabled !== false
    }))
    .filter((entry) => entry.url);
}

/**
 * Applies a cloud addon list locally, or declines to.
 *
 * Returns null when the pull came back empty while addons exist locally. A read
 * that returns no rows is indistinguishable from "the table is briefly
 * unavailable", and the old behaviour was to treat it as "the user deleted
 * everything": setAddonOrder([]) plus two replace:true writes wiped
 * installedAddonUrls, installedAddonDisplayNames and installedAddonEnabledStates
 * for the profile, with no error and no confirmation. Observed on a real device
 * while the backend was under load — the addon list vanished and the app fell
 * back to the onboarding screen.
 *
 * A sync read that returns nothing must never be able to destroy local state.
 * The local list is left alone and the next successful pull (or an explicit
 * removal, which goes through removeAddon) reconciles it.
 */
function applyPulledAddons(rows = []) {
  const entries = extractAddonEntries(rows);
  if (!entries.length) {
    const localUrls = addonRepository.getInstalledAddonUrls();
    if (localUrls.length) {
      console.warn(
        "Addon sync pull returned no rows while addons exist locally; keeping the local list",
        { localCount: localUrls.length }
      );
      return null;
    }
  }
  const cloudUrls = entries.map((entry) => entry.url).filter(Boolean);

  // Union rather than replace, cloud order first.
  //
  // The startup cycle pulls before it pushes (startupSyncService.requestSyncNow
  // with pushAfterPull), so a replace here deletes any addon that exists only on
  // this device and the following push then propagates the deletion. An addon
  // installed while the backend was unreachable — which is exactly when the push
  // that would have uploaded it failed — could never survive the next boot.
  //
  // The tradeoff is deliberate and worth stating: a removal performed on another
  // device no longer wins against this device's local copy, so it can reappear
  // here until removed locally too. Losing an addon the user installed is the
  // worse failure, and local removal still works and still pushes.
  const cloudSet = new Set(cloudUrls.map((url) => addonRepository.canonicalizeUrl(url)));
  const localOnlyUrls = addonRepository
    .getInstalledAddonUrls()
    .filter((url) => !cloudSet.has(addonRepository.canonicalizeUrl(url)));
  lastPullHadLocalOnly = localOnlyUrls.length > 0;
  if (localOnlyUrls.length) {
    console.info("Addon sync keeping addons present only on this device", {
      count: localOnlyUrls.length
    });
  }
  const urls = [...cloudUrls, ...localOnlyUrls];

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
        name: entry.displayName || entry.name || currentNames[cleanUrl] || ""
      };
    }),
    { replace: true }
  );
  addonRepository.setAddonEnabledStates(mergedEntries, { replace: true });
  return urls;
}

export const LibrarySyncService = {
  getLastPullStatus() {
    return lastPullStatus;
  },

  // Convergência nuvem<-local depois de um pull que confirmou divergência:
  // best-effort, uma tentativa, sem retry próprio (o próximo pull reavalia).
  schedulePushIfLocalOnly() {
    if (!lastPullHadLocalOnly) {
      return;
    }
    lastPullHadLocalOnly = false;
    void this.push().catch((error) => {
      console.warn("Addon sync convergence push failed", error);
    });
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
      const localUrls = addonRepository.getInstalledAddonUrls();
      const profileId = await resolveAddonProfileId();
      const ownerId = await AuthManager.getEffectiveUserId();
      let addonTableMissing = false;

      try {
        const addonRows = await SupabaseApi.select(
          ADDONS_TABLE,
          `user_id=eq.${encodeURIComponent(ownerId)}&profile_id=eq.${profileId}&select=*&order=sort_order.asc`,
          true
        );
        const addonUrls = applyPulledAddons(addonRows);
        if (addonUrls === null) {
          recordPullStatus("ok", { count: localUrls.length, keptLocal: true });
          return localUrls;
        }
        await addonRepository.setAddonOrder(addonUrls, { silent: true });
        recordPullStatus("ok", { count: addonUrls.length });
        this.schedulePushIfLocalOnly();
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
        const urls = applyPulledAddons(rows);
        if (urls === null) {
          recordPullStatus("ok", { count: localUrls.length, keptLocal: true });
          return localUrls;
        }
        await addonRepository.setAddonOrder(urls, { silent: true });
        recordPullStatus("ok", { count: urls.length });
        this.schedulePushIfLocalOnly();
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
          const urls = applyPulledAddons(rpcRows);
          if (urls === null) {
            recordPullStatus("ok", { count: localUrls.length, keptLocal: true });
            return localUrls;
          }
          await addonRepository.setAddonOrder(urls, { silent: true });
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
      const profileId = await resolveAddonProfileId();
      const urls = addonRepository.getInstalledAddonUrls();

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
            }))
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
