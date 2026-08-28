import test from "node:test";
import assert from "node:assert/strict";

import { matchStreamBadges } from "./streamBadgeRules.js";

// Mirrors Android StreamBadgeRulesTest "matches active badge filters against
// stream metadata": a disabled filter (isEnabled = false) must not produce a
// badge even when its pattern matches, and an inactive import is skipped
// entirely. Android's StreamBadgeMatcher.compile drops filters where
// !filter.isEnabled.

const stream = {
  name: "Some Release DV Atmos Movie 2160p"
};

test("disabled badge filter does not produce a badge", () => {
  const rules = {
    imports: [
      {
        sourceUrl: "inactive",
        isActive: false,
        filters: [{ name: "Inactive", pattern: "Movie" }]
      },
      {
        sourceUrl: "active",
        isActive: true,
        filters: [
          { name: "Dolby Vision", pattern: "DV" },
          { name: "Atmos", pattern: "Atmos" },
          { name: "Disabled", pattern: "Movie", isEnabled: false }
        ]
      }
    ]
  };

  const badges = matchStreamBadges(stream, rules);
  assert.deepEqual(
    badges.map((badge) => badge.name),
    ["Dolby Vision", "Atmos"]
  );
});

test("enabled filters still match", () => {
  const rules = {
    imports: [
      {
        sourceUrl: "active",
        isActive: true,
        filters: [
          { name: "Dolby Vision", pattern: "DV" },
          { name: "Movie", pattern: "Movie", isEnabled: true }
        ]
      }
    ]
  };

  const badges = matchStreamBadges(stream, rules);
  assert.deepEqual(
    badges.map((badge) => badge.name),
    ["Dolby Vision", "Movie"]
  );
});
