import { AuthManager } from "../auth/authManager.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { TraktAuthStore } from "../../data/local/traktAuthStore.js";
import { ProfileManager } from "./profileManager.js";
import { getSyncClientId } from "../sync/syncClientIdentity.js";

const TRAKT_PROVIDER = "trakt";
const PULL_RPC = "sync_pull_provider_credentials";
const PUSH_RPC = "sync_push_provider_credentials";
const DELETE_RPC = "sync_delete_provider_credentials";
const TOKEN_FALLBACK_LIFETIME_SECONDS = 86400;

let syncInFlight = Promise.resolve();

// Resultado do último push da credencial Trakt para a nuvem. O push é o que
// torna o vínculo recuperável depois de um logout/401 (a credencial local é
// apagada pelo reset de conta). Medido em TV real (2026-08-26): o vínculo
// existia há dias e a nuvem nunca recebeu o provider `trakt`, porque o RPC
// sync_push_provider_credentials respondia 400 22023 "Unsupported provider
// credential: trakt" e o catch reduzia isso a um console.warn. Resultado: todo
// logout destruía o vínculo em silêncio. O estado abaixo torna a falha
// observável (tela de Tracking) em vez de engolida.
let lastPushStatus = { state: "idle", error: null, unsupported: false, at: 0 };

function recordPushStatus(state, error = null) {
  const message = error ? String(error.message || error) : null;
  lastPushStatus = {
    state,
    error: message,
    // 22023 / "Unsupported provider credential": o backend rejeita o provider
    // por whitelist. Permanente até o servidor mudar — sem retry automático.
    unsupported: Boolean(
      error &&
      (String(error.code || "") === "22023" ||
        (message || "").includes("Unsupported provider credential"))
    ),
    at: Date.now()
  };
}

function resolveProfileId(profileId = null) {
  const raw = Number(profileId ?? ProfileManager.getActiveProfileId() ?? 1);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.trunc(raw);
  }
  return 1;
}

function normalizeLifetimeSeconds(value) {
  const seconds = Number(value || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return TOKEN_FALLBACK_LIFETIME_SECONDS;
  }
  return Math.min(TOKEN_FALLBACK_LIFETIME_SECONDS, Math.trunc(seconds));
}

function credentialJsonFromState(state = {}) {
  const accessToken = String(state.accessToken || "").trim();
  const refreshToken = String(state.refreshToken || "").trim();
  if (!accessToken || !refreshToken) {
    return null;
  }
  const credential = {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: String(state.tokenType || "bearer").trim() || "bearer",
    created_at: Number(state.createdAt || Math.floor(Date.now() / 1000)),
    expires_in: normalizeLifetimeSeconds(state.expiresIn || TOKEN_FALLBACK_LIFETIME_SECONDS)
  };
  const username = String(state.username || "").trim();
  const userSlug = String(state.userSlug || "").trim();
  if (username) {
    credential.username = username;
  }
  if (userSlug) {
    credential.user_slug = userSlug;
  }
  return credential;
}

function stateFromCredentialJson(credential = {}) {
  if (!credential) {
    return null;
  }
  if (typeof credential === "string") {
    try {
      credential = JSON.parse(credential);
    } catch (_) {
      return null;
    }
  }
  if (typeof credential !== "object") {
    return null;
  }
  const accessToken = String(credential.access_token || credential.accessToken || "").trim();
  const refreshToken = String(credential.refresh_token || credential.refreshToken || "").trim();
  if (!accessToken || !refreshToken) {
    return null;
  }
  return {
    accessToken,
    refreshToken,
    tokenType: credential.token_type || credential.tokenType || "bearer",
    createdAt: Number(
      credential.created_at || credential.createdAt || Math.floor(Date.now() / 1000)
    ),
    expiresIn: normalizeLifetimeSeconds(
      credential.expires_in || credential.expiresIn || TOKEN_FALLBACK_LIFETIME_SECONDS
    ),
    username: credential.username || null,
    userSlug: credential.user_slug || credential.userSlug || null
  };
}

function syncSignature(state = {}) {
  return [
    state.accessToken || "",
    state.refreshToken || "",
    state.tokenType || "",
    state.createdAt == null ? "" : String(state.createdAt),
    state.expiresIn == null ? "" : String(normalizeLifetimeSeconds(state.expiresIn)),
    state.username || "",
    state.userSlug || ""
  ].join("|");
}

async function withSyncLock(task) {
  const previous = syncInFlight;
  let release;
  syncInFlight = new Promise((resolve) => {
    release = resolve;
  });
  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    release();
  }
}

async function fetchRemoteTraktState(profileId) {
  const credentials = await SupabaseApi.rpc(
    PULL_RPC,
    { p_profile_id: resolveProfileId(profileId) },
    true
  );
  const traktCredential = (Array.isArray(credentials) ? credentials : []).find(
    (entry) => String(entry?.provider || "").toLowerCase() === TRAKT_PROVIDER
  );
  return stateFromCredentialJson(
    traktCredential?.credential_json || traktCredential?.credentialJson || null
  );
}

