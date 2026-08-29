import { test } from "node:test";
import assert from "node:assert/strict";

import { shouldMarkCompletedSeriesWatched } from "./simklCompletedSeries.js";

globalThis.localStorage = (() => {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };
})();

const { LocalStore } = await import("../../core/storage/localStore.js");
const { SimklSyncService } = await import("./simklSyncService.js");
const { watchedItemsRepository } = await import("./watchedItemsRepository.js");
const { watchedSeriesReconciliationService } =
  await import("./watchedSeriesReconciliationService.js");

SimklSyncService.refresh = async () => false;

const showMedia = {
  title: "Show",
  year: 2016,
  ids: { simkl: 39687, imdb: "tt4574334" }
};

function seedCompletedSnapshot({ lastWatchedAt = "2024-04-30T22:14:00Z", addedAt = null } = {}) {
  LocalStore.set("simklSyncState", {
    version: 1,
    profiles: {
      1: {
        schemaVersion: 2,
        initialized: true,
        entries: [
          {
            mediaType: "shows",
            status: "completed",
            ...(lastWatchedAt == null ? {} : { last_watched_at: lastWatchedAt }),
            ...(addedAt == null ? {} : { added_to_watchlist_at: addedAt }),
            show: showMedia
          }
        ],
        playback: [],
        lastSyncedAt: Date.now(),
        lastCheckedAt: Date.now()
      }
    }
  });
}

test("a completed series with no episode history gets a show level marker", () => {
  assert.equal(shouldMarkCompletedSeriesWatched("completed", false), true);
});

test("a completed series that already has episode history is not marked again", () => {
  assert.equal(shouldMarkCompletedSeriesWatched("completed", true), false);
});

test("a series that is not completed never gets a show level marker", () => {
  assert.equal(shouldMarkCompletedSeriesWatched("watching", false), false);
  assert.equal(shouldMarkCompletedSeriesWatched("watching", true), false);
  assert.equal(shouldMarkCompletedSeriesWatched("hold", false), false);
  assert.equal(shouldMarkCompletedSeriesWatched("dropped", false), false);
});

test("completed series without episode history projects a root watched marker", async () => {
  seedCompletedSnapshot();
  const watchedItems = await SimklSyncService.getWatchedItems();
  assert.equal(watchedItems.length, 1);
  assert.equal(watchedItems[0].contentId, "tt4574334");
  assert.equal(watchedItems[0].season ?? null, null);
  assert.equal(watchedItems[0].episode ?? null, null);
  assert.equal(watchedItems[0].watchedAt, Date.parse("2024-04-30T22:14:00Z"));
});

test("completed series marker falls back to the watchlist timestamp", async () => {
  seedCompletedSnapshot({ lastWatchedAt: null, addedAt: "2024-04-29T22:14:00Z" });
  const watchedItems = await SimklSyncService.getWatchedItems();
  assert.equal(watchedItems.length, 1);
  assert.equal(watchedItems[0].watchedAt, Date.parse("2024-04-29T22:14:00Z"));
});

test("remote Simkl root marker survives incomplete episode reconciliation", async () => {
  const originalGetAll = watchedItemsRepository.getAll;
  const originalIsWatched = watchedItemsRepository.isWatched;
  const originalUnmark = watchedItemsRepository.unmark;
  let unmarkCalls = 0;
  watchedItemsRepository.getAll = async () => [
    {
      contentId: "tt4574334",
      contentType: "series",
      trackingProviderId: "simkl",
      season: null,
      episode: null,
      watchedAt: Date.parse("2024-04-30T22:14:00Z")
    }
  ];
  watchedItemsRepository.isWatched = async () => true;
  watchedItemsRepository.unmark = async () => {
    unmarkCalls += 1;
  };
  try {
    const changed = await watchedSeriesReconciliationService.reconcile("tt4574334", "series", {
      meta: {
        id: "tt4574334",
        type: "series",
        name: "Show",
        videos: [{ id: "s1e1", season: 1, episode: 1, released: "2024-01-01" }]
      }
    });
    assert.equal(changed, false);
    assert.equal(unmarkCalls, 0);
  } finally {
    watchedItemsRepository.getAll = originalGetAll;
    watchedItemsRepository.isWatched = originalIsWatched;
    watchedItemsRepository.unmark = originalUnmark;
  }
});
