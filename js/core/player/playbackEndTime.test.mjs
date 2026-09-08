import test from "node:test";
import assert from "node:assert/strict";

import { calculateRemainingPlaybackMilliseconds } from "./playbackEndTime.js";

test("matches Android TV at normal speed", () => {
  assert.equal(calculateRemainingPlaybackMilliseconds(60, 120, 1), 60_000);
});

test("divides the remaining media time by the playback speed", () => {
  assert.equal(calculateRemainingPlaybackMilliseconds(60, 120, 1.5), 40_000);
  assert.equal(calculateRemainingPlaybackMilliseconds(60, 120, 0.5), 120_000);
});

test("rounds up fractional milliseconds like Android TV", () => {
  assert.equal(calculateRemainingPlaybackMilliseconds(0, 1, 1.5), 667);
});

test("falls back to normal speed for invalid playback speeds", () => {
  assert.equal(calculateRemainingPlaybackMilliseconds(60, 120, 0), 60_000);
  assert.equal(calculateRemainingPlaybackMilliseconds(60, 120, -2), 60_000);
  assert.equal(calculateRemainingPlaybackMilliseconds(60, 120, "invalid"), 60_000);
});

test("handles unknown duration and positions beyond the end safely", () => {
  assert.equal(calculateRemainingPlaybackMilliseconds(60, 0, 1), null);
  assert.equal(calculateRemainingPlaybackMilliseconds(60, Number.NaN, 1), null);
  assert.equal(calculateRemainingPlaybackMilliseconds(180, 120, 1), 0);
});
