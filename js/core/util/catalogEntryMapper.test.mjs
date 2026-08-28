import { test } from "node:test";
import assert from "node:assert/strict";

import { isMappableCatalogEntry, selectCatalogEntries } from "./catalogEntryMapper.js";

test("skips entries without id or name and preserves the raw entry count", () => {
  const { metas, rawItemCount } = selectCatalogEntries([
    { id: "tt1", type: "series", name: "First" },
    { id: "tt2", type: "series" },
    null,
    { id: " ", type: "series", name: "Missing ID" },
    { id: "tt3", type: "series", name: "  Third  " }
  ]);

  assert.deepEqual(
    metas.map((meta) => meta.id),
    ["tt1", "tt3"]
  );
  assert.deepEqual(
    metas.map((meta) => meta.name),
    ["First", "  Third  "]
  );
  assert.equal(rawItemCount, 5);
});

test("drops duplicate ids and keeps the first entry", () => {
  const { metas, rawItemCount } = selectCatalogEntries([
    { id: "tt1", name: "First" },
    { id: "tt1", name: "First again" },
    { id: "tt2", name: "Second" }
  ]);

  assert.deepEqual(
    metas.map((meta) => meta.id),
    ["tt1", "tt2"]
  );
  assert.deepEqual(
    metas.map((meta) => meta.name),
    ["First", "Second"]
  );
  assert.equal(rawItemCount, 3);
});

test("returns an empty result for missing or non array input", () => {
  assert.deepEqual(selectCatalogEntries(undefined), { metas: [], rawItemCount: 0 });
  assert.deepEqual(selectCatalogEntries(null), { metas: [], rawItemCount: 0 });
  assert.deepEqual(selectCatalogEntries({}), { metas: [], rawItemCount: 0 });
});

test("isMappableCatalogEntry guards null, non objects, and blank fields", () => {
  assert.equal(isMappableCatalogEntry(null), false);
  assert.equal(isMappableCatalogEntry("nope"), false);
  assert.equal(isMappableCatalogEntry([]), false);
  assert.equal(isMappableCatalogEntry({ id: "tt1" }), false);
  assert.equal(isMappableCatalogEntry({ name: "No id" }), false);
  assert.equal(isMappableCatalogEntry({ id: "  ", name: "Blank id" }), false);
  assert.equal(isMappableCatalogEntry({ id: 123, name: "Numeric id" }), false);
  assert.equal(isMappableCatalogEntry({ id: "tt1", name: 123 }), false);
  assert.equal(isMappableCatalogEntry({ id: "tt1", name: "Ok" }), true);
});
