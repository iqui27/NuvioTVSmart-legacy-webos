import test from "node:test";
import assert from "node:assert/strict";

import { destructiveRemovalImpacts } from "./simklSyncService.js";

// Mirrors Android SimklLibraryRemovalPolicyTest. Removing a Simkl entry must
// warn when it would clear watched history or a rating. The Simkl status values
// on web are the raw api strings ("plantowatch", "watching", "completed", ...).

test("plain plan to watch removal is safe", () => {
  assert.deepEqual(destructiveRemovalImpacts({ status: "plantowatch" }), []);
});

test("watched status removal requires history confirmation", () => {
  assert.deepEqual(destructiveRemovalImpacts({ status: "watching" }), ["watched_history"]);
});

test("watch counters protect plan to watch history", () => {
  assert.deepEqual(
    destructiveRemovalImpacts({ status: "plantowatch", watched_episodes_count: 2 }),
    ["watched_history"]
  );
});

test("rating timestamp is protected when numeric rating is absent", () => {
  assert.deepEqual(
    destructiveRemovalImpacts({ status: "plantowatch", user_rated_at: "2026-07-23T10:00:00Z" }),
    ["rating"]
  );
});

test("history and rating impacts are combined", () => {
  assert.deepEqual(destructiveRemovalImpacts({ status: "completed", user_rating: 9 }), [
    "watched_history",
    "rating"
  ]);
});

test("episode watch timestamps protect a plan to watch entry", () => {
  const entry = {
    status: "plantowatch",
    seasons: [{ episodes: [{ watched_at: "2026-07-01T00:00:00Z" }] }]
  };
  assert.deepEqual(destructiveRemovalImpacts(entry), ["watched_history"]);
});

test("non-null empty fields follow Android presence semantics", () => {
  const entry = {
    status: "plantowatch",
    last_watched_at: "",
    user_rated_at: "",
    seasons: [{ episodes: [{ watched_at: "" }] }]
  };
  assert.deepEqual(destructiveRemovalImpacts(entry), ["watched_history", "rating"]);
});

test("a missing entry has no impacts", () => {
  assert.deepEqual(destructiveRemovalImpacts(null), []);
});
