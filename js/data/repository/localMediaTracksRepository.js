import { Platform } from "../../platform/index.js";
import { TizenEngineFsService } from "../../platform/tizen/tizenEngineFsService.js";
import {
  isWebOsCompanionServiceAvailable,
  requestWebOsCompanionService
} from "../../platform/webos/webosCompanionService.js";

const LOCAL_MEDIA_SERVER_PORT_CANDIDATES = [2710, 2711, 2712, 2713, 2714];
const REQUEST_TIMEOUT_MS = 4000;
const TRACK_CACHE_TTL_MS = 30000;
// Every attempt makes the media server walk the container again, and the 4 s
// REQUEST_TIMEOUT_MS above only abandons the luna reply — it does not cancel the
// read already in flight. So retries stack real range requests against the same
// server that is feeding the video. On a large torrent-backed file that is the
// difference between "starts in seconds" and "starves". Two attempts, and a
// long enough empty-result TTL that the player's warmup timers (which re-ask
// every 1.2 s) coalesce onto one cached answer instead of queueing new probes.
const WEBOS_EMPTY_TRACK_CACHE_TTL_MS = 60000;
const WEBOS_LUNA_TRACK_ATTEMPTS = 2;
const WEBOS_LUNA_TRACK_RETRY_DELAY_MS = 900;
// The probe reads from the front of the container, which on a cold torrent may
// not have arrived yet, so it needs more than REQUEST_TIMEOUT_MS above. The
// service caps this at 30 s and applies the same value to its own read.
const WEBOS_LUNA_TRACK_PROBE_TIMEOUT_MS = 12000;

let cachedLocalMediaServerPort = LOCAL_MEDIA_SERVER_PORT_CANDIDATES[0];
const tracksCache = new Map();
const inFlightTrackRequests = new Map();

function getCandidatePorts() {
  const ordered = [cachedLocalMediaServerPort, ...LOCAL_MEDIA_SERVER_PORT_CANDIDATES];
  return Array.from(new Set(ordered.filter((port) => Number.isFinite(Number(port)))));
}

function buildTracksUrl(port, mediaUrl) {
  return `http://127.0.0.1:${port}/tracks/${encodeURIComponent(String(mediaUrl || "").trim())}`;
}

function buildSameOriginTracksUrl(mediaUrl) {
  return `/tracks/${encodeURIComponent(String(mediaUrl || "").trim())}`;
}

function rememberLocalMediaServerUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    const port = Number(parsed.port || 0);
    if (Number.isFinite(port) && port > 0) {
      cachedLocalMediaServerPort = port;
    }
  } catch (_) {
    // Ignore malformed service URLs.
  }
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId = 0;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => {
        reject(new Error(message || "Request timed out"));
      },
      Math.max(1, Number(timeoutMs || 0))
    );
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(ms || 0)));
  });
}

async function requestTracksViaLuna(mediaUrl) {
  const result = await withTimeout(
    requestWebOsCompanionService({
      method: "tracks",
      parameters: {
        url: String(mediaUrl || "").trim(),
        timeoutMs: WEBOS_LUNA_TRACK_PROBE_TIMEOUT_MS
      }
    }),
    // Give up locally a beat after the service does, so a probe that is simply
    // slow reports as one timeout instead of being abandoned here and retried
    // while the server-side read is still running.
    WEBOS_LUNA_TRACK_PROBE_TIMEOUT_MS + 1500,
    "webOS companion track request timed out"
  );
  const payload = result?.payload || {};
  rememberLocalMediaServerUrl(payload?.url);

  return Array.isArray(payload?.tracks) ? payload.tracks : [];
}

async function requestTracksViaLunaWithRetry(mediaUrl) {
  let lastError = null;
  for (let attempt = 1; attempt <= WEBOS_LUNA_TRACK_ATTEMPTS; attempt += 1) {
    try {
      const tracks = await requestTracksViaLuna(mediaUrl);
      if (tracks.length > 0 || attempt >= WEBOS_LUNA_TRACK_ATTEMPTS) {
        return tracks;
      }
    } catch (error) {
      lastError = error;
    }

    await delay(WEBOS_LUNA_TRACK_RETRY_DELAY_MS);
  }

  if (lastError) {
    throw lastError;
  }
  return [];
}

