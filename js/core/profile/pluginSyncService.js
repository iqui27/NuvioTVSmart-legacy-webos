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

function diagnosticError(error) {
  const details = {
    name: String(error?.name || "Error"),
    message: String(error?.message || error || "Unknown error")
  };
  if (error?.code) details.code = String(error.code);
  if (error?.stack) details.stack = String(error.stack).slice(0, 1200);
  return details;
}

function diagnosticUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname}`;
  } catch (_) {
    return raw.split(/[?#]/, 1)[0].slice(0, 240);
  }
}

function diagnosticRow(row = {}) {
  const url = row?.url || row?.url_template || row?.urlTemplate;
  const type = row?.repo_type ?? row?.repoType ?? row?.type;
  let keys = [];
  try {
    keys = Object.keys(row).sort().slice(0, 40);
  } catch (_) {
    keys = [];
  }
  return {
    id: row?.id == null ? "" : String(row.id).slice(0, 128),
    name: row?.name == null ? "" : String(row.name).slice(0, 120),
    url: diagnosticUrl(url),
    type: type == null ? null : String(type),
    repoTypeDeclared: row?.repoTypeDeclared === true,
    enabled: row?.enabled,
    sortOrder: row?.sort_order ?? row?.sortOrder,
    keys
  };
}

function diagnosticState(state = {}) {
  return {
    syncDirty: state.syncDirty === true,
    repositoryCount: Array.isArray(state.repositories) ? state.repositories.length : 0,
    scraperCount: Array.isArray(state.scrapers) ? state.scrapers.length : 0,
    unknownRemoteRowsCount: Array.isArray(state.unknownRemoteRows)
      ? state.unknownRemoteRows.length
      : 0,
    rawRemoteRowsCount: Array.isArray(state.rawRemoteRows) ? state.rawRemoteRows.length : 0,
    repositories: (Array.isArray(state.repositories) ? state.repositories : [])
      .slice(0, 64)
      .map(diagnosticRow),
    unknownRemoteRows: (Array.isArray(state.unknownRemoteRows) ? state.unknownRemoteRows : [])
      .slice(0, 64)
      .map(diagnosticRow)
  };
}

// Sync diagnostics are exposed through the returned sync state/errors, not as
// a verbose console stream.
function logPluginSyncDiagnostic() {}

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
  const sourceRows = Array.isArray(rows) ? rows : [];
  const mappedRows = sourceRows
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
  logPluginSyncDiagnostic("remote rows mapped", {
    inputCount: sourceRows.length,
    outputCount: mappedRows.length,
    input: sourceRows.slice(0, 64).map(diagnosticRow),
    output: mappedRows.slice(0, 64).map(diagnosticRow)
  });
  return mappedRows;
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

function hasOpaqueRepositoryState(state) {
  return state.unknownRemoteRows.length > 0 || hasUnsupportedRepositoryState(state);
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
  const backoffActive = isSyncBackoffActive();
  const authenticated = AuthManager.isAuthenticated;
  logPluginSyncDiagnostic("push requested", {
    requestedProfileId: requestedId,
    targetProfileId,
    requireCurrentProfile,
    backoffActive,
    authenticated: authenticated === true,
    activeProfileId: String(ProfileManager.getActiveProfileId())
  });
  if (backoffActive || !authenticated) {
    logPluginSyncDiagnostic("push skipped", {
      requestedProfileId: requestedId,
      targetProfileId,
      reason: backoffActive ? "sync backoff" : "not authenticated"
    });
    return false;
  }
  // Android does not push from a secondary profile that inherits the primary
  // plugin set. Keep that rule here so a Web TV cannot accidentally publish the
  // primary profile's state from a read-only alias.
  const editable = PluginStore.canEdit(requestedId);
  if (!editable) {
    logPluginSyncDiagnostic("push skipped", {
      requestedProfileId: requestedId,
      targetProfileId,
      reason: "profile is read-only"
    });
    return false;
  }
  const currentProfile = isCurrentProfile(requestedId, targetProfileId);
  if (requireCurrentProfile && !currentProfile) {
    logPluginSyncDiagnostic("push skipped", {
      requestedProfileId: requestedId,
      targetProfileId,
      reason: "profile is no longer current"
    });
    return false;
  }

  const state = PluginStore.get(targetProfileId);
  logPluginSyncDiagnostic("push state", {
    requestedProfileId: requestedId,
    targetProfileId,
    revision: PluginStore.getRevision(targetProfileId),
    ...diagnosticState(state)
  });
  if (!state.syncDirty) {
    logPluginSyncDiagnostic("push skipped", {
      requestedProfileId: requestedId,
      targetProfileId,
      reason: "state is clean"
    });
    return false;
  }
  const hasUnsupportedState = hasUnsupportedRepositoryState(state);
  if (state.unknownRemoteRows.length || hasUnsupportedState) {
    // The typed RPC can only represent Android's JS/DEX repository contract.
    // Never silently omit an unknown/future row and turn it into a deletion.
    logPluginSyncDiagnostic("push skipped unsupported repository metadata", {
      requestedProfileId: requestedId,
      targetProfileId,
      unknownRemoteRows: state.unknownRemoteRows.length,
      hasUnsupportedRepositoryState: hasUnsupportedState,
      ...diagnosticState(state)
    });
    console.warn("Plugin sync push skipped: state contains unsupported repository metadata");
    return false;
  }
  const rows = buildPluginPushRows(state);
  const stateRevision = PluginStore.getRevision(targetProfileId);
  logPluginSyncDiagnostic("push RPC begin", {
    requestedProfileId: requestedId,
    targetProfileId,
    stateRevision,
    rowCount: rows.length,
    rows: rows.slice(0, 64).map(diagnosticRow)
  });
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
    logPluginSyncDiagnostic("push RPC success", {
      requestedProfileId: requestedId,
      targetProfileId,
      stateRevision,
      currentRevision: PluginStore.getRevision(targetProfileId),
      ...diagnosticState(PluginStore.get(targetProfileId))
    });
    return true;
  } catch (error) {
    // Deliberately no DELETE/UPSERT fallback: those operations are
    // destructive and cannot preserve future columns or repository types.
    logPluginSyncDiagnostic("push RPC failed", {
      requestedProfileId: requestedId,
      targetProfileId,
      stateRevision,
      error: diagnosticError(error)
    });
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
    logPluginSyncDiagnostic("pull requested", {
      requestedProfileId: requestedId,
      targetProfileId,
      pullKey,
      activeProfileId: String(ProfileManager.getActiveProfileId()),
      authenticated: AuthManager.isAuthenticated === true,
      backoffActive: isSyncBackoffActive(),
      ...diagnosticState(PluginStore.get(targetProfileId))
    });
    if (activePull) {
      logPluginSyncDiagnostic("pull joined existing request", { pullKey });
      return activePull;
    }

    let requestPromise = null;
    requestPromise = runProfileExclusive(targetProfileId, async () => {
      lastPullStatus = "loading";
      lastPullError = null;
      logPluginSyncDiagnostic("pull started", { requestedProfileId: requestedId, targetProfileId });
      if (isSyncBackoffActive()) {
        lastPullStatus = "deferred";
        logPluginSyncDiagnostic("pull skipped", {
          requestedProfileId: requestedId,
          targetProfileId,
          reason: "sync backoff"
        });
        return PluginManager.listRepositories();
      }
      if (!AuthManager.isAuthenticated) {
        lastPullStatus = "signed-out";
        logPluginSyncDiagnostic("pull skipped", {
          requestedProfileId: requestedId,
          targetProfileId,
          reason: "not authenticated"
        });
        return PluginManager.listRepositories();
      }

      // Android reads the remote snapshot before flushing a pending local push.
      // Keep that order here too: beginRemoteSync below prevents a new local
      // write from racing reconciliation, and endRemoteSync defers the push
      // until the complete remote snapshot has been applied. In particular, a
      // failed/unsupported push must never prevent the first useful pull.
      const pendingState = PluginStore.get(targetProfileId);
      if (pendingState.syncDirty) {
        logPluginSyncDiagnostic("pull has pending local state", {
          requestedProfileId: requestedId,
          targetProfileId,
          ...diagnosticState(pendingState)
        });
        if (hasOpaqueRepositoryState(pendingState)) {
          logPluginSyncDiagnostic("pull proceeds before pending push for opaque state", {
            requestedProfileId: requestedId,
            targetProfileId,
            reason: "remote pull must classify unsupported local metadata",
            ...diagnosticState(pendingState)
          });
        }
      }
      if (!isCurrentProfile(requestedId, targetProfileId)) {
        lastPullStatus = "stale";
        logPluginSyncDiagnostic("pull skipped", {
          requestedProfileId: requestedId,
          targetProfileId,
          reason: "profile is no longer current"
        });
        return PluginManager.listRepositories();
      }

      // Keep local writes from starting a competing push until the complete
      // remote snapshot has been reconciled, matching Android's
      // isSyncingFromRemote/pendingPushAfterSync flow.
      PluginStore.beginRemoteSync(targetProfileId);
      let pullRevision = PluginStore.getRevision(targetProfileId);
      logPluginSyncDiagnostic("remote pull transaction begun", {
        requestedProfileId: requestedId,
        targetProfileId,
        revision: pullRevision
      });
      try {
        const ownerId = String((await AuthManager.getEffectiveUserId()) || "").trim();
        if (!ownerId) {
          throw new Error("Unable to resolve sync owner for plugin sync");
        }
        logPluginSyncDiagnostic("sync owner resolved", {
          requestedProfileId: requestedId,
          targetProfileId,
          ownerResolved: true
        });
        if (!isCurrentProfile(requestedId, targetProfileId)) {
          lastPullStatus = "stale";
          logPluginSyncDiagnostic("pull skipped", {
            requestedProfileId: requestedId,
            targetProfileId,
            reason: "profile changed after owner resolution"
          });
          return PluginManager.listRepositories();
        }
        const rows = await SupabaseApi.select(
          TABLE,
          `user_id=eq.${encodeURIComponent(ownerId)}&profile_id=eq.${normalizeProfileId(targetProfileId)}&select=*&order=sort_order.asc`,
          true
        );
        logPluginSyncDiagnostic("remote rows selected", {
          requestedProfileId: requestedId,
          targetProfileId,
          rowCount: Array.isArray(rows) ? rows.length : 0,
          rows: (Array.isArray(rows) ? rows : []).slice(0, 64).map(diagnosticRow)
        });
        if (!AuthManager.isAuthenticated || !isCurrentProfile(requestedId, targetProfileId)) {
          lastPullStatus = "stale";
          logPluginSyncDiagnostic("pull skipped", {
            requestedProfileId: requestedId,
            targetProfileId,
            reason: !AuthManager.isAuthenticated
              ? "signed out during select"
              : "profile changed during select"
          });
          return PluginManager.listRepositories();
        }
        const currentRevision = PluginStore.getRevision(targetProfileId);
        if (currentRevision !== pullRevision && PluginStore.get(targetProfileId).syncDirty) {
          lastPullStatus = "local-pending";
          logPluginSyncDiagnostic("pull skipped", {
            requestedProfileId: requestedId,
            targetProfileId,
            reason: "local state changed during select",
            initialRevision: pullRevision,
            currentRevision,
            ...diagnosticState(PluginStore.get(targetProfileId))
          });
          return PluginManager.listRepositories();
        }
        // Local-only provider/settings changes are not part of the remote
        // repository snapshot. Continue from the latest revision so they do
        // not cause an otherwise valid pull to be skipped.
        pullRevision = currentRevision;
        const remotePlugins = mapRemotePluginRows(rows);
        logPluginSyncDiagnostic("remote plugins normalized", {
          requestedProfileId: requestedId,
          targetProfileId,
          pullRevision,
          rowCount: remotePlugins.length,
          rows: remotePlugins.slice(0, 64).map(diagnosticRow)
        });
        const reconciled = await PluginManager.reconcileWithRemoteRepoUrls(remotePlugins, {
          removeMissingLocal: true,
          authoritativeSnapshot: true,
          expectedRevision: pullRevision,
          profileId: targetProfileId
        });
        logPluginSyncDiagnostic("remote repositories reconciled", {
          requestedProfileId: requestedId,
          targetProfileId,
          ...diagnosticState(reconciled)
        });
        if (!isCurrentProfile(requestedId, targetProfileId)) {
          lastPullStatus = "stale";
          logPluginSyncDiagnostic("pull skipped", {
            requestedProfileId: requestedId,
            targetProfileId,
            reason: "profile changed after reconcile"
          });
          return reconciled;
        }
        if (PluginStore.get(targetProfileId).syncDirty) {
          lastPullStatus = "local-pending";
          logPluginSyncDiagnostic("pull completed with pending local state", {
            requestedProfileId: requestedId,
            targetProfileId,
            ...diagnosticState(PluginStore.get(targetProfileId))
          });
          return reconciled;
        }
        lastPullStatus = "ok";
        logPluginSyncDiagnostic("pull success", {
          requestedProfileId: requestedId,
          targetProfileId,
          ...diagnosticState(PluginStore.get(targetProfileId))
        });
        return reconciled;
      } finally {
        PluginStore.endRemoteSync(targetProfileId);
        logPluginSyncDiagnostic("remote pull transaction ended", {
          requestedProfileId: requestedId,
          targetProfileId,
          lastPullStatus,
          ...diagnosticState(PluginStore.get(targetProfileId))
        });
      }
    });
    pullInFlightByProfile.set(pullKey, requestPromise);
    try {
      return await requestPromise;
    } catch (error) {
      lastPullStatus = "error";
      lastPullError = error;
      logPluginSyncDiagnostic("pull failed", {
        requestedProfileId: requestedId,
        targetProfileId,
        error: diagnosticError(error)
      });
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
