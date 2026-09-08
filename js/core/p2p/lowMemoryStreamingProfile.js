import { requestWebOsCompanionService } from "../../platform/webos/webosCompanionService.js";

// The peer budget the swarm is allowed to ask for, by memory class.
//
// A 2016-era set can ship with 624 MB of total RAM and under 300 MB free. Each
// peer costs a socket plus its receive buffer, taken from the same pool the
// video decoder draws on, so the budget tuned on a large set makes a small one
// stutter for the first minutes of playback and sometimes lose video while the
// audio track survives.
//
// The page cannot read /proc, so the companion service reports the memory class
// on its ping and this module caches it. Until that answer arrives — and on any
// runtime without the service — the default budget stands: throttling a set
// that does not need it would cost startup time for nothing.
export const DEFAULT_PEER_SEARCH_BUDGET = Object.freeze({ min: 40, max: 200 });
export const LOW_MEMORY_PEER_SEARCH_BUDGET = Object.freeze({ min: 10, max: 40 });

const PROFILE_REQUEST_TIMEOUT_MS = 4000;

let cachedProfile = null;
let pendingRequest = null;

function normalizeProfile(deviceMemory) {
  return Object.freeze({
    known: Boolean(deviceMemory?.known),
    memTotalKb: Number(deviceMemory?.memTotalKb || 0),
    memAvailableKb: Number(deviceMemory?.memAvailableKb || 0),
    lowMemory: Boolean(deviceMemory?.lowMemory)
  });
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("device memory probe timed out")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

// Synchronous read of whatever is already known. Callers on the playback path
// must not wait on a Luna round trip just to pick a peer count.
export function getCachedLowMemoryProfile() {
  return cachedProfile;
}

export function isLowMemoryDevice() {
  return Boolean(cachedProfile?.lowMemory);
}

export function getPeerSearchBudget() {
  return isLowMemoryDevice() ? LOW_MEMORY_PEER_SEARCH_BUDGET : DEFAULT_PEER_SEARCH_BUDGET;
}

// Called once at startup. Failure is not an error worth surfacing: it only
// means the default budget stays in place.
export async function primeLowMemoryProfile() {
  if (cachedProfile) {
    return cachedProfile;
  }
  if (!pendingRequest) {
    pendingRequest = withTimeout(
      requestWebOsCompanionService({ method: "ping", parameters: {} }),
      PROFILE_REQUEST_TIMEOUT_MS
    )
      .then((result) => {
        cachedProfile = normalizeProfile(result?.payload?.deviceMemory);
        return cachedProfile;
      })
      .catch(() => null)
      .then((value) => {
        pendingRequest = null;
        return value;
      });
  }
  return pendingRequest;
}

export function resetLowMemoryProfile() {
  cachedProfile = null;
  pendingRequest = null;
}
