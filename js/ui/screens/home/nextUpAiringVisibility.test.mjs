import { test } from "node:test";
import assert from "node:assert/strict";

import { shouldKeepNextUpForAiringSetting } from "./nextUpAiringVisibility.js";

test("an unaired next up episode is hidden when the setting is off", () => {
  const item = { isNextUp: true, hasAired: false };
  assert.equal(shouldKeepNextUpForAiringSetting(item, false), false);
  assert.equal(shouldKeepNextUpForAiringSetting(item, true), true);
});

test("an aired next up episode stays visible either way", () => {
  const item = { isNextUp: true, hasAired: true };
  assert.equal(shouldKeepNextUpForAiringSetting(item, false), true);
  assert.equal(shouldKeepNextUpForAiringSetting(item, true), true);
});

test("in progress items are never filtered by the setting", () => {
  const item = { isNextUp: false, hasAired: false };
  assert.equal(shouldKeepNextUpForAiringSetting(item, false), true);
});

test("a next up episode without a release flag stays visible", () => {
  const item = { isNextUp: true };
  assert.equal(shouldKeepNextUpForAiringSetting(item, false), true);
});
