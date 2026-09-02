import { WebOsLunaService } from "./webosLunaService.js";

export const WEBOS_PLUGIN_SERVICE_ID = "space.nuvio.webos.plugin.service";

function assertAvailable() {
  if (
    !WebOsLunaService.isAvailable() ||
    globalThis.__NUVIO_WEBOS_PLUGIN_SERVICE_ENABLED__ === false
  ) {
    throw new Error("webOS plugin service unavailable");
  }
}

async function request(method, parameters = {}, { timeoutMs = 30000, signal } = {}) {
  assertAvailable();
  const result = await WebOsLunaService.request(`luna://${WEBOS_PLUGIN_SERVICE_ID}`, {
    method,
    parameters,
    timeoutMs,
    signal
  });
  if (result?.returnValue === false) {
    throw new Error(result.errorText || `webOS plugin service ${method} failed`);
  }
  return result;
}

export const WebOsPluginService = {
  isAvailable() {
    return (
      WebOsLunaService.isAvailable() && globalThis.__NUVIO_WEBOS_PLUGIN_SERVICE_ENABLED__ !== false
    );
  },

  health() {
    return request("ping", {}, { timeoutMs: 5000 });
  },

  capabilities() {
    return request("capabilities", {}, { timeoutMs: 5000 });
  },

  diagnostics() {
    return request("diagnostics", {}, { timeoutMs: 5000 });
  },

  fetch(payload, options) {
    return request("fetch", payload, options);
  },

  cancel(payload) {
    return request("cancel", payload, { timeoutMs: 2000 }).catch(() => false);
  },

  clearCache() {
    return request("cacheClear", {}, { timeoutMs: 5000 });
  }
};
