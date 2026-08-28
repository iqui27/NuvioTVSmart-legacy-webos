import test from "node:test";
import assert from "node:assert/strict";

// Repository imports touch LocalStore during module init, so give them a
// localStorage before importing the code under test.
globalThis.localStorage = (() => {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };
})();

const { CatalogApi } = await import("./../remote/api/catalogApi.js");
const { catalogRepository } = await import("./catalogRepository.js");

// Mirrors CatalogRepositoryMalformedEntryTest
// "catalog skips entries without id or name and preserves pagination count".
test("catalog skips malformed entries and preserves pagination count", async () => {
  CatalogApi.getCatalog = async () => ({
    metas: [
      { id: "tt1", type: "series", name: "First" },
      { id: "tt2", type: "series" },
      null,
      { id: " ", type: "series", name: "Missing ID" },
      { id: "tt3", type: "series", name: "  Third  " }
    ]
  });

  const result = await catalogRepository.getCatalog({
    addonBaseUrl: "https://addon.example",
    addonId: "addon",
    addonName: "Addon",
    catalogId: "catalog",
    catalogName: "Catalog",
    type: "series",
    skip: 10,
    supportsSkip: true
  });

  assert.equal(result.status, "success", "a malformed entry must not fail the whole catalog");
  assert.deepEqual(
    result.data.items.map((item) => item.id),
    ["tt1", "tt3"],
    "entries without id or name are skipped"
  );
  assert.deepEqual(
    result.data.items.map((item) => item.name),
    ["First", "  Third  "],
    "kept names are preserved verbatim"
  );
  assert.equal(result.data.nextSkip, 15, "pagination advances by the raw entry count");
  assert.equal(result.data.hasMore, true, "raw entry count keeps pagination going");
});
