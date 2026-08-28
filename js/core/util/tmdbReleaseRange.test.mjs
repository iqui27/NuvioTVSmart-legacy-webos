import { test } from "node:test";
import assert from "node:assert/strict";

import { tmdbYearPart, buildShowYearRange, tmdbShowReleaseInfo } from "./tmdbReleaseRange.js";

test("ongoing tv show shows an open ended range", () => {
  // Mirrors Android TmdbMetadataServiceTest ongoing case.
  assert.equal(tmdbShowReleaseInfo("2012-09-20", "2024-03-10", "Returning Series"), "2012-");
});

test("ended tv show shows a closed range", () => {
  // Mirrors Android TmdbMetadataServiceTest ended case.
  assert.equal(tmdbShowReleaseInfo("2012-09-20", "2019-05-19", "Ended"), "2012-2019");
});

test("in production counts as ongoing", () => {
  assert.equal(tmdbShowReleaseInfo("2012-09-20", "2012-10-01", "In Production"), "2012-");
});

test("missing status counts as ongoing", () => {
  assert.equal(tmdbShowReleaseInfo("2012-09-20", "2024-03-10", null), "2012-");
});

test("ended show that ended in its first year shows only the start year", () => {
  assert.equal(tmdbShowReleaseInfo("2019-01-01", "2019-05-19", "Ended"), "2019");
});

test("ended show with no end year shows only the start year", () => {
  assert.equal(tmdbShowReleaseInfo("2019-01-01", null, "Canceled"), "2019");
});

test("no first air date yields null", () => {
  assert.equal(tmdbShowReleaseInfo("", "2019-05-19", "Ended"), null);
  assert.equal(tmdbShowReleaseInfo(null, null, null), null);
});

test("yearPart keeps four digit years and rejects the rest", () => {
  assert.equal(tmdbYearPart("2012-09-20"), "2012");
  assert.equal(tmdbYearPart("  2012-09-20 "), "2012");
  assert.equal(tmdbYearPart("20x2-09-20"), null);
  assert.equal(tmdbYearPart("201"), null);
  assert.equal(tmdbYearPart(null), null);
});

test("status whitespace is ignored", () => {
  assert.equal(tmdbShowReleaseInfo("2012-09-20", "2024-03-10", "  Returning Series  "), "2012-");
});
