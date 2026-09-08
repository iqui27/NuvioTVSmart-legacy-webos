import { WatchedItemsStore } from "../local/watchedItemsStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { TraktSettingsStore, WatchProgressSource } from "../local/traktSettingsStore.js";
import { SimklAuthStore } from "../local/simklAuthStore.js";
import { SimklSyncService } from "./simklSyncService.js";
import { TraktAuthService, requestJson as traktRequestJson } from "./traktAuthService.js";
import { watchedItemIdentityValues, watchedItemsShareIdentity } from "./watchedIdentity.js";
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

function watchedIdentityKeys(item = {}) {
  const season = item.season == null ? "" : String(Number(item.season));
  const episode = item.episode == null ? "" : String(Number(item.episode));
  return Array.from(watchedItemIdentityValues(item)).map(
    (identity) => `${identity.toLowerCase()}::${season}::${episode}`
  );
}

const TRAKT_WATCHED_MOVIES_CACHE_TTL_MS = 30_000;
let traktWatchedMoviesCache = null;
let traktWatchedMoviesInFlight = null;
let traktWatchedShowsCache = null;
let traktWatchedShowsInFlight = null;

function invalidateTraktWatchedMoviesCache() {
  traktWatchedMoviesCache = null;
}

function invalidateTraktWatchedShowsCache() {
  traktWatchedShowsCache = null;
}

function invalidateTraktWatchedCaches() {
  invalidateTraktWatchedMoviesCache();
  invalidateTraktWatchedShowsCache();
}

async function getTraktWatchedMovies() {
  if (!shouldUseTrakt()) {
    return [];
  }

  const profileId = activeProfileId();
  const now = Date.now();
  if (
    traktWatchedMoviesCache?.profileId === profileId &&
    now - Number(traktWatchedMoviesCache.fetchedAt || 0) < TRAKT_WATCHED_MOVIES_CACHE_TTL_MS
  ) {
    return traktWatchedMoviesCache.items;
  }
  if (traktWatchedMoviesInFlight?.profileId === profileId) {
    return traktWatchedMoviesInFlight.promise;
  }

  const promise = TraktAuthService.fetchWatchedMovies()
    .then((items) => {
      const normalizedItems = Array.isArray(items) ? items : [];
      traktWatchedMoviesCache = {
        profileId,
        fetchedAt: Date.now(),
        items: normalizedItems
      };
      return normalizedItems;
    })
    .catch((error) => {
      console.warn("Trakt watched movies lookup failed", error);
      return traktWatchedMoviesCache?.profileId === profileId &&
        Array.isArray(traktWatchedMoviesCache.items)
        ? traktWatchedMoviesCache.items
        : [];
    })
    .finally(() => {
      if (traktWatchedMoviesInFlight?.promise === promise) {
        traktWatchedMoviesInFlight = null;
      }
    });
  traktWatchedMoviesInFlight = { profileId, promise };
  return promise;
}

async function getTraktWatchedShows() {
  if (!shouldUseTrakt()) {
    return [];
  }

  const profileId = activeProfileId();
  const now = Date.now();
  if (
    traktWatchedShowsCache?.profileId === profileId &&
    now - Number(traktWatchedShowsCache.fetchedAt || 0) < TRAKT_WATCHED_MOVIES_CACHE_TTL_MS
  ) {
    return traktWatchedShowsCache.items;
  }
  if (traktWatchedShowsInFlight?.profileId === profileId) {
    return traktWatchedShowsInFlight.promise;
  }

  const promise = TraktAuthService.fetchWatchedShows()
    .then((items) => {
      const normalizedItems = Array.isArray(items) ? items : [];
      traktWatchedShowsCache = {
        profileId,
        fetchedAt: Date.now(),
        items: normalizedItems
      };
      return normalizedItems;
    })
    .catch((error) => {
      console.warn("Trakt watched shows lookup failed", error);
      return traktWatchedShowsCache?.profileId === profileId &&
        Array.isArray(traktWatchedShowsCache.items)
        ? traktWatchedShowsCache.items
        : [];
    })
    .finally(() => {
      if (traktWatchedShowsInFlight?.promise === promise) {
        traktWatchedShowsInFlight = null;
      }
    });
  traktWatchedShowsInFlight = { profileId, promise };
  return promise;
}

