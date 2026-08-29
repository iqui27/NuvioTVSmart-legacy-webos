import test from "node:test";
import assert from "node:assert/strict";
import { resolutionFromText, resolutionFromFields } from "./streamResolution.js";

test("field priority keeps the parsed resolution over noise in the title", () => {
  // Parser is right: the file is 1080p. Title mentions a 4K remaster and a
  // 2160p pack. Field priority must return 1080p, not 4K.
  const result = resolutionFromFields([
    "1080p",
    "web-dl",
    "",
    "movie 2020 1080p web-dl x264 [4k remaster available] 2160p pack"
  ]);
  assert.equal(result, "P1080");
});

test("clean stream classifies the same as before", () => {
  const result = resolutionFromFields(["2160p", "remux", "", "movie 2020 2160p uhd bluray remux"]);
  assert.equal(result, "P2160");
});

test("falls through to the next field when a field has no resolution", () => {
  const result = resolutionFromFields(["", "web-dl", "", "show s01e01 720p"]);
  assert.equal(result, "P720");
});

test("uses the addon quality hint when nothing else has a resolution", () => {
  const result = resolutionFromFields([null, "web-dl", "4k", "some release group"]);
  assert.equal(result, "P2160");
});

test("returns UNKNOWN when no field carries a resolution", () => {
  assert.equal(resolutionFromFields(["", "web-dl", "", "release group only"]), "UNKNOWN");
});

test("resolutionFromText still maps single tokens", () => {
  assert.equal(resolutionFromText("1080p"), "P1080");
  assert.equal(resolutionFromText("uhd"), "P2160");
  assert.equal(resolutionFromText("nothing here"), "UNKNOWN");
});
