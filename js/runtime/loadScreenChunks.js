// Side-effect import: publishes every shared-core module namespace on
// globalThis.__NUVIO_SHARED__ before any chunk can run. The chunk re-exports
// the shared singletons FROM that global instead of bundling its own copies,
// so `Router.current` is the same object on both sides of the split.
import "./generated/sharedModuleRegistry.js";

// On-demand loader for screen chunks.
//
// Deliberately a near-copy of loadStreamingLibs.js: same `{id, sources,
// isLoaded}` shape, same promise-returning `loadScript`, same memoisation of
// the in-flight promise. Two differences matter:
//
//   * `sources` is LOCAL ONLY. A streaming library can legitimately fall back
//     to a CDN; application code never can. A chunk fetched from the network
//     would be a different build than the bundle that asked for it, and on a
//     TV with no connectivity the fallback is pure added latency before the
//     same failure.
//   * The chunk publishes itself on `globalThis.__NUVIO_SCREEN_CHUNKS__`, so
//     `isLoaded()` is the honest completion test: the <script> onload fires
//     when the file is parsed, not when its last statement ran.
//
// A failed load is retryable: the memoised promise is cleared in `finally` and
// nothing is cached, so the next navigation attempts the load again.
const SCREEN_CHUNKS = [
  {
    id: "player",
    sources: ["player.chunk.js"],
    isLoaded: () => Boolean(globalThis.__NUVIO_SCREEN_CHUNKS__?.player)
  }
];

let screenChunkWarmupScheduled = false;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = (error) => {
      script.remove();
      reject(error);
    };
    document.head.appendChild(script);
  });
}

async function loadScreenChunkSources(entry) {
  let lastError = null;
  for (const src of entry.sources) {
    try {
      await loadScript(src);
      if (entry.isLoaded()) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`Screen chunk "${entry.id}" failed to initialize`);
}

function ensureScreenChunk(entry) {
  if (entry.isLoaded()) {
    return Promise.resolve();
  }
  if (entry.loadingPromise) {
    return entry.loadingPromise;
  }
  const loadingPromise = loadScreenChunkSources(entry).finally(() => {
    if (entry.loadingPromise === loadingPromise) {
      entry.loadingPromise = null;
    }
  });
  entry.loadingPromise = loadingPromise;
  return loadingPromise;
}

// Returns the chunk's export namespace, or null when it could not be loaded.
// Never throws: a missing chunk must degrade to "this screen is unavailable",
// never to a rejected navigation that leaves the app without a mounted screen.
export async function loadScreenChunk(chunkId) {
  const entry = SCREEN_CHUNKS.find((candidate) => candidate.id === chunkId);
  if (!entry) {
    console.warn("Unknown screen chunk", chunkId);
    return null;
  }
  try {
    await ensureScreenChunk(entry);
  } catch (error) {
    console.warn("Screen chunk failed to load", entry.sources, error);
    return null;
  }
  return globalThis.__NUVIO_SCREEN_CHUNKS__?.[chunkId] || null;
}

export function isScreenChunkLoaded(chunkId) {
  const entry = SCREEN_CHUNKS.find((candidate) => candidate.id === chunkId);
  return Boolean(entry?.isLoaded());
}

// Prefetch every chunk while the TV is idle, so the first navigation to a lazy
// route is a memory hit instead of a disk read plus a parse. Scheduled LATER
// than warmStreamingLibs so the two warms do not contend for this TV's very
// limited network/IO stack during the first seconds after boot.
export function warmScreenChunks(options = {}) {
  if (screenChunkWarmupScheduled || SCREEN_CHUNKS.every((entry) => entry.isLoaded())) {
    return;
  }
  screenChunkWarmupScheduled = true;
  const delayMs = Math.max(0, Number(options?.delayMs || 2600));
  const startWarmup = () => {
    screenChunkWarmupScheduled = false;
    for (const entry of SCREEN_CHUNKS) {
      if (!entry.isLoaded()) {
        void loadScreenChunk(entry.id);
      }
    }
  };
  if (typeof globalThis.requestIdleCallback === "function") {
    globalThis.requestIdleCallback(startWarmup, { timeout: Math.max(2000, delayMs + 1200) });
    return;
  }
  setTimeout(startWarmup, delayMs);
}
