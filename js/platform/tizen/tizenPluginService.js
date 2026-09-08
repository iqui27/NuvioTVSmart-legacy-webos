import { Platform } from "../index.js";
import { TizenCapabilities } from "./tizenCapabilities.js";

const LOCAL_BASE_URLS = [
  "http://127.0.0.1:2711",
  "http://localhost:2711",
  "http://127.0.0.1:11471",
  "http://localhost:11471"
];
const START_TIMEOUT_MS = 12000;
const PROBE_TIMEOUT_MS = 2500;
const SERVICE_START_CALL_TIMEOUT_MS = 4000;
const DEFAULT_OPERATION = "http://tizen.org/appcontrol/operation/default";
let startPromise = null;

function withTimeout(promise, timeoutMs, message) {
  let timer = 0;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function serviceId() {
  const configured = String(globalThis.__NUVIO_TIZEN_PLUGIN_SERVICE_ID__ || "").trim();
  if (configured) return configured;
  try {
    const appInfo = globalThis.tizen?.application?.getCurrentApplication?.()?.appInfo;
    const packageId = String(appInfo?.packageId || "").trim();
    return packageId ? `${packageId}.PluginService` : "";
  } catch (_) {
    return "";
  }
}

function callbackCall(fn, args = []) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const success = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const failure = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    try {
      const result = fn(...args, success, failure);
      if (!settled && result !== undefined) resolve(result);
    } catch (error) {
      failure(error);
    }
  });
}

async function startWithApplicationControl(id) {
  const application = globalThis.tizen?.application;
  const ApplicationControl = globalThis.tizen?.ApplicationControl;
  if (!application?.launchAppControl || typeof ApplicationControl !== "function") {
    throw new Error("Tizen application control API unavailable");
  }
  const control = new ApplicationControl(DEFAULT_OPERATION);
  return callbackCall(application.launchAppControl.bind(application), [control, id]);
}

async function startWithApplication(id) {
  const application = globalThis.tizen?.application;
  if (!application?.launch) throw new Error("Tizen application launch API unavailable");
  return callbackCall(application.launch.bind(application), [id]);
}

async function startWithLegacyService(id) {
  const service =
    globalThis.wrt?.service || globalThis.webapis?.wrt?.service || globalThis.webapis?.service;
  if (!service) throw new Error("Tizen legacy service API unavailable");
  if (typeof service.startService === "function") {
    try {
      return await callbackCall(service.startService.bind(service), [id]);
    } catch (_) {
      return callbackCall(service.startService.bind(service), [{ id }]);
    }
  }
  if (typeof service.start === "function") return callbackCall(service.start.bind(service), [id]);
  throw new Error("Tizen service start API unavailable");
}

async function requestStart(id) {
  const attempts = [startWithApplicationControl, startWithApplication, startWithLegacyService];
  const errors = [];
  for (const attempt of attempts) {
    try {
      await withTimeout(
        attempt(id),
        SERVICE_START_CALL_TIMEOUT_MS,
        "Tizen plugin service start timed out"
      );
      return attempt.name;
    } catch (error) {
      errors.push(String(error?.message || error));
    }
  }
  throw new Error(errors.join("; "));
}

async function requestJson(url, options = {}, timeoutMs = PROBE_TIMEOUT_MS) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeout = setTimeout(() => controller?.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      cache: "no-store",
      signal: controller?.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Tizen plugin service HTTP ${response.status}`);
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function probe(baseUrl, timeoutMs = PROBE_TIMEOUT_MS) {
  return { baseUrl, payload: await requestJson(`${baseUrl}/health`, {}, timeoutMs) };
}

async function findBaseUrl(timeoutMs = PROBE_TIMEOUT_MS) {
  let lastError = null;
  for (const baseUrl of LOCAL_BASE_URLS) {
    try {
      return await probe(baseUrl, timeoutMs);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("No Tizen plugin service responded");
}

async function waitForBaseUrl(timeoutMs = START_TIMEOUT_MS) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await findBaseUrl(1200);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  throw lastError || new Error("Timed out waiting for the Tizen plugin service");
}

export const TizenPluginService = {
  getLocalBaseUrls() {
    return [...LOCAL_BASE_URLS];
  },

  async ensureStarted() {
    if (!Platform.isTizen()) return { status: "unsupported", detail: "Not running on Tizen" };
    if (globalThis.__NUVIO_TIZEN_PLUGIN_SERVICE_ENABLED__ === false) {
      return { status: "unsupported", detail: "Plugin service is not packaged" };
    }
    const capabilities = TizenCapabilities.get();
    if (!capabilities.isTizen || !capabilities.hasWebAssembly) {
      return { status: "unsupported", detail: "Tizen WebAssembly is unavailable" };
    }
    try {
      const reachable = await findBaseUrl();
      return { status: "success", ...reachable, started: false };
    } catch (_) {
      // Start below.
    }
    if (!startPromise) {
      startPromise = (async () => {
        const id = serviceId();
        if (!id) throw new Error("Tizen plugin service id is unavailable");
        const startMethod = await requestStart(id);
        const reachable = await waitForBaseUrl();
        return { ...reachable, serviceId: id, startMethod };
      })().finally(() => {
        startPromise = null;
      });
    }
    try {
      return { status: "success", ...(await startPromise), started: true };
    } catch (error) {
      return { status: "error", detail: String(error?.message || error) };
    }
  },

  async health() {
    const started = await this.ensureStarted();
    if (started.status !== "success") return { returnValue: false, ...started };
    return { returnValue: true, ...started, ...(started.payload || {}) };
  },

  async capabilities() {
    const started = await this.ensureStarted();
    if (started.status !== "success") return { returnValue: false, ...started };
    return requestJson(`${started.baseUrl}/capabilities`, {}, PROBE_TIMEOUT_MS);
  },

  async diagnostics() {
    const started = await this.ensureStarted();
    if (started.status !== "success") return { returnValue: false, ...started };
    return requestJson(`${started.baseUrl}/diagnostics`, {}, PROBE_TIMEOUT_MS);
  },

  async request(method, payload = {}, { timeoutMs = 30000, signal } = {}) {
    const started = await this.ensureStarted();
    if (started.status !== "success")
      throw new Error(started.detail || "Tizen plugin service unavailable");
    const baseUrl = started.baseUrl;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const abort = () => controller?.abort();
    signal?.addEventListener?.("abort", abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    try {
      const response = await fetch(`${baseUrl}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: controller?.signal
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.returnValue === false)
        throw new Error(result.errorText || `Tizen plugin service HTTP ${response.status}`);
      return result;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", abort);
    }
  },

  fetch(payload, options) {
    return this.request("fetch", payload, options);
  },

  cancel(payload) {
    return this.request("cancel", payload, { timeoutMs: 2000 }).catch(() => false);
  },

  clearCache() {
    return this.request("cache/clear", {}, { timeoutMs: 5000 });
  }
};
