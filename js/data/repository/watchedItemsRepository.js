import { WatchedItemsStore } from "../local/watchedItemsStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { TraktSettingsStore, WatchProgressSource } from "../local/traktSettingsStore.js";
import { SimklAuthStore } from "../local/simklAuthStore.js";
import { SimklSyncService } from "./simklSyncService.js";
import { TraktAuthService, requestJson as traktRequestJson } from "./traktAuthService.js";
import { getSyncBackoffRemainingMs } from "../../core/sync/syncBackoffPolicy.js";

function activeProfileId() {
  return String(ProfileManager.getActiveProfileId() || "1");
}

function shouldUseSimkl() {
  return (
    TraktSettingsStore.get().watchProgressSource === WatchProgressSource.SIMKL &&
    SimklAuthStore.isAuthenticated()
  );
}

function shouldUseTrakt() {
  return (
    TraktSettingsStore.get().watchProgressSource === WatchProgressSource.TRAKT &&
    TraktAuthService.isAuthenticated()
  );
}

function traktIds(item = {}) {
  const rawId = String(item.contentId || item.itemId || item.id || "").trim();
  const prefixed = rawId.match(/^(imdb|tmdb|trakt):(.+)$/i);
  const ids = {
    imdb: item.imdbId || (prefixed?.[1]?.toLowerCase() === "imdb" ? prefixed[2] : null),
    tmdb: item.tmdbId ?? (prefixed?.[1]?.toLowerCase() === "tmdb" ? Number(prefixed[2]) : null),
    trakt: item.traktId ?? (prefixed?.[1]?.toLowerCase() === "trakt" ? Number(prefixed[2]) : null)
  };
  if (!ids.imdb && /^tt\d+$/i.test(rawId)) ids.imdb = rawId;
  return Object.fromEntries(
    Object.entries(ids).filter(([, value]) => value != null && value !== "")
  );
}

function traktHistoryBody(item = {}) {
  const ids = traktIds(item);
  if (!Object.keys(ids).length) {
    throw new Error("This item has no Trakt-compatible ID");
  }
  const media = {
    title: item.title || item.name || undefined,
    year: item.year == null ? undefined : Number(item.year),
    ids
  };
  const isEpisode = item.season != null && item.episode != null;
  if (isEpisode) {
    media.seasons = [{ number: Number(item.season), episodes: [{ number: Number(item.episode) }] }];
  }
  const type = String(item.contentType || item.itemType || item.type || "movie").toLowerCase();
  return ["series", "show", "tv", "anime"].includes(type)
    ? { shows: [media] }
    : { movies: [media] };
}

async function writeTraktHistory(item, remove = false) {
  const token = await TraktAuthService.getValidAccessToken();
  if (!token) throw new Error("Trakt is not connected");
  const { response, payload } = await traktRequestJson(
    remove ? "/sync/history/remove" : "/sync/history",
    {
      method: "POST",
      body: traktHistoryBody(item),
      authorization: `Bearer ${token}`
    }
  );
  if (!response.ok) {
    throw new Error(
      payload?.message || `Could not update Trakt watched history (${response.status})`
    );
  }
}

function watchedKey(item = {}) {
  return `${String(item.contentId || "").toLowerCase()}:${item.season ?? ""}:${item.episode ?? ""}`;
}

function watchedEpisodeRank(item = {}) {
  return Number(item.season || 0) * 100000 + Number(item.episode || 0);
}

function byWatchedAtDescending(left, right) {
  return Number(right?.watchedAt || 0) - Number(left?.watchedAt || 0);
}

/**
 * Trims a watched list to `limit` without dropping any title from it.
 *
 * The list is one entry per watched episode, in whatever order the tracker returned its library.
 * A handful of long-running series can therefore spend the whole budget before the rest is even
 * reached: a 1284-entry Simkl account projects to ~9000 episodes, and a plain slice at 2000 kept
 * only 81 of its 539 series - chosen by Simkl's ordering, not by anything the viewer did. Next Up
 * seeds from this list, so those series simply vanish from Continue Watching.
 *
 * Keeping the furthest-watched episode of every title first means each one stays represented, which
 * is all Next Up needs from it. The remaining budget then goes to the most recent episodes, which is
 * what the watched badges read.
 */
function limitWatchedItems(items, limit) {
  const all = Array.isArray(items) ? items : [];
  const max = Math.max(0, Number(limit || 0));
  if (max === 0) {
    return [];
  }
  if (!Number.isFinite(max) || all.length <= max) {
    return all;
  }

  const furthestByContent = new Map();
  all.forEach((item) => {
    const contentId = String(item?.contentId || "")
      .trim()
      .toLowerCase();
    if (!contentId) return;
    const existing = furthestByContent.get(contentId);
    const itemRank = watchedEpisodeRank(item);
    const existingRank = watchedEpisodeRank(existing);
    if (
      !existing ||
      itemRank > existingRank ||
      (itemRank === existingRank && Number(item?.watchedAt || 0) > Number(existing?.watchedAt || 0))
    ) {
      furthestByContent.set(contentId, item);
    }
  });

  const furthest = Array.from(furthestByContent.values()).sort(byWatchedAtDescending);
  const kept = new Set(furthest);
  const rest = all.filter((item) => !kept.has(item)).sort(byWatchedAtDescending);
  return [...furthest, ...rest].slice(0, max);
}

const watchedItemsSyncTimers = new Map();
const watchedItemsSyncInFlightByProfile = new Map();

