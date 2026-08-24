const STORAGE_KEY = "nuvioSyncBackoffState";
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 10 * 60_000;
const MAX_FAILURE_COUNT = 8;

const TRANSIENT_STATUS_CODES = new Set([
  408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 530
]);

let memoryState = {
  failureCount: 0,
  backoffUntilMs: 0,
  lastStatus: 0
};
let didLoadPersistentState = false;

function normalizeState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...memoryState };
  }
  return {
    failureCount: Math.max(
      0,
      Math.min(MAX_FAILURE_COUNT, Math.trunc(Number(value.failureCount) || 0))
    ),
    backoffUntilMs: Math.max(0, Number(value.backoffUntilMs) || 0),
    lastStatus: Math.max(0, Math.trunc(Number(value.lastStatus) || 0))
  };
}

function loadState() {
  if (didLoadPersistentState) {
    return memoryState;
  }
  didLoadPersistentState = true;
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) {
      memoryState = normalizeState(JSON.parse(raw));
    }
  } catch (_) {
    // A TV can expose localStorage only after the app shell is ready. The
    // process-local state is still enough to protect the current sync cycle.
  }
  return memoryState;
}

function saveState() {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(memoryState));
  } catch (_) {
    // Keep the in-memory backoff when persistent storage is unavailable.
  }
}

function errorStatus(error) {
  const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status ?? 0);
  return Number.isFinite(status) ? Math.trunc(status) : 0;
}

function errorText(error) {
  return `${String(error?.name || "")} ${String(error?.message || "")} ${String(
    error?.detail || ""
  )}`.toLowerCase();
}

export function isMissingResourceError(error) {
  if (!error) {
    return false;
  }
  const status = errorStatus(error);
  if (status === 404) {
    return true;
  }
  const code = String(error?.code || "").toUpperCase();
  if (code === "PGRST202" || code === "PGRST205") {
    return true;
  }
  const message = errorText(error);
  return (
    message.includes("pgrst202") ||
    message.includes("pgrst205") ||
    message.includes("could not find the function") ||
    message.includes("could not find the table")
  );
}

export function isTransientSyncError(error) {
  if (!error || isMissingResourceError(error)) {
    return false;
  }
  const status = errorStatus(error);
  if (TRANSIENT_STATUS_CODES.has(status) || (status >= 500 && status <= 599)) {
    return true;
  }
  const message = errorText(error);
  return (
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("failed to fetch") ||
    message.includes("load failed") ||
    message.includes("network") ||
    message.includes("connection reset") ||
    message.includes("temporarily unavailable")
  );
}

function retryAfterMs(error, now) {
  const explicit = Number(error?.retryAfterMs);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.min(MAX_BACKOFF_MS, explicit);
  }
  const retryAfter = String(error?.retryAfter || "").trim();
  if (!retryAfter) {
    return 0;
  }
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(MAX_BACKOFF_MS, seconds * 1000);
  }
  const dateMs = Date.parse(retryAfter);
  return Number.isFinite(dateMs) && dateMs > now ? Math.min(MAX_BACKOFF_MS, dateMs - now) : 0;
}

export function getSyncBackoffState() {
  return { ...loadState() };
}

export function getSyncBackoffRemainingMs(now = Date.now()) {
  return Math.max(0, loadState().backoffUntilMs - now);
}

export function isSyncBackoffActive(now = Date.now()) {
  return getSyncBackoffRemainingMs(now) > 0;
}

export function recordSyncFailure(error, now = Date.now()) {
  if (!isTransientSyncError(error)) {
    return false;
  }

  const current = loadState();
  const isAlreadyCoolingDown = current.backoffUntilMs > now;
  const failureCount = isAlreadyCoolingDown
    ? current.failureCount
    : Math.min(MAX_FAILURE_COUNT, current.failureCount + 1);
  const exponentialDelay = Math.min(
    MAX_BACKOFF_MS,
    BASE_BACKOFF_MS * 2 ** Math.max(0, failureCount - 1)
  );
  const delay = retryAfterMs(error, now) || exponentialDelay;

  memoryState = {
    failureCount,
    // Do not keep moving the retry window forward when several concurrent
    // requests fail against the same outage.
    backoffUntilMs: isAlreadyCoolingDown ? current.backoffUntilMs : now + delay,
    lastStatus: errorStatus(error)
  };
  saveState();
  return true;
}

export function resetSyncBackoff() {
  memoryState = {
    failureCount: 0,
    backoffUntilMs: 0,
    lastStatus: 0
  };
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch (_) {
    // Ignore storage failures; the in-memory state has still been reset.
  }
}

export const SYNC_BACKOFF_CONSTANTS = Object.freeze({
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
  MAX_FAILURE_COUNT
});
