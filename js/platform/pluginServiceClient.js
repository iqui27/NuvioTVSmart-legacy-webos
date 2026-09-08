import { Platform } from "./index.js";
import { TizenPluginService } from "./tizen/tizenPluginService.js";
import { WebOsPluginService } from "./webos/webosPluginService.js";
import {
  normalizePluginHeaders,
  validatePluginFetchRequest
} from "../core/player/pluginSecurity.js";

let cachedHealth = null;
let cachedHealthAt = 0;
const HEALTH_TTL_MS = 30000;
export const PLUGIN_PROTOCOL_VERSION = 1;

function serviceForPlatform() {
  if (Platform.isTizen()) return TizenPluginService;
  if (Platform.isWebOS()) return WebOsPluginService;
  return null;
}

function normalizeResponse(payload, requestedUrl = "") {
  const status = Number(payload?.status || payload?.statusCode || 0);
  return {
    returnValue: payload?.returnValue !== false,
    // Android's OkHttp contract is successful only for 2xx responses. Do not
    // turn redirects or service errors into a successful plugin response.
    ok: status >= 200 && status < 300,
    status,
    statusText: String(payload?.statusText || ""),
    url: String(payload?.url || requestedUrl),
    body: typeof payload?.body === "string" ? payload.body : "",
    headers: payload?.headers && typeof payload.headers === "object" ? payload.headers : {},
    truncated: payload?.truncated === true
  };
}

function androidFetchFailure(request = {}, error) {
  return {
    returnValue: true,
    ok: false,
    status: 0,
    statusText: String(error?.message || error || "Fetch failed"),
    url: String(request.url || ""),
    body: "",
    headers: {},
    truncated: false
  };
}

async function directBrowserFetch(request) {
  const validation = validatePluginFetchRequest(request, {
    maxBodyBytes: Number(request.maxBodyBytes || 1024 * 1024)
  });
  if (!validation.ok) throw new Error(validation.reason);
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const abort = () => controller?.abort();
  request.signal?.addEventListener?.("abort", abort, { once: true });
  const timer = setTimeout(abort, Number(request.timeoutMs || 30000));
  try {
    const response = await fetch(validation.url, {
      method: validation.method,
      headers: normalizePluginHeaders(validation.headers),
      body: ["POST", "PUT"].includes(validation.method) ? validation.body : undefined,
      signal: controller?.signal || request.signal
    });
    const body = await response.text();
    return normalizeResponse(
      {
        returnValue: true,
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        url: response.url,
        body,
        headers: {}
      },
      validation.url
    );
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener?.("abort", abort);
  }
}

export const PluginServiceClient = {
  getService() {
    return serviceForPlatform();
  },

  async health({ force = false } = {}) {
    const now = Date.now();
    if (!force && cachedHealth && now - cachedHealthAt < HEALTH_TTL_MS) return cachedHealth;
    const service = serviceForPlatform();
    if (!service) {
      cachedHealth = {
        returnValue: globalThis.__NUVIO_ALLOW_BROWSER_PLUGIN_RUNTIME__ === true,
        status:
          globalThis.__NUVIO_ALLOW_BROWSER_PLUGIN_RUNTIME__ === true ? "browser" : "unsupported",
        detail: "No packaged TV plugin service"
      };
      cachedHealthAt = now;
      return cachedHealth;
    }
    try {
      const payload = await service.health();
      cachedHealth = { returnValue: payload?.returnValue !== false, status: "success", ...payload };
    } catch (error) {
      cachedHealth = {
        returnValue: false,
        status: "error",
        detail: String(error?.message || error)
      };
    }
    cachedHealthAt = Date.now();
    return cachedHealth;
  },

  async ensureReady() {
    const health = await this.health();
    if (health.returnValue !== true)
      throw new Error(health.detail || "Plugin network service is not ready");
    if (
      Number(health.protocolVersion || 0) !== PLUGIN_PROTOCOL_VERSION ||
      Number(health.serviceVersion || 0) < 1 ||
      typeof health.runtimeVersion !== "string" ||
      typeof health.quickjsVersion !== "string" ||
      health.workerSupport !== true ||
      Number(health.maxConcurrency || 0) < 1 ||
      typeof health.memoryTier !== "string" ||
      health.jsPluginCapability !== true ||
      health.networkBoundary !== true
    ) {
      throw new Error("Plugin service protocol or JavaScript capability is incompatible");
    }
    return health;
  },

  async fetch(request = {}) {
    const androidContract = request.androidResponseContract === true;
    try {
      if (Platform.isBrowser()) {
        if (globalThis.__NUVIO_ALLOW_BROWSER_PLUGIN_RUNTIME__ !== true)
          throw new Error("Plugin execution is TV-only");
        return await directBrowserFetch(request);
      }
      const validation = validatePluginFetchRequest(request, {
        maxBodyBytes: Number(request.maxBodyBytes || 1024 * 1024)
      });
      if (!validation.ok) throw new Error(validation.reason);
      const service = serviceForPlatform();
      if (!service) throw new Error("Plugin network service unavailable");
      const result = await service.fetch(
        {
          requestId: String(request.requestId || `${Date.now()}-${Math.random()}`),
          url: validation.url,
          method: validation.method,
          headers: validation.headers,
          body: validation.body,
          maxBodyBytes: Number(request.maxBodyBytes || 1024 * 1024),
          maxResponseBytes: Number(request.maxResponseBytes || request.maxBodyBytes || 1024 * 1024),
          executionId: String(request.executionId || ""),
          profileId: String(request.profileId || ""),
          repositoryId: String(request.repositoryId || ""),
          scraperId: String(request.scraperId || ""),
          deadline: Number(request.deadline || 0) || undefined
        },
        {
          timeoutMs: Number(request.timeoutMs || 30000),
          signal: request.signal
        }
      );
      return normalizeResponse(result, validation.url);
    } catch (error) {
      // Android's native fetch resolves transport failures as a normal
      // response with status 0. Keep management/API calls throwing, and apply
      // that contract only to the explicit request emitted by PluginRuntime.
      if (androidContract) return androidFetchFailure(request, error);
      throw error;
    }
  },

  capabilities() {
    const service = serviceForPlatform();
    if (!service?.capabilities) return this.health({ force: true });
    return service.capabilities();
  },

  diagnostics() {
    const service = serviceForPlatform();
    if (!service?.diagnostics)
      return Promise.resolve({ returnValue: false, detail: "Diagnostics unavailable" });
    return service.diagnostics();
  },

  cancel(requestId) {
    const service = serviceForPlatform();
    if (!service || !requestId) return Promise.resolve(false);
    return service.cancel({ requestId: String(requestId) });
  },

  clearCache() {
    const service = serviceForPlatform();
    return service ? service.clearCache() : Promise.resolve(false);
  },

  resetHealthCache() {
    cachedHealth = null;
    cachedHealthAt = 0;
  }
};
