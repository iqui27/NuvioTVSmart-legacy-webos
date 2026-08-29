import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeTraktTokenLifetimeSeconds } from "./traktTokenLifetime.js";

globalThis.localStorage = (() => {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };
})();

const { TraktAuthStore } = await import("./traktAuthStore.js");

test("legacy forced daily lifetime migrates to the documented lifetime", () => {
  assert.equal(normalizeTraktTokenLifetimeSeconds(86400), 604800);
});

test("returned token lifetime is preserved", () => {
  assert.equal(normalizeTraktTokenLifetimeSeconds(604800), 604800);
  assert.equal(normalizeTraktTokenLifetimeSeconds(3600), 3600);
  assert.equal(normalizeTraktTokenLifetimeSeconds(7776000), 7776000);
});

test("invalid token lifetime is preserved for immediate refresh", () => {
  assert.equal(normalizeTraktTokenLifetimeSeconds(0), 0);
  assert.equal(normalizeTraktTokenLifetimeSeconds(-1), -1);
});

test("numeric strings are accepted and non numbers fall back to zero", () => {
  assert.equal(normalizeTraktTokenLifetimeSeconds("86400"), 604800);
  assert.equal(normalizeTraktTokenLifetimeSeconds("604800"), 604800);
  assert.equal(normalizeTraktTokenLifetimeSeconds(undefined), 0);
  assert.equal(normalizeTraktTokenLifetimeSeconds("nope"), 0);
});

test("token storage preserves a zero lifetime for immediate refresh", () => {
  const state = TraktAuthStore.saveToken({
    access_token: "access-token",
    refresh_token: "refresh-token",
    created_at: 1,
    expires_in: 0
  });

  assert.equal(state.expiresIn, 0);
  assert.equal(TraktAuthStore.get().expiresIn, 0);
});
