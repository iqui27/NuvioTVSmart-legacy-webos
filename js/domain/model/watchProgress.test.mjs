import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isWatchProgressCompleted,
  isWatchProgressInProgress,
  watchProgressCompletedThreshold
} from "./watchProgress.js";

test("Simkl playback at 80 percent counts as completed", () => {
  const progress = { source: "simkl_playback", progressPercent: 80 };

  assert.equal(watchProgressCompletedThreshold(progress), 0.8);
  assert.equal(isWatchProgressCompleted(progress), true);
  assert.equal(isWatchProgressInProgress(progress), false);
});

test("Simkl playback below 80 percent remains in progress", () => {
  const progress = { source: "simkl_playback", progressPercent: 79.99 };

  assert.equal(isWatchProgressCompleted(progress), false);
  assert.equal(isWatchProgressInProgress(progress), true);
});

test("local progress at 85 percent keeps the default 90 percent threshold", () => {
  const progress = { source: "local", progressPercent: 85 };

  assert.equal(watchProgressCompletedThreshold(progress), 0.9);
  assert.equal(isWatchProgressCompleted(progress), false);
  assert.equal(isWatchProgressInProgress(progress), true);
});
