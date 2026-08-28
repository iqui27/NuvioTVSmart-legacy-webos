import test from "node:test";
import assert from "node:assert/strict";

// Repository imports touch LocalStore during module init, so give them a
// localStorage before importing the service under test.
globalThis.localStorage = (() => {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };
})();

const { TraktScrobbleService } = await import("./traktScrobbleService.js");
const { TraktAuthService } = await import("./traktAuthService.js");

// Mirrors TraktTrackingScrobblerTest "pause preserves trakt stop behavior":
// a pause sends a Trakt stop scrobble, never a pause scrobble.
function withStubbedTrakt(run) {
  const originalFetch = globalThis.fetch;
  const originalToken = TraktAuthService.getValidAccessToken;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return { ok: true, status: 200, text: async () => "" };
  };
  TraktAuthService.getValidAccessToken = async () => "test-token";
  return Promise.resolve(run(calls)).finally(() => {
    globalThis.fetch = originalFetch;
    TraktAuthService.getValidAccessToken = originalToken;
  });
}

const movieContext = {
  contentType: "movie",
  title: "The Shawshank Redemption",
  imdbId: "tt0111161",
  progressPercent: 45
};

test("pause sends a trakt stop scrobble", async () => {
  await withStubbedTrakt(async (calls) => {
    TraktScrobbleService.pause(movieContext);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const paths = calls.map((url) => url.replace(/^.*\/scrobble\//, "scrobble/"));
    assert.ok(
      paths.some((path) => path === "scrobble/stop"),
      `expected a stop scrobble, got ${JSON.stringify(paths)}`
    );
    assert.ok(
      !paths.some((path) => path === "scrobble/pause"),
      `expected no pause scrobble, got ${JSON.stringify(paths)}`
    );
  });
});