async function fetchJson(url) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : 0;

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller?.signal
    });
    if (!response.ok) {
      throw new Error(`Track request failed with HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export const localMediaTracksRepository = {
  async getTracks(mediaUrl) {
    const targetUrl = String(mediaUrl || "").trim();
    if (!targetUrl) {
      return [];
    }

    const cachedEntry = tracksCache.get(targetUrl);
    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
      return Array.isArray(cachedEntry.tracks) ? cachedEntry.tracks.slice() : [];
    }

    const inFlightRequest = inFlightTrackRequests.get(targetUrl);
    if (inFlightRequest) {
      const sharedTracks = await inFlightRequest;
      return Array.isArray(sharedTracks) ? sharedTracks.slice() : [];
    }

    const requestPromise = (async () => {
      if (Platform.isWebOS() && isWebOsCompanionServiceAvailable()) {
        try {
          const lunaTracks = await requestTracksViaLunaWithRetry(targetUrl);
          tracksCache.set(targetUrl, {
            tracks: Array.isArray(lunaTracks) ? lunaTracks : [],
            expiresAt:
              Date.now() +
              (lunaTracks.length > 0 ? TRACK_CACHE_TTL_MS : WEBOS_EMPTY_TRACK_CACHE_TTL_MS)
          });
          return Array.isArray(lunaTracks) ? lunaTracks : [];
        } catch (_) {
          tracksCache.set(targetUrl, {
            tracks: [],
            expiresAt: Date.now() + WEBOS_EMPTY_TRACK_CACHE_TTL_MS
          });
          return [];
        }
      }

      if (Platform.isTizen()) {
        try {
          const service = await TizenEngineFsService.ensureStarted();
          const baseUrl = String(service?.baseUrl || "").replace(/\/+$/, "");
          if (service?.status === "success" && baseUrl) {
            const payload = await fetchJson(`${baseUrl}/tracks/${encodeURIComponent(targetUrl)}`);
            const tracks = Array.isArray(payload) ? payload : [];
            rememberLocalMediaServerUrl(baseUrl);
            tracksCache.set(targetUrl, {
              tracks,
              expiresAt: Date.now() + TRACK_CACHE_TTL_MS
            });
            return tracks;
          }
        } catch (_) {
          // AVPlay metadata remains available when the packaged service cannot start.
        }
        tracksCache.set(targetUrl, {
          tracks: [],
          expiresAt: Date.now() + Math.min(TRACK_CACHE_TTL_MS, 5000)
        });
        return [];
      }

      if (Platform.isBrowser()) {
        try {
          const payload = await fetchJson(buildSameOriginTracksUrl(targetUrl));
          const tracks = Array.isArray(payload) ? payload : [];
          tracksCache.set(targetUrl, {
            tracks,
            expiresAt: Date.now() + TRACK_CACHE_TTL_MS
          });
          return tracks;
        } catch (_) {
          // Fall back to direct localhost probing below.
        }
      }

      for (const port of getCandidatePorts()) {
        try {
          const payload = await fetchJson(buildTracksUrl(port, targetUrl));
          const tracks = Array.isArray(payload) ? payload : [];
          cachedLocalMediaServerPort = port;
          tracksCache.set(targetUrl, {
            tracks,
            expiresAt: Date.now() + TRACK_CACHE_TTL_MS
          });
          return tracks;
        } catch (_) {
          // Try the next local media server port.
        }
      }

      tracksCache.set(targetUrl, {
        tracks: [],
        expiresAt: Date.now() + Math.min(TRACK_CACHE_TTL_MS, 5000)
      });
      return [];
    })();

    inFlightTrackRequests.set(targetUrl, requestPromise);
    try {
      const resolvedTracks = await requestPromise;
      return Array.isArray(resolvedTracks) ? resolvedTracks.slice() : [];
    } finally {
      inFlightTrackRequests.delete(targetUrl);
    }
  }
};
