import test from "node:test";
import assert from "node:assert/strict";
import { supportsMembershipFor } from "./trackingLibraryMembership.js";

// Mirrors TrackingLibraryMembershipTest tab setup: watching is series only,
// planned accepts movie and series, completed is not a membership destination.
const watching = {
  key: "watching",
  supportedContentTypes: ["series"],
  isMembershipDestination: true
};
const planned = {
  key: "planned",
  supportedContentTypes: ["movie", "series"],
  isMembershipDestination: true
};
const completed = {
  key: "completed",
  supportedContentTypes: ["movie", "series"],
  isMembershipDestination: false
};

test("movie cannot select a series only status", () => {
  assert.equal(supportsMembershipFor(watching, "movie"), false);
});

test("movie can select a status that accepts movies", () => {
  assert.equal(supportsMembershipFor(planned, "movie"), true);
});

test("series can select a series only status", () => {
  assert.equal(supportsMembershipFor(watching, "series"), true);
});

test("series aliases match a series status", () => {
  for (const type of ["tv", "show", "anime"]) {
    assert.equal(supportsMembershipFor(watching, type), true);
  }
});

test("read only status is never a destination", () => {
  assert.equal(supportsMembershipFor(completed, "movie"), false);
  assert.equal(supportsMembershipFor(completed, "series"), false);
});

test("tab without declared content types accepts anything", () => {
  const anyTab = { key: "watchlist", isMembershipDestination: true };
  assert.equal(supportsMembershipFor(anyTab, "movie"), true);
  assert.equal(supportsMembershipFor(anyTab, "series"), true);
});