function toTraktWatchedShowEpisodeItems(show = {}) {
  if (!show?.contentId || !Array.isArray(show.seasons)) {
    return [];
  }
  const fallbackWatchedAt = show.lastWatchedAt
    ? new Date(show.lastWatchedAt).getTime()
    : Date.now();
  const watchedAt = Number.isFinite(fallbackWatchedAt) ? fallbackWatchedAt : Date.now();
  const items = [];
  show.seasons.forEach((season) => {
    const seasonNumber = Number(season?.number || 0);
    if (seasonNumber <= 0) {
      return;
    }
    (season?.episodes || []).forEach((episode) => {
      const episodeNumber = Number(episode?.number || 0);
      if (episodeNumber <= 0 || Number(episode?.plays || 0) <= 0) {
        return;
      }
      const episodeWatchedAt = episode?.lastWatchedAt
        ? new Date(episode.lastWatchedAt).getTime()
        : watchedAt;
      items.push({
        type: "series",
        contentType: "series",
        contentId: show.contentId,
        title: show.title,
        year: show.year,
        imdbId: show.imdbId,
        tmdbId: show.tmdbId,
        traktId: show.traktId,
        slug: show.slug || null,
        season: seasonNumber,
        episode: episodeNumber,
        watchedAt: Number.isFinite(episodeWatchedAt) ? episodeWatchedAt : watchedAt,
        source: "trakt_show_progress"
      });
    });
  });
  return items;
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
  const targetContentId = String(contentId || "").trim();
  if (
    !targetContentId ||
    !watchedItemsShareIdentity(item, { ...options, contentId: targetContentId })
  ) {
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
    if (shouldUseTrakt()) {
      const [remoteMovies, remoteShows] = await Promise.all([
        getTraktWatchedMovies(),
        getTraktWatchedShows()
      ]);
      const remote = [
        ...remoteMovies,
        ...remoteShows.flatMap((show) => toTraktWatchedShowEpisodeItems(show))
      ];
      const remoteKeys = new Set(remote.flatMap(watchedIdentityKeys));
      return limitWatchedItems(
        [
          ...remote,
          ...local.filter((item) => !watchedIdentityKeys(item).some((key) => remoteKeys.has(key)))
        ],
        limit
      );
    }
    if (!shouldUseSimkl()) return local.slice(0, limit);
    const remote = await SimklSyncService.getWatchedItems().catch(() => []);
    const remoteKeys = new Set(remote.flatMap(watchedIdentityKeys));
    return limitWatchedItems(
      [
        ...remote,
        ...local.filter((item) => !watchedIdentityKeys(item).some((key) => remoteKeys.has(key)))
      ],
      limit
    );
  }

  async isWatched(contentId, options = {}) {
    const allowEpisodeEntries = Boolean(options?.allowEpisodeEntries);
    const all = await this.getAll();
    return all.some((item) => {
      if (!watchedItemsShareIdentity(item, { ...options, contentId })) {
        return false;
      }
      return allowEpisodeEntries || (item.season == null && item.episode == null);
    });
  }

  async mark(item, options = {}) {
    if (!item?.contentId) {
      return;
    }
    const profileId = activeProfileId();
    WatchedItemsStore.upsert(
      {
        ...item,
        watchedAt: item.watchedAt || Date.now()
      },
      profileId
    );
    invalidateTraktWatchedCaches();

    // Android commits local completion before broadcasting to tracking providers.
    // A provider outage must not discard the completed state or the cloud enqueue.
    if (options.skipTrackingWrite !== true) {
      if (shouldUseSimkl()) {
        try {
          await SimklSyncService.markWatched(item);
        } catch (error) {
          console.warn("Simkl watched history write failed", error);
        }
      }
      if (shouldUseTrakt()) {
        try {
          await writeTraktHistory(item, false);
        } catch (error) {
          console.warn("Trakt watched history write failed", error);
        }
      }
    }
    queueWatchedItemsCloudSync();
  }

  async unmark(contentId, options = null) {
    const pid = activeProfileId();
    const removedItems = WatchedItemsStore.listForProfile(pid).filter((item) =>
      matchesWatchedTarget(item, contentId, options)
    );
    // Remove the local state first, matching Android's optimistic removal path.
    if (removedItems.length) {
      const remaining = WatchedItemsStore.listForProfile(pid).filter(
        (item) => !matchesWatchedTarget(item, contentId, options)
      );
      WatchedItemsStore.replaceForProfile(pid, remaining);
    } else {
      WatchedItemsStore.remove(contentId, pid, options);
    }
    invalidateTraktWatchedCaches();

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
        try {
          await SimklSyncService.unmarkWatched(item);
        } catch (error) {
          console.warn("Simkl watched history removal failed", error);
        }
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
        try {
          await writeTraktHistory(item, true);
        } catch (error) {
          console.warn("Trakt watched history removal failed", error);
        }
      }
    }
    await deleteWatchedItemsFromCloud(removedItems, pid);
    queueWatchedItemsCloudSync();
  }

  async replaceAll(items, profileId = activeProfileId()) {
    WatchedItemsStore.replaceForProfile(profileId, items || []);
    invalidateTraktWatchedCaches();
  }

  async getRemoteTraktWatchedShows() {
    return getTraktWatchedShows();
  }
}

export const watchedItemsRepository = new WatchedItemsRepository();
