import assert from "node:assert/strict";
import test from "node:test";

import { formatHomeRuntimeText, shouldPreserveHomeRuntimeText } from "./homeRuntime.js";

test("preserves localized runtime text at the Home presentation boundary", () => {
  assert.equal(
    formatHomeRuntimeText({ runtime: "1 óra 37 perc", runtimeMinutes: 1 }),
    "1 óra 37 perc"
  );
});

test("formats recognized numeric and English runtime values", () => {
  assert.equal(formatHomeRuntimeText({ runtime: "97" }), "1h 37m");
  assert.equal(formatHomeRuntimeText({ runtime: "1h 37m" }), "1h 37m");
  assert.equal(formatHomeRuntimeText({ runtimeMinutes: 45 }), "45m");
});

test("preserves unrecognized non-empty runtime text", () => {
  assert.equal(formatHomeRuntimeText({ runtime: "unknown" }), "unknown");
  assert.equal(shouldPreserveHomeRuntimeText("unknown"), true);
});

test("omits explicit zero runtime values", () => {
  assert.equal(formatHomeRuntimeText({ runtime: "0" }), "");
  assert.equal(formatHomeRuntimeText({ runtime: "0 min" }), "");
  assert.equal(shouldPreserveHomeRuntimeText("0"), false);
});
