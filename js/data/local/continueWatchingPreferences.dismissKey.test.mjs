import test from "node:test";
import assert from "node:assert/strict";

// Mirrors Android TraktSettingsDataStore.addDismissedNextUpKey /
// removeDismissedNextUpKeysForContent, whose dismiss key is the bare contentId
// (nextUpDismissKey returns contentId.trim()). The removal must clear both the
// bare key ("contentId") and any legacy "contentId|season|episode" entry, the
// same as Android's filterNot { it == trimmed || it.startsWith("$trimmed|") }.

const store = new Map();

globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear()
};

const { ContinueWatchingPreferences } = await import("./continueWatchingPreferences.js");

function reset() {
  store.clear();
}

test("removing dismissed keys clears the bare contentId that dismiss stores", () => {
  reset();
  // Home screen stores the bare contentId when a Next Up card is dismissed.
  ContinueWatchingPreferences.addDismissedNextUpKey("tt123");
  assert.deepEqual(ContinueWatchingPreferences.getDismissedNextUpKeys(), ["tt123"]);

  // Watching a new episode saves progress, which must remove the dismiss.
  ContinueWatchingPreferences.removeDismissedNextUpKeysForContent("tt123");
  assert.deepEqual(ContinueWatchingPreferences.getDismissedNextUpKeys(), []);
});

test("removing dismissed keys also clears the legacy contentId|season|episode form", () => {
  reset();
  ContinueWatchingPreferences.replaceDismissedNextUpKeys(["tt123|1|2", "tt123"]);
  ContinueWatchingPreferences.removeDismissedNextUpKeysForContent("tt123");
  assert.deepEqual(ContinueWatchingPreferences.getDismissedNextUpKeys(), []);
});

test("removing dismissed keys leaves other content untouched", () => {
  reset();
  ContinueWatchingPreferences.replaceDismissedNextUpKeys(["tt123", "tt999", "tt999|3|4"]);
  ContinueWatchingPreferences.removeDismissedNextUpKeysForContent("tt123");
  assert.deepEqual(ContinueWatchingPreferences.getDismissedNextUpKeys(), ["tt999", "tt999|3|4"]);
});
