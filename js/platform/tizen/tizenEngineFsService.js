import { Platform } from "../index.js";
import { TizenCapabilities } from "./tizenCapabilities.js";

const LOCAL_BASE_URLS = [
  "http://127.0.0.1:2710",
  "http://localhost:2710",
  "http://127.0.0.1:11470",
  "http://localhost:11470"
];

const START_TIMEOUT_MS = 12000;
const PROBE_TIMEOUT_MS = 2500;
const SERVICE_START_CALL_TIMEOUT_MS = 4000;
const TIZEN_DEFAULT_OPERATION = "http://tizen.org/appcontrol/operation/default";

let startPromise = null;

function logTizenP2pDebug(...args) {
  if (globalThis.__NUVIO_DEBUG_ENGINEFS__ || globalThis.__NUVIO_DEBUG_TIZEN_P2P__) {
    console.info(...args);
  }
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId = 0;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

function getServiceId() {
  const configured = String(globalThis.__NUVIO_TIZEN_ENGINEFS_SERVICE_ID__ || "").trim();
  if (configured) {
    return configured;
  }
  try {
    const appInfo = globalThis.tizen?.application?.getCurrentApplication?.()?.appInfo;
    const packageId = String(appInfo?.packageId || "").trim();

    if (packageId) {
      return `${packageId}.EngineFsService`;
    }

    const appId = String(appInfo?.id || "").trim();
    return appId ? `${appId}.EngineFsService` : "";
  } catch (_) {
    return "";
  }
}

function invokeCallbackApi(fn, args = []) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const onSuccess = (value) => {
      settled = true;
      resolve(value);
    };
    const onFailure = (error) => {
      settled = true;
      reject(error);
    };
    try {
      const result = fn(...args, onSuccess, onFailure);
      if (!settled && typeof result !== "undefined") {
        resolve(result);
      }
    } catch (error) {
      reject(error);
    }
  });
}

async function startViaApplicationControl(serviceId, operation = TIZEN_DEFAULT_OPERATION) {
  const application = globalThis.tizen?.application;
  const ApplicationControl = globalThis.tizen?.ApplicationControl;
  if (!application || typeof application.launchAppControl !== "function") {
    throw new Error("tizen.application.launchAppControl unavailable");
  }
  if (typeof ApplicationControl !== "function") {
    throw new Error("tizen.ApplicationControl unavailable");
  }

  const appControl = new ApplicationControl(operation);
  return invokeCallbackApi(application.launchAppControl.bind(application), [appControl, serviceId]);
}

async function startViaWrtService(serviceId) {
  const wrtService =
    globalThis.wrt?.service || globalThis.webapis?.wrt?.service || globalThis.webapis?.service;
  if (!wrtService) {
    throw new Error("wrt service API unavailable");
  }
  if (typeof wrtService.startService === "function") {
    try {
      return await invokeCallbackApi(wrtService.startService.bind(wrtService), [serviceId]);
    } catch (firstError) {
      return invokeCallbackApi(wrtService.startService.bind(wrtService), [{ id: serviceId }]).catch(
        () => {
          throw firstError;
        }
      );
    }
  }
  if (typeof wrtService.start === "function") {
    return invokeCallbackApi(wrtService.start.bind(wrtService), [serviceId]);
  }
  throw new Error("wrt service start API unavailable");
}

async function startViaTizenApplication(serviceId) {
  const application = globalThis.tizen?.application;
  if (!application || typeof application.launch !== "function") {
    throw new Error("tizen.application.launch unavailable");
  }
  return invokeCallbackApi(application.launch.bind(application), [serviceId]);
}

