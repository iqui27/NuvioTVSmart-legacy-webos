import { AuthManager } from "../auth/authManager.js";
import { LocalStore } from "../storage/localStore.js";
import { SessionStore } from "../storage/sessionStore.js";
import { addonRepository } from "../../data/repository/addonRepository.js";
import { ProfileManager } from "./profileManager.js";
import { ProfileSyncService } from "./profileSyncService.js";
import { LibrarySyncService } from "./librarySyncService.js";
import { WatchProgressSyncService } from "./watchProgressSyncService.js";
import { SavedLibrarySyncService } from "./savedLibrarySyncService.js";
import { WatchedItemsSyncService } from "./watchedItemsSyncService.js";
import { PluginSyncService } from "./pluginSyncService.js";
import { ProfileSettingsSyncService } from "./profileSettingsSyncService.js";
import { ProviderCredentialSyncService } from "./providerCredentialSyncService.js";
// Mantidos apesar de o upstream ter apagado os dois em a67cbc5 — ver a nota na
// chamada dentro de syncProfileScopedSurfaces.
import { TraktCredentialSyncService } from "./traktCredentialSyncService.js";
import { SimklCredentialSyncService } from "./simklCredentialSyncService.js";
import { SimklSyncService } from "../../data/repository/simklSyncService.js";
import { CollectionSyncService } from "./collectionSyncService.js";
import { HomeCatalogSettingsSyncService } from "./homeCatalogSettingsSyncService.js";
import { ThemeManager } from "../../ui/theme/themeManager.js";
import { MemberAccessRepository } from "../../data/remote/supabase/memberAccessRepository.js";
import { I18n } from "../../i18n/index.js";
import { hasProfileSettingsCloudSyncPending } from "../../data/local/profileScopedStore.js";
import {
  getSyncBackoffRemainingMs,
  isSyncBackoffActive,
  resetSyncBackoff
} from "../sync/syncBackoffPolicy.js";

const FOREGROUND_ACTIVITY_PULL_DELAY_MS = 2500;
const FOREGROUND_ACTIVITY_PULL_MIN_INTERVAL_MS = 2 * 60 * 1000;
const PERIODIC_SURFACE_PULL_INTERVAL_MS = 15 * 60 * 1000;
const ADDON_PUSH_DEBOUNCE_MS = 1000;
const MAX_PULL_ATTEMPTS = 3;
const FORCE_RESYNC_MIN_INTERVAL_MS = 30000;
const FULL_STARTUP_PULL_TTL_MS = 6 * 60 * 60 * 1000;
const STARTUP_SYNC_STATE_KEY = "startupSyncState";
const syncPullCompletedListeners = new Set();

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeProfileId(value) {
  const normalized = String(value ?? "").trim();
  return normalized || "1";
}

