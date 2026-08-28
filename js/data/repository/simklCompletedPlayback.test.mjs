import test from "node:test";
import assert from "node:assert/strict";

// Repository imports touch LocalStore during module init, so give them a
// localStorage before importing the service under test.
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

// Keep getProgressSnapshot from touching the network.
SimklSyncService.refresh = async () => false;

const showMedia = {
  title: "Show",
  year: 2016,
  runtime: 24,
  ids: { simkl: 39687, imdb: "tt4574334" }
};

function seedSnapshot({ completedAt, pausedAt }) {
  const snapshot = {
    schemaVersion: 2,
    initialized: true,
    entries: [
      {
        mediaType: "shows",
        status: "completed",
        last_watched_at: completedAt,
        show: showMedia
      }
    ],
    playback: [
      {
        id: 1,
        show: showMedia,
        episode: { season: 1, number: 5 },
        progress: 40,
        paused_at: pausedAt
      }
    ],
    lastSyncedAt: Date.now(),
    lastCheckedAt: Date.now()
  };
  LocalStore.set("simklSyncState", { version: 1, profiles: { 1: snapshot } });
}

// Mirrors SimklPlaybackReconciliationTest
// "newer completed series summary discards stale episode playback".
test("completed series summary discards stale episode playback", async () => {
  seedSnapshot({ completedAt: "2024-04-30T22:14:00Z", pausedAt: "2024-04-30T22:13:00Z" });
  const { playbackItems } = await SimklSyncService.getProgressSnapshot();
  assert.equal(playbackItems.length, 0, "stale playback should be dropped for a completed series");
});

// Mirrors SimklPlaybackReconciliationTest
// "newer episode playback remains after completed series summary".
test("newer playback remains after a completed series summary", async () => {
  seedSnapshot({ completedAt: "2024-04-30T22:13:00Z", pausedAt: "2024-04-30T22:14:00Z" });
  const { playbackItems } = await SimklSyncService.getProgressSnapshot();
  assert.equal(playbackItems.length, 1, "a newer rewatch pause should be kept");
});