function queueWatchedItemsCloudSync(profileId = activeProfileId(), delayMs = 250) {
  const profileKey = String(profileId || "1");
  const existingTimer = watchedItemsSyncTimers.get(profileKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  const timerId = setTimeout(() => {
    watchedItemsSyncTimers.delete(profileKey);
    const runPush = async () => {
      const inFlight = watchedItemsSyncInFlightByProfile.get(profileKey);
      if (inFlight) {
        await inFlight.catch(() => false);
      }
      const pushPromise = import("../../core/profile/watchedItemsSyncService.js")
        .then(({ WatchedItemsSyncService }) => WatchedItemsSyncService.push(profileId))
        .catch((error) => {
          console.warn("Watched items cloud sync enqueue failed", error);
          return false;
        })
        .finally(() => {
          if (watchedItemsSyncInFlightByProfile.get(profileKey) === pushPromise) {
            watchedItemsSyncInFlightByProfile.delete(profileKey);
          }
        });
      watchedItemsSyncInFlightByProfile.set(profileKey, pushPromise);
      const didPush = await pushPromise;
      if (!didPush) {
        const retryDelayMs = getSyncBackoffRemainingMs();
        if (retryDelayMs > 0) {
          queueWatchedItemsCloudSync(profileId, Math.max(5000, retryDelayMs));
        }
      }
    };
    void runPush();
  }, delayMs);
  watchedItemsSyncTimers.set(profileKey, timerId);
}

function matchesWatchedTarget(item = {}, contentId, options = null) {
  const targetContentId = String(contentId || "");
  if (!targetContentId || item.contentId !== targetContentId) {
    return false;
  }
  const targetSeason =
    options?.season == null || options?.season === "" ? null : Number(options.season);
  const targetEpisode =
    options?.episode == null || options?.episode === "" ? null : Number(options.episode);
  if (options?.rootOnly === true) {
    return item.season == null && item.episode == null;
  }
  const hasScopedEpisode = targetSeason != null || targetEpisode != null;
  if (!hasScopedEpisode) {
    return true;
  }
  return item.season === targetSeason && item.episode === targetEpisode;
}

async function deleteWatchedItemsFromCloud(items = [], profileId = activeProfileId()) {
  if (!items.length) {
    return false;
  }
  try {
    const { WatchedItemsSyncService } =
      await import("../../core/profile/watchedItemsSyncService.js");
    return WatchedItemsSyncService.deleteItems(items, profileId);
  } catch (error) {
    console.warn("Watched items cloud delete failed", error);
    return false;
  }
}

class WatchedItemsRepository {
  async getAll(limit = 2000, profileId = activeProfileId()) {
    const local = WatchedItemsStore.listForProfile(profileId);
    if (!shouldUseSimkl()) return local.slice(0, limit);
    const remote = await SimklSyncService.getWatchedItems().catch(() => []);
    const remoteKeys = new Set(remote.map(watchedKey));
    return limitWatchedItems(
      [...remote, ...local.filter((item) => !remoteKeys.has(watchedKey(item)))],
      limit
    );
  }

  async isWatched(contentId, options = {}) {
    const allowEpisodeEntries = Boolean(options?.allowEpisodeEntries);
    const all = await this.getAll();
    return all.some((item) => {
      if (item.contentId !== String(contentId || "")) {
        return false;
      }
      return allowEpisodeEntries || (item.season == null && item.episode == null);
    });
  }

  async mark(item, options = {}) {
    if (!item?.contentId) {
      return;
    }
    if (shouldUseSimkl() && options.skipTrackingWrite !== true) {
      await SimklSyncService.markWatched(item);
    }
    if (shouldUseTrakt() && options.skipTrackingWrite !== true) {
      await writeTraktHistory(item, false);
    }
    WatchedItemsStore.upsert(
      {
        ...item,
        watchedAt: item.watchedAt || Date.now()
      },
      activeProfileId()
    );
    queueWatchedItemsCloudSync();
  }

  async unmark(contentId, options = null) {
    const pid = activeProfileId();
    const removedItems = WatchedItemsStore.listForProfile(pid).filter((item) =>
      matchesWatchedTarget(item, contentId, options)
    );
    if (shouldUseSimkl() && options?.skipTrackingWrite !== true) {
      const remoteMatches = removedItems.length
        ? []
        : (await SimklSyncService.getWatchedItems().catch(() => [])).filter((item) =>
            matchesWatchedTarget(item, contentId, options)
          );
      const targets = removedItems.length
        ? removedItems
        : remoteMatches.length
          ? remoteMatches
          : [
              {
                contentId,
                contentType: options?.contentType || "movie",
                season: options?.season ?? null,
                episode: options?.episode ?? null,
                videoId: options?.videoId || null
              }
            ];
      for (const item of targets) {
        await SimklSyncService.unmarkWatched(item);
      }
    }
    if (shouldUseTrakt() && options?.skipTrackingWrite !== true) {
      const targets = removedItems.length
        ? removedItems
        : [
            {
              contentId,
              contentType: options?.contentType || "movie",
              title: options?.title,
              year: options?.year,
              season: options?.season ?? null,
              episode: options?.episode ?? null,
              videoId: options?.videoId || null,
              imdbId: options?.imdbId,
              tmdbId: options?.tmdbId,
              traktId: options?.traktId
            }
          ];
      for (const item of targets) {
        await writeTraktHistory(item, true);
      }
    }
    WatchedItemsStore.remove(contentId, pid, options);
    await deleteWatchedItemsFromCloud(removedItems, pid);
    queueWatchedItemsCloudSync();
  }

  async replaceAll(items, profileId = activeProfileId()) {
    WatchedItemsStore.replaceForProfile(profileId, items || []);
  }
}

export const watchedItemsRepository = new WatchedItemsRepository();
