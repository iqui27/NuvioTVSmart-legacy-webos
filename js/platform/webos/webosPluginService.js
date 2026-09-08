import { WebOsLunaService } from "./webosLunaService.js";

export const WEBOS_PLUGIN_SERVICE_ID = "space.nuvio.webos.plugin.service";
const RECOVERY_RETRY_DELAY_MS = 100;

function assertAvailable() {
  if (
    !WebOsLunaService.isAvailable() ||
    globalThis.__NUVIO_WEBOS_PLUGIN_SERVICE_ENABLED__ === false
  ) {
    throw new Error("webOS plugin service unavailable");
  }
}

async function request(
  method,
  parameters = {},
  { timeoutMs = 30000, signal, retryOnFailure = false } = {}
) {
  assertAvailable();
  const attempts = retryOnFailure ? 2 : 1;
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
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
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, RECOVERY_RETRY_DELAY_MS));
      }
    }
  }
  throw lastError;
}

export const WebOsPluginService = {
  isAvailable() {
    return (
      WebOsLunaService.isAvailable() && globalThis.__NUVIO_WEBOS_PLUGIN_SERVICE_ENABLED__ !== false
    );
  },

  health() {
    return request("ping", {}, { timeoutMs: 5000, retryOnFailure: true });
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