async function requestServiceStart(serviceId) {
  const errors = [];
  const legacyServiceFirst = TizenCapabilities.get().webServiceSupported === false;
  const officialAttempts = [
    {
      method: "tizen-application-control-default",
      start: () => startViaApplicationControl(serviceId, TIZEN_DEFAULT_OPERATION)
    },
    {
      method: "tizen-application-launch",
      start: () => startViaTizenApplication(serviceId)
    },
    {
      method: "wrt-service-legacy",
      start: () => startViaWrtService(serviceId)
    }
  ];
  // Samsung warns that application-control launches can disturb the
  // foreground app when web.service is reported as unavailable. Preserve the
  // legacy path that worked on older firmware first and only use the official
  // application-control path when the capability is true or unknown.
  const attempts = legacyServiceFirst
    ? officialAttempts.slice(2).concat(officialAttempts.slice(1, 2))
    : officialAttempts;

  for (const attempt of attempts) {
    try {
      await withTimeout(
        attempt.start(),
        SERVICE_START_CALL_TIMEOUT_MS,
        `${attempt.method} service start call timed out`
      );
      return { method: attempt.method };
    } catch (error) {
      errors.push(`${attempt.method}: ${error?.message || error}`);
    }
  }
  throw new Error(errors.join("; "));
}

async function probeBaseUrl(baseUrl, timeoutMs = PROBE_TIMEOUT_MS) {
  const response = await withTimeout(
    fetch(`${baseUrl}/settings`, {
      method: "GET",
      cache: "no-cache"
    }),
    timeoutMs,
    `Tizen local EngineFS settings probe timed out for ${baseUrl}`
  );
  if (!response.ok) {
    throw new Error(`Tizen local EngineFS settings failed with HTTP ${response.status}`);
  }
  let json = null;
  try {
    json = await response.clone().json();
  } catch (_) {
    json = null;
  }
  return { baseUrl, settings: json };
}

async function findReachableLocalBaseUrl(timeoutMs = PROBE_TIMEOUT_MS) {
  let lastError = null;
  for (const baseUrl of LOCAL_BASE_URLS) {
    try {
      return await probeBaseUrl(baseUrl, timeoutMs);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("No local Tizen EngineFS base URL responded");
}

async function waitForLocalBaseUrl(timeoutMs = START_TIMEOUT_MS) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await findReachableLocalBaseUrl(1200);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 450));
    }
  }
  throw lastError || new Error("Timed out waiting for local Tizen EngineFS service");
}

export const TizenEngineFsService = {
  getLocalBaseUrls() {
    return [...LOCAL_BASE_URLS];
  },

  async probeBaseUrl(baseUrl, timeoutMs = PROBE_TIMEOUT_MS) {
    return probeBaseUrl(baseUrl, timeoutMs);
  },

  async findReachableLocalBaseUrl(timeoutMs = PROBE_TIMEOUT_MS) {
    return findReachableLocalBaseUrl(timeoutMs);
  },

  async ensureStarted({ purpose = "generic" } = {}) {
    if (!Platform.isTizen()) {
      return { status: "unsupported", detail: "Not running on Tizen" };
    }
    const capabilities = TizenCapabilities.get();
    if (purpose !== "p2p" && !capabilities.supportsWebService) {
      return {
        status: "unsupported",
        detail: "Tizen web service support is unavailable on this TV"
      };
    }
    if (purpose === "p2p" && !capabilities.supportsP2p) {
      return {
        status: "unsupported",
        detail: "Tizen P2P streaming is not supported on this TV"
      };
    }
    try {
      const existing = await findReachableLocalBaseUrl();
      return { status: "success", ...existing, started: false };
    } catch (_) {
      // Continue with explicit service startup.
    }

    if (!startPromise) {
      startPromise = (async () => {
        const serviceId = getServiceId();
        if (!serviceId) {
          throw new Error("Tizen EngineFS service id is unavailable");
        }
        const startResult = await requestServiceStart(serviceId);
        logTizenP2pDebug("Tizen EngineFS service start requested", {
          serviceId,
          method: startResult.method
        });
        const reachable = await waitForLocalBaseUrl();
        return { ...reachable, serviceId, startMethod: startResult.method };
      })().finally(() => {
        startPromise = null;
      });
    }

    try {
      const result = await startPromise;
      return { status: "success", ...result, started: true };
    } catch (error) {
      return {
        status: "error",
        detail: error?.message || String(error || "Tizen EngineFS service startup failed")
      };
    }
  }
};
