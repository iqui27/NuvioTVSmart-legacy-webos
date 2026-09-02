import { AuthManager } from "../auth/authManager.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { PluginManager } from "../player/pluginManager.js";
import { PluginStore, getEffectivePluginProfileId } from "../../data/local/pluginStore.js";
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
  return rows
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
  return state.repositories
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
      url: repository.url,
      name: repository.name,
      enabled: repository.enabled !== false,
      sort_order: index,
      repo_type: repoType
    }));
}

export const PluginSyncService = {
  async pull() {
    if (isSyncBackoffActive() || !AuthManager.isAuthenticated) {
      return PluginManager.listRepositories();
    }
    try {
      const ownerId = await AuthManager.getEffectiveUserId();
      const profileId = normalizeProfileId();
      const rows = await SupabaseApi.select(
        TABLE,
        `user_id=eq.${encodeURIComponent(ownerId)}&profile_id=eq.${profileId}&select=*&order=sort_order.asc`,
        true
      );
      const remotePlugins = mapRemotePluginRows(rows);
      const local = PluginManager.listRepositories();
      // An empty/temporarily unavailable remote result must never remove local
      // repositories. This is also how Android protects a profile during a
      // partial sync or a newly provisioned account.
      if (!remotePlugins.length && local.length) return local;
      return PluginManager.reconcileWithRemoteRepoUrls(remotePlugins, {
        removeMissingLocal: remotePlugins.length > 0
      });
    } catch (error) {
      console.warn("Plugin sync pull failed", error);
      return PluginManager.listRepositories();
    }
  },

  async push(profileId = null) {
    if (isSyncBackoffActive() || !AuthManager.isAuthenticated) return false;
    // Android does not push from a secondary profile that inherits the
    // primary plugin set. Keep that rule here so a Web TV cannot accidentally
    // publish the primary profile's state from a read-only alias.
    if (profileId == null && !PluginStore.canEdit()) return false;
    if (profileId != null && !PluginStore.canEdit(profileId)) return false;
    const targetProfileId = getEffectivePluginProfileId(
      profileId == null ? getEffectivePluginProfileId() : profileId
    );
    const state = PluginStore.get(targetProfileId);
    if (!state.syncDirty) return false;
    if (state.unknownRemoteRows.length || state.legacySources.length) {
      // The old REST fallback deleted every row and could silently erase
      // unknown metadata. Keep the local state and wait for a typed RPC that
      // understands the complete repository contract.
      console.warn("Plugin sync push skipped: state contains unsupported repository metadata");
      return false;
    }
    const rows = buildPluginPushRows(state);
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
      PluginStore.clearDirty(targetProfileId);
      return true;
    } catch (error) {
      // Deliberately no DELETE/UPSERT fallback: those operations are
      // destructive and cannot preserve future columns or repository types.
      console.warn("Plugin sync push failed; local state retained", error);
      return false;
    }
  }
};
