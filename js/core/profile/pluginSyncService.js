import { AuthManager } from "../auth/authManager.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { PluginManager } from "../player/pluginManager.js";
import { PluginStore, getEffectivePluginProfileId } from "../../data/local/pluginStore.js";
import { ProfileManager } from "./profileManager.js";
import { isSyncBackoffActive } from "../sync/syncBackoffPolicy.js";
import { getSyncClientId } from "../sync/syncClientIdentity.js";
import {
  canonicalizePluginUrl,
  isExternalDexRepository,
  normalizePluginRepositoryType,
  PLUGIN_REPOSITORY_TYPES
} from "../player/pluginModels.js";

const TABLE = "plugins";
const PUSH_RPC = "sync_push_plugins";
let lastPullStatus = "idle";
let lastPullError = null;
const pullInFlightByProfile = new Map();
const syncOperationByProfile = new Map();

function normalizeProfileId(profileId = null) {
  const raw = Number(profileId == null ? getEffectivePluginProfileId() : profileId);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 1;
}

/**
 * Convert the typed cloud rows into the local Web model without dropping the
 * repository type or its enabled value. EXTERNAL_DEX rows are intentionally
 * kept in this same round-trip contract even though Web never executes them.
 */
export function mapRemotePluginRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const url = canonicalizePluginUrl(row?.url || row?.url_template || row?.urlTemplate);
      if (!url) return null;
      const hasExplicitType = row?.repo_type != null || row?.repoType != null || row?.type != null;
      const inferredType =
        !hasExplicitType && /\.cs3(?:$|[?#])/i.test(url)
          ? PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX
          : null;
      // A missing/null repo_type is an old Android-compatible row, not a
      // future enum. Let PluginManager inspect its document and classify it;
      // explicit unknown/future values remain opaque there.
      const repoType = hasExplicitType
        ? normalizePluginRepositoryType(
            row?.repo_type ?? row?.repoType ?? row?.type,
            PLUGIN_REPOSITORY_TYPES.UNKNOWN
          )
        : inferredType;
      return {
        url:
          repoType === PLUGIN_REPOSITORY_TYPES.NUVIO_JS
            ? canonicalizePluginUrl(url, { manifest: true })
            : url,
        name: String(row?.name || "").trim(),
        enabled: row?.enabled !== false,
        repoType,
        repoTypeDeclared: hasExplicitType,
        sortOrder: Number(row?.sort_order || 0) || 0,
        raw: row
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

/**
 * The RPC receives the complete typed repository set. In particular, omitting
 * an EXTERNAL_DEX row could be interpreted as a deletion by the cloud sync.
 */
export function buildPluginPushRows(state) {
  return (Array.isArray(state?.repositories) ? state.repositories : [])
    .map((repository) => ({
      repository,
      repoType: isExternalDexRepository(repository)
        ? PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX
        : normalizePluginRepositoryType(repository.type)
    }))
    .filter(({ repoType }) =>
      [PLUGIN_REPOSITORY_TYPES.NUVIO_JS, PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX].includes(repoType)
    )
    .map(({ repository, repoType }, index) => ({
      url:
        repoType === PLUGIN_REPOSITORY_TYPES.NUVIO_JS
          ? canonicalizePluginUrl(repository.url, { manifest: true })
          : canonicalizePluginUrl(repository.url),
      name: String(repository.name || ""),
      enabled: repository.enabled !== false,
      sort_order: index,
      repo_type: repoType
    }));
}

function hasUnsupportedRepositoryState(state) {
  return state.repositories.some((repository) => {
    const repoType = isExternalDexRepository(repository)
      ? PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX
      : normalizePluginRepositoryType(repository.type);
    return ![PLUGIN_REPOSITORY_TYPES.NUVIO_JS, PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX].includes(
      repoType
    );
  });
}

function hasSameRemoteRepositoryRows(left, right) {
  return JSON.stringify(buildPluginPushRows(left)) === JSON.stringify(right);
}

function requestedProfileId(profileId = null) {
  return String(profileId == null ? ProfileManager.getActiveProfileId() : profileId || "1");
}

function isCurrentProfile(profileId, effectiveProfileId) {
  return (
    String(ProfileManager.getActiveProfileId()) === String(profileId) &&
    String(getEffectivePluginProfileId(profileId)) === String(effectiveProfileId)
  );
}

function runProfileExclusive(profileId, task) {
  const key = String(profileId || "1");
  const previous = syncOperationByProfile.get(key) || Promise.resolve();
  let current = null;
  current = previous
    .catch(() => {})
    .then(task)
    .finally(() => {
      if (syncOperationByProfile.get(key) === current) {
        syncOperationByProfile.delete(key);
      }
    });
  syncOperationByProfile.set(key, current);
  return current;
}

async function pushProfile(requestedId, targetProfileId, { requireCurrentProfile = false } = {}) {
  if (isSyncBackoffActive() || !AuthManager.isAuthenticated) return false;
  // Android does not push from a secondary profile that inherits the primary
  // plugin set. Keep that rule here so a Web TV cannot accidentally publish the
  // primary profile's state from a read-only alias.
  if (!PluginStore.canEdit(requestedId)) return false;
  if (requireCurrentProfile && !isCurrentProfile(requestedId, targetProfileId)) return false;

  const state = PluginStore.get(targetProfileId);
  if (!state.syncDirty) return false;
  if (state.unknownRemoteRows.length || hasUnsupportedRepositoryState(state)) {
    // The typed RPC can only represent Android's JS/DEX repository contract.
    // Never silently omit an unknown/future row and turn it into a deletion.
    console.warn("Plugin sync push skipped: state contains unsupported repository metadata");
    return false;
  }
  const rows = buildPluginPushRows(state);
  const stateRevision = PluginStore.getRevision(targetProfileId);
  try {
    await SupabaseApi.rpc(
      PUSH_RPC,
      {
        p_profile_id: normalizeProfileId(targetProfileId),
        p_plugins: rows,
        p_origin_client_id: getSyncClientId()
      },
      true
    );
    // A local-only setting/cache write changes the state revision but not the
    // cloud repository rows. Clear the original dirty bit in that case; keep
    // it when a repository row or unsupported metadata changed during the RPC.
    const currentState = PluginStore.get(targetProfileId);
    const currentStateIsPushable =
      !currentState.unknownRemoteRows.length && !hasUnsupportedRepositoryState(currentState);
    if (currentStateIsPushable && hasSameRemoteRepositoryRows(currentState, rows)) {
      PluginStore.clearDirty(targetProfileId);
    } else {
      PluginStore.clearDirty(targetProfileId, stateRevision);
    }
    return true;
  } catch (error) {
    // Deliberately no DELETE/UPSERT fallback: those operations are
    // destructive and cannot preserve future columns or repository types.
    console.warn("Plugin sync push failed; local state retained", error);
    return false;
  }
}

export const PluginSyncService = {
  getLastPullStatus() {
    return lastPullStatus;
  },

  getLastPullError() {
    return lastPullError;
  },

  async pull(profileId = null) {
    const requestedId = requestedProfileId(profileId);
    const targetProfileId = String(getEffectivePluginProfileId(requestedId) || "1");
    const pullKey = `${requestedId}:${targetProfileId}`;
    const activePull = pullInFlightByProfile.get(pullKey);
    if (activePull) return activePull;

    let requestPromise = null;
    requestPromise = runProfileExclusive(targetProfileId, async () => {
      lastPullStatus = "loading";
      lastPullError = null;
      if (isSyncBackoffActive()) {
        lastPullStatus = "deferred";
        return PluginManager.listRepositories();
      }
      if (!AuthManager.isAuthenticated) {
        lastPullStatus = "signed-out";
        return PluginManager.listRepositories();
      }

      // A route-entry pull can race the 500 ms local-write debounce. Publish a
      // pending local snapshot first; otherwise an older remote snapshot could
      // re-add a removed repository or erase one just added on this TV.
      if (PluginStore.get(targetProfileId).syncDirty) {
        await pushProfile(requestedId, targetProfileId);
        if (PluginStore.get(targetProfileId).syncDirty) {
          lastPullStatus = isSyncBackoffActive() ? "deferred" : "local-pending";
          PluginStore.flushCloudSync(targetProfileId);
          return PluginManager.listRepositories();
        }
      }
      if (!isCurrentProfile(requestedId, targetProfileId)) {
        lastPullStatus = "stale";
        return PluginManager.listRepositories();
      }

      // Keep local writes from starting a competing push until the complete
      // remote snapshot has been reconciled, matching Android's
      // isSyncingFromRemote/pendingPushAfterSync flow.
      PluginStore.beginRemoteSync(targetProfileId);
      let pullRevision = PluginStore.getRevision(targetProfileId);
      try {
        const ownerId = String((await AuthManager.getEffectiveUserId()) || "").trim();
        if (!ownerId) {
          throw new Error("Unable to resolve sync owner for plugin sync");
        }
        if (!isCurrentProfile(requestedId, targetProfileId)) {
          lastPullStatus = "stale";
          return PluginManager.listRepositories();
        }
        const rows = await SupabaseApi.select(
          TABLE,
          `user_id=eq.${encodeURIComponent(ownerId)}&profile_id=eq.${normalizeProfileId(targetProfileId)}&select=*&order=sort_order.asc`,
          true
        );
        if (!AuthManager.isAuthenticated || !isCurrentProfile(requestedId, targetProfileId)) {
          lastPullStatus = "stale";
          return PluginManager.listRepositories();
        }
        const currentRevision = PluginStore.getRevision(targetProfileId);
        if (currentRevision !== pullRevision && PluginStore.get(targetProfileId).syncDirty) {
          lastPullStatus = "local-pending";
          return PluginManager.listRepositories();
        }
        // Local-only provider/settings changes are not part of the remote
        // repository snapshot. Continue from the latest revision so they do
        // not cause an otherwise valid pull to be skipped.
        pullRevision = currentRevision;
        const remotePlugins = mapRemotePluginRows(rows);
        const reconciled = await PluginManager.reconcileWithRemoteRepoUrls(remotePlugins, {
          removeMissingLocal: true,
          authoritativeSnapshot: true,
          expectedRevision: pullRevision,
          profileId: targetProfileId
        });
        if (!isCurrentProfile(requestedId, targetProfileId)) {
          lastPullStatus = "stale";
          return reconciled;
        }
        if (PluginStore.get(targetProfileId).syncDirty) {
          lastPullStatus = "local-pending";
          return reconciled;
        }
        lastPullStatus = "ok";
        return reconciled;
      } finally {
        PluginStore.endRemoteSync(targetProfileId);
      }
    });
    pullInFlightByProfile.set(pullKey, requestPromise);
    try {
      return await requestPromise;
    } catch (error) {
      lastPullStatus = "error";
      lastPullError = error;
      console.warn("Plugin sync pull failed", error);
      return PluginManager.listRepositories();
    } finally {
      if (pullInFlightByProfile.get(pullKey) === requestPromise) {
        pullInFlightByProfile.delete(pullKey);
      }
    }
  },

  async push(profileId = null) {
    const requestedId = requestedProfileId(profileId);
    const targetProfileId = String(getEffectivePluginProfileId(requestedId) || "1");
    return runProfileExclusive(targetProfileId, () =>
      pushProfile(requestedId, targetProfileId, { requireCurrentProfile: profileId == null })
    );
  }
};
