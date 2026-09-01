import { AuthManager } from "../auth/authManager.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { CollectionsStore } from "../../data/local/collectionsStore.js";
import { ProfileManager } from "./profileManager.js";
import { getSyncBackoffRemainingMs, isSyncBackoffActive } from "../sync/syncBackoffPolicy.js";

const PULL_RPC = "sync_pull_collections";
const PUSH_RPC = "sync_push_collections";
const PUSH_DEBOUNCE_MS = 500;

function resolveProfileId(profileId = null) {
  const raw = Number(profileId ?? ProfileManager.getActiveProfileId() ?? 1);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.trunc(raw);
  }
  return 1;
}

/*
 * Igualdade estrutural, independente da ordem das chaves — mesma semantica do
 * stableStringify que vivia aqui, sem o custo dele.
 *
 * O stableStringify chamava JSON.stringify POR FOLHA e POR CHAVE e concatenava
 * string em cada nivel da arvore. Sobre as duas arvores de colecoes (~677 KB cada)
 * isso deu ~42 mil chamadas e 1060 ms medidos na OLED65C9 — em TODO boot, no main
 * thread, exatamente enquanto a Home pinta a primeira fileira. Esta caminhada nao
 * aloca string nenhuma.
 *
 * Nao e uma guarda nova: e a MESMA comparacao que ja decidia se o replaceForProfile
 * roda, so que barata. A distincao importa porque a guarda por hash de localStorage
 * ja foi tentada e revertida neste projeto — ela ADICIONAVA leitura de 1,1 MB e
 * custava mais que o render que evitava. Aqui so se remove trabalho.
 *
 * Divergencia teorica com o stableStringify: NaN e undefined. Nenhum dos dois
 * sobrevive ao normalizeState (Number.isFinite/stringOrNull em todo campo).
 */
function deepEqual(left, right) {
  if (left === right) {
    return true;
  }
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
    return false;
  }
  const leftIsArray = Array.isArray(left);
  if (leftIsArray !== Array.isArray(right)) {
    return false;
  }
  if (leftIsArray) {
    if (left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (!deepEqual(left[index], right[index])) {
        return false;
      }
    }
    return true;
  }
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) {
    return false;
  }
  for (let index = 0; index < leftKeys.length; index += 1) {
    const key = leftKeys[index];
    if (!Object.prototype.hasOwnProperty.call(right, key) || !deepEqual(left[key], right[key])) {
      return false;
    }
  }
  return true;
}

function parseRemoteCollectionsPayload(blob = null) {
  const raw = blob?.collections_json ?? blob?.collectionsJson ?? blob ?? [];
  if (typeof raw === "string") {
    return CollectionsStore.importFromJson(raw);
  }
  // raw ja e objeto aqui: serializar so para o importFromJson desserializar de novo
  // era um roundtrip de ~677 KB por boot. normalizeState nao lanca para objeto/array.
  return CollectionsStore.normalizeCollections(raw);
}

export const CollectionSyncService = {
  syncingFromRemoteProfiles: new Set(),
  pushTimers: new Map(),

  isSyncingFromRemote(profileId = null) {
    return this.syncingFromRemoteProfiles.has(resolveProfileId(profileId));
  },

  async push(profileId = null) {
    if (!AuthManager.isAuthenticated || isSyncBackoffActive()) {
      return false;
    }
    const resolvedProfileId = resolveProfileId(profileId);
    try {
      const collectionsJson = CollectionsStore.exportCurrentProfileJson(resolvedProfileId);
      const parsedJson = CollectionsStore.importFromJson(collectionsJson);
      await SupabaseApi.rpc(
        PUSH_RPC,
        {
          p_profile_id: resolvedProfileId,
          p_collections_json: parsedJson
        },
        true
      );
      return true;
    } catch (error) {
      console.warn("Collection sync push failed", error);
      return false;
    }
  },

  async pull(profileId = null) {
    if (!AuthManager.isAuthenticated || isSyncBackoffActive()) {
      return false;
    }
    const resolvedProfileId = resolveProfileId(profileId);
    try {
      const rows = await SupabaseApi.rpc(
        PULL_RPC,
        {
          p_profile_id: resolvedProfileId
        },
        true
      );
      const blob = Array.isArray(rows) ? rows[0] || null : rows || null;
      if (!blob) {
        return false;
      }

      const remoteCollections = parseRemoteCollectionsPayload(blob);
      const localCollections = CollectionsStore.getForProfile(resolvedProfileId);
      if (deepEqual(remoteCollections, localCollections)) {
        return false;
      }

      this.syncingFromRemoteProfiles.add(resolvedProfileId);
      try {
        CollectionsStore.replaceForProfile(resolvedProfileId, remoteCollections, {
          silentSync: true
        });
      } finally {
        this.syncingFromRemoteProfiles.delete(resolvedProfileId);
      }
      return true;
    } catch (error) {
      console.warn("Collection sync pull failed", error);
      return false;
    }
  },

  triggerPush(profileId = null, delayMs = PUSH_DEBOUNCE_MS) {
    if (!AuthManager.isAuthenticated) {
      return;
    }
    const resolvedProfileId = resolveProfileId(profileId);
    if (this.isSyncingFromRemote(resolvedProfileId)) {
      return;
    }
    const existingTimer = this.pushTimers.get(resolvedProfileId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    const cooldownMs = getSyncBackoffRemainingMs();
    const effectiveDelayMs = Math.max(
      PUSH_DEBOUNCE_MS,
      Number(delayMs) || 0,
      cooldownMs > 0 ? cooldownMs + 50 : 0
    );
    const timerId = setTimeout(async () => {
      this.pushTimers.delete(resolvedProfileId);
      const didPush = await this.push(resolvedProfileId);
      if (!didPush && isSyncBackoffActive()) {
        this.triggerPush(resolvedProfileId, getSyncBackoffRemainingMs() + 50);
      }
    }, effectiveDelayMs);
    this.pushTimers.set(resolvedProfileId, timerId);
  }
};
