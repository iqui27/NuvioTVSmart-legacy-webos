import { WebOsLunaService } from "./webosLunaService.js";

const WEBOS_COMPANION_SERVICE_ID = "space.nuvio.webos.service";
const RECOVERABLE_METHODS = new Set(["ping", "status"]);

function waitBeforeRecoveryRetry() {
  return new Promise((resolve) => setTimeout(resolve, 100));
}

export function isWebOsCompanionServiceAvailable() {
  return WebOsLunaService.isAvailable();
}

export function getWebOsCompanionServiceIds() {
  return [WEBOS_COMPANION_SERVICE_ID];
}

export async function requestWebOsCompanionService({
  method = "",
  parameters = {},
  subscribe = false,
  timeoutMs = 30000,
  retryOnFailure = RECOVERABLE_METHODS.has(String(method || "").trim())
} = {}) {
  if (!isWebOsCompanionServiceAvailable()) {
    throw {
      returnValue: false,
      errorCode: -1,
      errorText: "Luna service bridge unavailable"
    };
  }

  let lastError = null;
  const attempts = retryOnFailure && !subscribe ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    for (const serviceId of getWebOsCompanionServiceIds()) {
      try {
        const payload = await WebOsLunaService.request(`luna://${serviceId}`, {
          method,
          parameters,
          subscribe,
          timeoutMs
        });
        return {
          serviceId,
          payload
        };
      } catch (error) {
        lastError = error;
      }
    }
    if (attempt + 1 < attempts) {
      await waitBeforeRecoveryRetry();
    }
  }

  throw (
    lastError || {
      returnValue: false,
      errorCode: -1,
      errorText: "No webOS companion service responded"
    }
  );
}

export function subscribeWebOsCompanionService({
  method = "",
  parameters = {},
  onSuccess = null,
  onFailure = null
} = {}) {
  if (!isWebOsCompanionServiceAvailable()) {
    throw {
      returnValue: false,
      errorCode: -1,
      errorText: "Luna service bridge unavailable"
    };
  }

  const serviceId = getWebOsCompanionServiceIds()[0];
  if (!serviceId) {
    throw {
      returnValue: false,
      errorCode: -1,
      errorText: "No webOS companion service id configured"
    };
  }

  return WebOsLunaService.subscribe(`luna://${serviceId}`, {
    method,
    parameters,
    onSuccess,
    onFailure
  });
}