function decodeJwtPayload(token) {
  try {
    const [, payload] = String(token || "").split(".");
    if (!payload || typeof atob !== "function") {
      return null;
    }
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch (_) {
    return null;
  }
}

function currentSyncKey(profileId = null) {
  const userId = String(decodeJwtPayload(SessionStore.accessToken)?.sub || "authenticated");
  return `${userId}:p${normalizeProfileId(profileId ?? ProfileManager.getActiveProfileId())}`;
}

function readStartupSyncState() {
  const value = LocalStore.get(STARTUP_SYNC_STATE_KEY, {});
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function canUsePersistedWarmSync(key, includeProfileSettings, now = Date.now()) {
  const entry = readStartupSyncState()[key];
  if (!entry || typeof entry !== "object") {
    return false;
  }
  const lastFullPullAtMs = Number(entry.lastFullPullAtMs || 0);
  return (
    lastFullPullAtMs > 0 &&
    now - lastFullPullAtMs < FULL_STARTUP_PULL_TTL_MS &&
    (!includeProfileSettings || entry.lastFullPullIncludedProfileSettings === true)
  );
}

// A reconciliacao da credencial Trakt precisa rodar em TODO boot, e nao so
// no pull completo: o caminho "warm" (FULL_STARTUP_PULL_TTL_MS = 6h) retorna
// cedo e pulava o bloco que a chamava, entao numa TV que reinicia dentro da
// janela de 6h o vinculo continuava sem copia na nuvem — exatamente o estado
// que faz qualquer signOut ou 401 destruir o Trakt em definitivo.
//
// Roda DESACOPLADA (sem await): e um pull pequeno mais, no pior caso, um push,
// e o boot destas TVs e caro o suficiente para nao pagar por isso na frente do
// primeiro paint. reconcileWithRemote() ja trata os proprios erros.
function reconcileTraktCredentialDetached(profileId) {
  if (isSyncBackoffActive() || !AuthManager.isAuthenticated) {
    return;
  }
  Promise.resolve()
    .then(() => TraktCredentialSyncService.reconcileWithRemote(profileId))
    .catch((error) => {
      console.warn("Trakt credential reconcile failed on startup", error);
    });
}

function runSurface(label, task) {
  if (isSyncBackoffActive()) {
    return Promise.resolve({ ok: false, deferred: true });
  }
  return Promise.resolve()
    .then(task)
    .then((value) => ({ ok: true, value }))
    .catch((error) => {
      console.warn(`Startup sync ${label} failed; keeping local state`, error);
      return { ok: false, error };
    });
}

/**
 * Uma superficie so conta como "nao mexeu na Home" quando ela rodou ate o fim
 * E disse explicitamente que nao aplicou nada (`value === false`, que e o que
 * todos os pulls com semantica booleana devolvem quando a assinatura remota
 * bate com a local). Erro, deferimento por backoff ou retorno de outro formato
 * contam como mudanca: errar para o lado de repintar e barato, errar para o
 * lado de deixar a tela obsoleta nao e.
 */
function surfaceChangedHomeInputs(result) {
  return !(result && result.ok === true && result.value === false);
}

// Mesmo portao do resto da instrumentacao da Home (`__NUVIO_DEBUG_HOME_PERF__`,
// lido na hora da chamada), para que uma unica sessao de CDP atribua tudo.
// Sem isto nao da para saber QUAL superficie continuou dizendo "mudei" e
// impediu o refresh de ser dispensado.
function logSurfaceChange(label, changed) {
  if (!globalThis.__NUVIO_DEBUG_HOME_PERF__) {
    return;
  }
  try {
    console.info(`[home-perf] syncSurface`, {
      surface: label,
      changedHomeInputs: Boolean(changed)
    });
  } catch (_) {}
}

function notifySyncPullCompleted(event = {}) {
  syncPullCompletedListeners.forEach((listener) => {
    try {
      listener(event);
    } catch (error) {
      console.warn("Startup sync completion listener failed", error);
    }
  });
}

export const StartupSyncService = {
  started: false,
  intervalId: null,
  libraryIntervalId: null,
  foregroundPullTimer: null,
  foregroundPullPromise: null,
  lastForegroundPullKey: null,
  lastForegroundPullAtMs: 0,
  inFlight: false,
  inFlightPromise: null,
  inFlightGeneration: 0,
  watchStateInFlightPromise: null,
  watchStateInFlightGeneration: 0,
  libraryInFlightPromise: null,
  libraryInFlightGeneration: 0,
  profileScopedSyncEnabled: false,
  addonPushTimer: null,
  backoffRetryTimer: null,
  backoffRetryNotifyPullCompleted: false,
  unsubscribeAddonChanges: null,
  pendingSyncRequest: null,
  runGeneration: 0,
  lastPulledKey: null,
  lastPulledIncludedProfileSettings: false,
  lastPulledAtMs: 0,
  lastPullCompleted: false,

  isCurrentRun(generation) {
    return this.started && this.runGeneration === generation;
  },

  isCurrentProfile(profileId, key = currentSyncKey(profileId)) {
    return (
      key === currentSyncKey() && String(profileId) === String(ProfileManager.getActiveProfileId())
    );
  },

  scheduleBackoffRetry({ notifyPullCompleted = false } = {}) {
    if (!this.started || !AuthManager.isAuthenticated) {
      return;
    }
    const remainingMs = getSyncBackoffRemainingMs();
    if (remainingMs <= 0) {
      return;
    }
    this.backoffRetryNotifyPullCompleted = Boolean(
      this.backoffRetryNotifyPullCompleted || notifyPullCompleted
    );
    if (this.backoffRetryTimer) {
      return;
    }
    this.backoffRetryTimer = setTimeout(
      () => {
        this.backoffRetryTimer = null;
        const shouldNotifyPullCompleted = Boolean(this.backoffRetryNotifyPullCompleted);
        this.backoffRetryNotifyPullCompleted = false;
        void this.requestSyncNow({
          force: true,
          includeProfileSettings: true,
          notifyPullCompleted: shouldNotifyPullCompleted
        }).catch((error) => {
          console.warn("Scheduled startup sync retry failed", error);
        });
      },
      Math.max(1000, remainingMs + 50)
    );
  },

  queuePendingSyncRequest({
    force = true,
    includeProfileSettings = true,
    pushAfterPull = false,
    notifyPullCompleted = false
  }) {
    const current = this.pendingSyncRequest || {};
    this.pendingSyncRequest = {
      force: Boolean(current.force || force),
      includeProfileSettings: Boolean(current.includeProfileSettings || includeProfileSettings),
      pushAfterPull: Boolean(current.pushAfterPull || pushAfterPull),
      notifyPullCompleted: Boolean(current.notifyPullCompleted || notifyPullCompleted)
    };
  },

  markFullPullSucceeded(key, includeProfileSettings) {
    const now = Date.now();
    const previous = readStartupSyncState()[key] || {};
    const included = Boolean(
      includeProfileSettings || previous.lastFullPullIncludedProfileSettings === true
    );
    this.lastPulledKey = key;
    this.lastPulledIncludedProfileSettings = included;
    this.lastPulledAtMs = now;
    this.lastForegroundPullKey = key;
    this.lastForegroundPullAtMs = now;
    this.lastPullCompleted = true;
    LocalStore.set(STARTUP_SYNC_STATE_KEY, {
      ...readStartupSyncState(),
      [key]: {
        lastFullPullAtMs: now,
        lastFullPullIncludedProfileSettings: included
      }
    });
  },

  async start({ profileScopedSyncEnabled = false, runInitialPull = true } = {}) {
    if (this.started) {
      if (profileScopedSyncEnabled) {
        this.profileScopedSyncEnabled = true;
      }
      return;
    }
    this.started = true;
    this.runGeneration += 1;
    this.inFlight = false;
    this.profileScopedSyncEnabled = Boolean(profileScopedSyncEnabled);

    this.unsubscribeAddonChanges = addonRepository.onInstalledAddonsChanged(() => {
      this.scheduleAddonPush();
    });

    if (runInitialPull) {
      await this.requestSyncNow({ force: false, includeProfileSettings: true });
    }

    if (!this.started) {
      return;
    }
    this.intervalId = setInterval(() => {
      this.scheduleSurfacePull("periodic");
    }, PERIODIC_SURFACE_PULL_INTERVAL_MS);
  },

  stop() {
    this.started = false;
    this.runGeneration += 1;
    this.profileScopedSyncEnabled = false;
    this.pendingSyncRequest = null;
    this.lastPulledKey = null;
    this.lastPulledIncludedProfileSettings = false;
    this.lastPulledAtMs = 0;
    this.lastPullCompleted = false;
    this.lastForegroundPullKey = null;
    this.lastForegroundPullAtMs = 0;
    if (this.foregroundPullTimer) {
      clearTimeout(this.foregroundPullTimer);
      this.foregroundPullTimer = null;
    }
    this.foregroundPullPromise = null;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.libraryIntervalId) {
      clearInterval(this.libraryIntervalId);
      this.libraryIntervalId = null;
    }
    if (this.addonPushTimer) {
      clearTimeout(this.addonPushTimer);
      this.addonPushTimer = null;
    }
    if (this.backoffRetryTimer) {
      clearTimeout(this.backoffRetryTimer);
      this.backoffRetryTimer = null;
    }
    this.backoffRetryNotifyPullCompleted = false;
    if (this.unsubscribeAddonChanges) {
      this.unsubscribeAddonChanges();
      this.unsubscribeAddonChanges = null;
    }
    resetSyncBackoff();
  },

  enableProfileScopedSync() {
    this.profileScopedSyncEnabled = true;
  },

  // `true` ate que um pull complete e prove o contrario: antes disso ninguem
  // sabe se o que esta na tela corresponde a nuvem.
  lastPullChangedHomeInputs: true,

  markHomeInputsChanged(changed) {
    if (changed) {
      this.lastPullChangedHomeInputs = true;
    }
  },

  subscribeToPullCompleted(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    syncPullCompletedListeners.add(listener);
    return () => syncPullCompletedListeners.delete(listener);
  },

  scheduleSurfacePull(reason = "foreground", delayMs = 0, minIntervalMs = 0, force = false) {
    if (!this.started || !this.profileScopedSyncEnabled || !AuthManager.isAuthenticated) {
      return false;
    }
    const profileId = ProfileManager.getActiveProfileId();
    const key = currentSyncKey(profileId);
    const now = Date.now();
    if (this.inFlightPromise || this.foregroundPullTimer || this.foregroundPullPromise) {
      return false;
    }
    if (
      !force &&
      this.lastForegroundPullKey === key &&
      this.lastForegroundPullAtMs > 0 &&
      now >= this.lastForegroundPullAtMs &&
      now - this.lastForegroundPullAtMs < minIntervalMs
    ) {
      return false;
    }

    this.foregroundPullTimer = setTimeout(
      () => {
        this.foregroundPullTimer = null;
        if (!this.started || !this.profileScopedSyncEnabled || !AuthManager.isAuthenticated) {
          return;
        }
        if (this.inFlightPromise) {
          return;
        }
        let foregroundPullPromise = null;
        foregroundPullPromise = Promise.all([
          this.requestWatchStateSyncNow(),
          this.requestLibrarySyncNow()
        ])
          .then(([watchSucceeded, librarySucceeded]) => {
            if (watchSucceeded && librarySucceeded) {
              this.lastForegroundPullKey = key;
              this.lastForegroundPullAtMs = Date.now();
            }
            return Boolean(watchSucceeded && librarySucceeded);
          })
          .catch((error) => {
            console.warn(`Startup sync ${reason} surface pull failed`, error);
            return false;
          })
          .finally(() => {
            if (this.foregroundPullPromise === foregroundPullPromise) {
              this.foregroundPullPromise = null;
            }
          });
        this.foregroundPullPromise = foregroundPullPromise;
      },
      Math.max(0, Number(delayMs) || 0)
    );
    return true;
  },

  requestForegroundSync(force = false) {
    return this.scheduleSurfacePull(
      "foreground",
      force ? 0 : FOREGROUND_ACTIVITY_PULL_DELAY_MS,
      force ? 0 : FOREGROUND_ACTIVITY_PULL_MIN_INTERVAL_MS,
      force
    );
  },

  async requestSyncNow({
    force = true,
    includeProfileSettings = true,
    allowWarmRepeat = false,
    pushAfterPull = false,
    notifyPullCompleted = false
  } = {}) {
    if (!this.started) {
      return false;
    }
    const generation = this.runGeneration;
    if (this.inFlightPromise && this.inFlightGeneration === generation) {
      this.queuePendingSyncRequest({
        force,
        includeProfileSettings,
        pushAfterPull,
        notifyPullCompleted
      });
      return this.inFlightPromise;
    }
    if (!this.isCurrentRun(generation) || isSyncBackoffActive()) {
      this.scheduleBackoffRetry({ notifyPullCompleted });
      return false;
    }

    const profileId = ProfileManager.getActiveProfileId();
    const key = currentSyncKey(profileId);
    const now = Date.now();
    const coversProfileSettings =
      !includeProfileSettings || this.lastPulledIncludedProfileSettings === true;
    if (
      force &&
      this.lastPulledKey === key &&
      coversProfileSettings &&
      now - this.lastPulledAtMs < FORCE_RESYNC_MIN_INTERVAL_MS
    ) {
      if (notifyPullCompleted) {
        notifySyncPullCompleted({
          profileId: normalizeProfileId(profileId),
          includeProfileScoped: Boolean(this.profileScopedSyncEnabled),
          changedHomeInputs: Boolean(this.lastPullChangedHomeInputs),
          completedAt: Date.now()
        });
      }
      return true;
    }
    if (!force && !allowWarmRepeat && canUsePersistedWarmSync(key, includeProfileSettings, now)) {
      // Boot warm: o pull completo e dispensado, mas a credencial Trakt ainda
      // precisa de copia na nuvem. Ver reconcileTraktCredentialDetached.
      reconcileTraktCredentialDetached(profileId);
      this.lastPullCompleted = true;
      // Dispensar o pull completo nao pode significar dado congelado por 6 h: o que
      // muda de um boot para o outro (progresso, assistidos, biblioteca) vem pelo
      // pull leve de foreground -- 4 requisicoes, sem tema/i18n, e so depois de
      // FOREGROUND_ACTIVITY_PULL_DELAY_MS, quando a Home ja pintou do estado local.
      this.requestForegroundSync();
      if (globalThis.__NUVIO_DEBUG_HOME_PERF__) {
        try {
          console.info("[home-perf] startupSync.warmSkip", { key: key });
        } catch (_) {
          // Log de diagnostico nunca derruba o sync.
        }
      }
      return true;
    }

    let requestPromise = null;
    requestPromise = (async () => {
      this.inFlight = true;
      this.lastPullCompleted = false;
      let completed = false;
      try {
        for (let attempt = 1; attempt <= MAX_PULL_ATTEMPTS; attempt += 1) {
          if (!this.isCurrentRun(generation) || !AuthManager.isAuthenticated) {
            break;
          }
          if (!this.isCurrentProfile(profileId, key)) {
            break;
          }
          if (isSyncBackoffActive()) {
            this.scheduleBackoffRetry({ notifyPullCompleted });
            break;
          }

          const didComplete = await this.syncPull({
            includeProfileScoped: this.profileScopedSyncEnabled,
            includeProfileSettings,
            generation,
            profileId,
            key
          });
          if (didComplete && this.isCurrentRun(generation) && !isSyncBackoffActive()) {
            if (pushAfterPull && this.profileScopedSyncEnabled) {
              await this.syncPush({ generation, profileId, key });
            }
            if (!isSyncBackoffActive()) {
              this.markFullPullSucceeded(key, includeProfileSettings);
              resetSyncBackoff();
              completed = true;
              if (notifyPullCompleted) {
                notifySyncPullCompleted({
                  profileId: normalizeProfileId(profileId),
                  includeProfileScoped: Boolean(this.profileScopedSyncEnabled),
                  changedHomeInputs: Boolean(this.lastPullChangedHomeInputs),
                  completedAt: Date.now()
                });
              }
              break;
            }
            this.scheduleBackoffRetry({ notifyPullCompleted });
            break;
          }
          if (isSyncBackoffActive()) {
            this.scheduleBackoffRetry({ notifyPullCompleted });
            break;
          }
          if (attempt < MAX_PULL_ATTEMPTS) {
            await sleep(3000);
          }
        }
        this.lastPullCompleted = completed;
        return completed;
      } finally {
        this.inFlight = false;
        if (this.inFlightPromise === requestPromise) {
          this.inFlightPromise = null;
          this.inFlightGeneration = 0;
        }
        const pending = this.pendingSyncRequest;
        this.pendingSyncRequest = null;
        if (pending && this.isCurrentRun(generation)) {
          setTimeout(() => {
            void this.requestSyncNow(pending).catch((error) => {
              console.warn("Queued startup sync failed", error);
            });
          }, 0);
        }
      }
    })();
    this.inFlightPromise = requestPromise;
    this.inFlightGeneration = generation;
    return requestPromise;
  },

  async syncPull({
    includeProfileScoped = this.profileScopedSyncEnabled,
    includeProfileSettings = true,
    generation = this.runGeneration,
    profileId = ProfileManager.getActiveProfileId(),
    key = currentSyncKey(profileId)
  } = {}) {
    if (
      !this.isCurrentRun(generation) ||
      !AuthManager.isAuthenticated ||
      !this.isCurrentProfile(profileId, key)
    ) {
      return false;
    }
    await ProfileSyncService.pull();
    if (!this.isCurrentProfile(profileId, key)) {
      return false;
    }
    const profileStatus = ProfileSyncService.getLastPullStatus?.();
    if (profileStatus === "deferred") {
      this.scheduleBackoffRetry();
      return false;
    }
    if (profileStatus === "error") {
      return false;
    }

    const activeProfileId = profileId;
    // Nenhuma superficie mexeu no que a Home usa para montar fileiras ate aqui.
    // Ver markHomeInputsChanged / surfaceChangedHomeInputs abaixo.
    this.lastPullChangedHomeInputs = false;
    if (includeProfileSettings) {
      const profileSettingsResult = await runSurface("profile settings", async () => {
        const didApply = await ProfileSettingsSyncService.pull(activeProfileId);
        if (hasProfileSettingsCloudSyncPending(activeProfileId) && !isSyncBackoffActive()) {
          await ProfileSettingsSyncService.push(activeProfileId);
        }
        return didApply;
      });
      // `profile settings` NAO entra aqui de proposito. O applyRemoteBlob aplica
      // badges de stream, player e debrid alem do layout, e devolve um unico
      // "apliquei alguma coisa" — medido: `changedHomeInputs: true` em todo
      // boot, por causa de ajustes que a Home nem le. A unica parte que a Home
      // usa (layout + provedor de Continue Watching) ja tem verificacao propria
      // e barata na Home, em buildSyncSensitiveHomeSignature().
      if (profileSettingsResult.ok && profileSettingsResult.value) {
        await runSurface("profile settings theme", async () => {
          await I18n.init();
          const memberAccess = await MemberAccessRepository.getAccess().catch(() =>
            MemberAccessRepository.getCurrentAccess()
          );
          ThemeManager.apply({ enforceAccess: true, access: memberAccess });
          I18n.apply();
        });
      }
    }

    await Promise.all([
      // DIVERGENCIA DELIBERADA do upstream. Em a67cbc5 eles removeram a
      // sincronizacao da credencial do Trakt (e o traktCredentialSyncService
      // inteiro) em vez de corrigir o backend, que rejeita o provider "trakt"
      // com 22023 — o bug que reportamos em NuvioMedia/NuvioTVSmart#789. Sem
      // isto o vinculo Trakt volta a viver so no localStorage e morre em
      // qualquer signOut ou 401. O providerCredentialSyncService novo deles
      // cobre mdblist/animeskip/debrid, NAO Trakt, entao nao substitui isto.
      // Reconciliação bidirecional: adota a credencial da nuvem quando ela
      // existe, e EMPURRA a local quando a nuvem não tem — sem isso o vínculo
      // Trakt vivia só no localStorage e morria em qualquer signOut.
      runSurface("Trakt credentials", () =>
        TraktCredentialSyncService.reconcileWithRemote(activeProfileId)
      ),
      runSurface("Simkl credentials", () =>
        SimklCredentialSyncService.pullFromRemote(activeProfileId)
      ),
      runSurface("provider credentials", () =>
        ProviderCredentialSyncService.syncFromRemote(activeProfileId)
      ),
      runSurface("Simkl refresh", () =>
        SimklSyncService.refresh().catch((error) => {
          console.warn("Simkl automatic refresh failed", error);
          return false;
        })
      )
    ]);

    if (!this.isCurrentProfile(profileId, key)) {
      return false;
    }

    if (!includeProfileScoped) {
      return this.isCurrentRun(generation) && !isSyncBackoffActive();
    }
    if (!this.isCurrentRun(generation) || isSyncBackoffActive()) {
      return false;
    }

    // `LibrarySyncService.pull` devolve a lista de URLs, nao um booleano, e
    // aplica a ordem com `{ silent: true }` — nao da para saber pelo retorno
    // nem pelos eventos do repositorio se algo mudou. A lista inteira sao
    // ~2,5 KB no localStorage, entao comparar a string antes e depois e mais
    // barato que qualquer alternativa.
    const addonUrlsBefore = String(addonRepository.getInstalledAddonUrls() || []);
    const surfaceResults = await Promise.all([
      runSurface("collections", () => CollectionSyncService.pull(activeProfileId)),
      runSurface("home catalog settings", () =>
        HomeCatalogSettingsSyncService.pull(activeProfileId)
      ),
      runSurface("plugins", () => PluginSyncService.pull()),
      runSurface("addons", () => LibrarySyncService.pull()),
      runSurface("saved library", () => SavedLibrarySyncService.pull(activeProfileId))
    ]);
    // Indices em `surfaceResults`: 0 collections, 1 home catalog settings,
    // 2 plugins, 3 addons, 4 saved library.
    //
    // So 0 e 1 entram no sinal. `plugins` (pluginSources) a Home nao le em
    // lugar nenhum — quem le e a tela de ajustes e o runtime do player. E
    // `savedLibrary` a Home so consulta item a item, por `isSaved`, para o
    // estado do card expandido; nao e disso que as fileiras sao feitas. Os dois
    // devolvem ARRAY e nao booleano, entao contavam como "mudou" em todo boot,
    // e eram justamente o que impedia o refresh de ser dispensado. `addons`
    // (indice 3) tambem devolve array e e tratada pela comparacao de URLs.
    [0, 1].forEach((index) => {
      const changed = surfaceChangedHomeInputs(surfaceResults[index]);
      logSurfaceChange(index === 0 ? "collections" : "home catalog settings", changed);
      this.markHomeInputsChanged(changed);
    });
    const addonsChanged = String(addonRepository.getInstalledAddonUrls() || []) !== addonUrlsBefore;
    logSurfaceChange("addons", addonsChanged);
    this.markHomeInputsChanged(addonsChanged);

    if (!this.isCurrentRun(generation) || isSyncBackoffActive()) {
      return false;
    }
    await runSurface("watched items", () => WatchedItemsSyncService.pull(activeProfileId));
    if (!this.isCurrentRun(generation) || isSyncBackoffActive()) {
      return false;
    }
    await runSurface("watch progress", () => WatchProgressSyncService.pull(activeProfileId));
    return this.isCurrentRun(generation) && !isSyncBackoffActive();
  },

  async requestWatchStateSyncNow() {
    if (!this.started || !this.profileScopedSyncEnabled || !AuthManager.isAuthenticated) {
      return false;
    }
    const generation = this.runGeneration;
    const profileId = ProfileManager.getActiveProfileId();
    const profileKey = currentSyncKey(profileId);
    if (this.watchStateInFlightPromise && this.watchStateInFlightGeneration === generation) {
      return this.watchStateInFlightPromise;
    }
    if (isSyncBackoffActive()) {
      this.scheduleBackoffRetry();
      return false;
    }

    let requestPromise = null;
    requestPromise = (async () => {
      try {
        if (!this.isCurrentProfile(profileId, profileKey)) {
          return false;
        }
        const watchedResult = await runSurface("periodic watched items", () =>
          WatchedItemsSyncService.pull(profileId)
        );
        if (!watchedResult.ok) {
          return false;
        }
        if (
          watchedResult.ok &&
          WatchedItemsSyncService.getLastPullHadUnsynced?.() &&
          !isSyncBackoffActive()
        ) {
          await runSurface("periodic watched items push", () =>
            WatchedItemsSyncService.push(profileId)
          );
        }
        if (!isSyncBackoffActive()) {
          if (!this.isCurrentProfile(profileId, profileKey)) {
            return false;
          }
          const progressResult = await runSurface("periodic watch progress", () =>
            WatchProgressSyncService.pull(profileId)
          );
          if (!progressResult.ok) {
            return false;
          }
          if (
            progressResult.ok &&
            WatchProgressSyncService.getLastPullHadUnsynced?.() &&
            !isSyncBackoffActive()
          ) {
            await runSurface("periodic watch progress push", () =>
              WatchProgressSyncService.push(profileId)
            );
          }
        }
        if (isSyncBackoffActive()) {
          this.scheduleBackoffRetry();
          return false;
        }
        return this.isCurrentRun(generation) && this.isCurrentProfile(profileId, profileKey);
      } finally {
        if (this.watchStateInFlightPromise === requestPromise) {
          this.watchStateInFlightPromise = null;
          this.watchStateInFlightGeneration = 0;
        }
      }
    })();
    this.watchStateInFlightPromise = requestPromise;
    this.watchStateInFlightGeneration = generation;
    return requestPromise;
  },

  async requestLibrarySyncNow() {
    if (!this.started || !this.profileScopedSyncEnabled || !AuthManager.isAuthenticated) {
      return false;
    }
    const generation = this.runGeneration;
    const profileId = ProfileManager.getActiveProfileId();
    const profileKey = currentSyncKey(profileId);
    if (this.libraryInFlightPromise && this.libraryInFlightGeneration === generation) {
      return this.libraryInFlightPromise;
    }
    if (isSyncBackoffActive()) {
      this.scheduleBackoffRetry();
      return false;
    }

    let requestPromise = null;
    requestPromise = (async () => {
      try {
        if (!this.isCurrentProfile(profileId, profileKey)) {
          return false;
        }
        const [addonsResult, savedLibraryResult] = await Promise.all([
          runSurface("periodic addons", () => LibrarySyncService.pull()),
          runSurface("periodic saved library", () => SavedLibrarySyncService.pull(profileId))
        ]);
        if (!addonsResult.ok || !savedLibraryResult.ok) {
          return false;
        }
        if (isSyncBackoffActive()) {
          this.scheduleBackoffRetry();
          return false;
        }
        return this.isCurrentRun(generation) && this.isCurrentProfile(profileId, profileKey);
      } finally {
        if (this.libraryInFlightPromise === requestPromise) {
          this.libraryInFlightPromise = null;
          this.libraryInFlightGeneration = 0;
        }
      }
    })();
    this.libraryInFlightPromise = requestPromise;
    this.libraryInFlightGeneration = generation;
    return requestPromise;
  },

  async syncPush({
    generation = this.runGeneration,
    profileId = ProfileManager.getActiveProfileId(),
    key = currentSyncKey(profileId)
  } = {}) {
    if (
      !this.isCurrentRun(generation) ||
      !AuthManager.isAuthenticated ||
      isSyncBackoffActive() ||
      !this.isCurrentProfile(profileId, key)
    ) {
      this.scheduleBackoffRetry();
      return false;
    }
    const surfaces = [
      ["profiles push", () => ProfileSyncService.push()],
      ["profile settings push", () => ProfileSettingsSyncService.push()],
      ["collections push", () => CollectionSyncService.push()],
      ["home catalog settings push", () => HomeCatalogSettingsSyncService.push()],
      ["plugins push", () => PluginSyncService.push()],
      ["addons push", () => LibrarySyncService.push()],
      ["saved library push", () => SavedLibrarySyncService.push(profileId)],
      ["watched items push", () => WatchedItemsSyncService.push(profileId)],
      ["watch progress push", () => WatchProgressSyncService.push(profileId)]
    ];
    for (const [label, task] of surfaces) {
      if (
        !this.isCurrentRun(generation) ||
        isSyncBackoffActive() ||
        !this.isCurrentProfile(profileId, key)
      ) {
        this.scheduleBackoffRetry();
        return false;
      }
      await runSurface(label, task);
    }
    return !isSyncBackoffActive();
  },

  async syncCycle() {
    return this.requestWatchStateSyncNow();
  },

  scheduleAddonPush(delayMs = ADDON_PUSH_DEBOUNCE_MS) {
    if (!this.started || !this.profileScopedSyncEnabled) {
      return;
    }
    if (this.addonPushTimer) {
      clearTimeout(this.addonPushTimer);
    }
    const cooldownMs = getSyncBackoffRemainingMs();
    const effectiveDelayMs = Math.max(
      ADDON_PUSH_DEBOUNCE_MS,
      Number(delayMs) || 0,
      cooldownMs > 0 ? cooldownMs + 50 : 0
    );
    this.addonPushTimer = setTimeout(async () => {
      this.addonPushTimer = null;
      if (!AuthManager.isAuthenticated) {
        return;
      }
      if (isSyncBackoffActive()) {
        this.scheduleAddonPush();
        return;
      }
      const didPush = await LibrarySyncService.push();
      if (!didPush && isSyncBackoffActive()) {
        this.scheduleAddonPush();
      }
    }, effectiveDelayMs);
  }
};