export const TraktCredentialSyncService = {
  getLastPushStatus() {
    return lastPushStatus;
  },

  async pushCurrentToRemote(profileId = null) {
    const resolvedProfileId = resolveProfileId(profileId);
    return this.pushStateToRemote(TraktAuthStore.get(resolvedProfileId), resolvedProfileId);
  },

  /**
   * Reconciliação chamada no startup: garante que a credencial Trakt local e a
   * da nuvem convirjam nas DUAS direções.
   *
   * - Nuvem tem e difere do local → adota a da nuvem (comportamento antigo do
   *   pullFromRemote, preservado).
   * - Nuvem NÃO tem e o local tem → empurra. É este o caso que faltava: a
   *   credencial vivia só no localStorage e qualquer signOut (deliberado ou por
   *   401) a destruía sem cópia — perda permanente do vínculo, medida em TV
   *   real. Enquanto o backend rejeitar o provider (22023), o push falha e fica
   *   registrado em getLastPushStatus(); quando o servidor passar a aceitar,
   *   esta reconciliação repara as instalações existentes sozinha.
   */
  async reconcileWithRemote(profileId = null) {
    return withSyncLock(async () => {
      try {
        if (!AuthManager.isAuthenticated) {
          return false;
        }
        const resolvedProfileId = resolveProfileId(profileId);
        const remoteState = await fetchRemoteTraktState(resolvedProfileId);
        const localState = TraktAuthStore.get(resolvedProfileId);
        if (remoteState) {
          if (syncSignature(localState) === syncSignature(remoteState)) {
            return false;
          }
          TraktAuthStore.saveToken(remoteState, resolvedProfileId);
          TraktAuthStore.saveUser(
            { username: remoteState.username, userSlug: remoteState.userSlug },
            resolvedProfileId
          );
          return true;
        }
        if (!credentialJsonFromState(localState)) {
          return false;
        }
        return this.pushStateToRemoteUnlocked(localState, resolvedProfileId);
      } catch (error) {
        console.warn("Trakt credential sync reconcile failed", error);
        return false;
      }
    });
  },

  async pushStateToRemote(state = {}, profileId = null) {
    return withSyncLock(() => this.pushStateToRemoteUnlocked(state, profileId));
  },

  // Corpo do push sem o lock, para uso de quem já o segura (reconcile).
  async pushStateToRemoteUnlocked(state = {}, profileId = null) {
    try {
      if (!AuthManager.isAuthenticated) {
        return false;
      }
      const credentialJson = credentialJsonFromState(state);
      if (!credentialJson) {
        return false;
      }
      const resolvedProfileId = resolveProfileId(profileId);
      await SupabaseApi.rpc(
        PUSH_RPC,
        {
          p_profile_id: resolvedProfileId,
          p_origin_client_id: getSyncClientId(),
          p_credentials: [
            {
              provider: TRAKT_PROVIDER,
              credential_json: credentialJson
            }
          ]
        },
        true
      );
      recordPushStatus("ok");
      return true;
    } catch (error) {
      recordPushStatus("error", error);
      // console.error de propósito: esta falha significa que o vínculo Trakt
      // NÃO está protegido na nuvem e morrerá com o próximo logout/401.
      console.error(
        "Trakt credential sync push failed — o vínculo Trakt não tem backup na nuvem",
        error
      );
      return false;
    }
  },

  async pullFromRemote(profileId = null) {
    return withSyncLock(async () => {
      try {
        if (!AuthManager.isAuthenticated) {
          return false;
        }
        const resolvedProfileId = resolveProfileId(profileId);
        const credentials = await SupabaseApi.rpc(
          PULL_RPC,
          { p_profile_id: resolvedProfileId },
          true
        );
        const traktCredential = (Array.isArray(credentials) ? credentials : []).find(
          (entry) => String(entry?.provider || "").toLowerCase() === TRAKT_PROVIDER
        );
        const remoteState = stateFromCredentialJson(
          traktCredential?.credential_json || traktCredential?.credentialJson || null
        );
        if (!remoteState) {
          return false;
        }
        const localState = TraktAuthStore.get(resolvedProfileId);
        if (syncSignature(localState) === syncSignature(remoteState)) {
          return false;
        }
        TraktAuthStore.saveToken(remoteState, resolvedProfileId);
        TraktAuthStore.saveUser(
          { username: remoteState.username, userSlug: remoteState.userSlug },
          resolvedProfileId
        );
        return true;
      } catch (error) {
        console.warn("Trakt credential sync pull failed", error);
        return false;
      }
    });
  },

  async deleteRemote(profileId = null) {
    return withSyncLock(async () => {
      try {
        if (!AuthManager.isAuthenticated) {
          return false;
        }
        await SupabaseApi.rpc(
          DELETE_RPC,
          {
            p_profile_id: resolveProfileId(profileId),
            p_origin_client_id: getSyncClientId(),
            p_provider: TRAKT_PROVIDER
          },
          true
        );
        return true;
      } catch (error) {
        console.warn("Trakt credential sync delete failed", error);
        return false;
      }
    });
  }
};
