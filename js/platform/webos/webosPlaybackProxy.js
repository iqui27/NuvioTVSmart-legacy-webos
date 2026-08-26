import { requestWebOsCompanionService } from "./webosCompanionService.js";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "range",
  "transfer-encoding"
]);
const WEBOS_PLAYBACK_PROXY_TIMEOUT_MS = 5000;

function normalizeHeaderEntries(headers = {}) {
  if (!headers || typeof headers !== "object") {
    return [];
  }
  return Object.entries(headers)
    .map(([key, value]) => [String(key || "").trim(), String(value ?? "").trim()])
    .filter(([key, value]) => key && value)
    .filter(([key]) => !HOP_BY_HOP_HEADERS.has(key.toLowerCase()))
    .filter(
      ([key, value]) =>
        !key.includes("\r") && !key.includes("\n") && !value.includes("\r") && !value.includes("\n")
    );
}

function parseHttpUrl(value = "") {
  try {
    const parsed = new URL(String(value || "").trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed;
  } catch (_) {
    return null;
  }
}

function isLocalProxyUrl(value = "") {
  const parsed = parseHttpUrl(value);
  if (!parsed || !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    return false;
  }
  return parsed.pathname.startsWith("/proxy/");
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

export function hasWebOsPlaybackHeaders(headers = {}) {
  return normalizeHeaderEntries(headers).length > 0;
}

export function buildWebOsPlaybackProxyUrl(baseUrl, sourceUrl, headers = {}) {
  const base = parseHttpUrl(baseUrl);
  const source = parseHttpUrl(sourceUrl);
  const entries = normalizeHeaderEntries(headers);
  if (!base || !source || !entries.length) {
    return "";
  }

  const options = new URLSearchParams();
  options.set("d", `${source.protocol}//${source.host}`);
  entries.forEach(([key, value]) => {
    options.append("h", `${key}:${value}`);
  });

  const root = `${base.protocol}//${base.host}`.replace(/\/+$/, "");
  return `${root}/proxy/${options.toString()}${source.pathname || "/"}${source.search}`;
}

export const WebOsPlaybackProxy = {
  requiresProxy(sourceUrl = "", headers = {}) {
    return Boolean(
      parseHttpUrl(sourceUrl) && !isLocalProxyUrl(sourceUrl) && hasWebOsPlaybackHeaders(headers)
    );
  },

  async resolve(sourceUrl = "", headers = {}) {
    const originalUrl = String(sourceUrl || "").trim();
    if (!this.requiresProxy(originalUrl, headers)) {
      return { status: "not-required", url: originalUrl, proxied: false };
    }

    let service;
    try {
      service = await withTimeout(
        requestWebOsCompanionService({ method: "ping", parameters: {} }),
        WEBOS_PLAYBACK_PROXY_TIMEOUT_MS,
        "webOS playback proxy service timed out"
      );
    } catch (error) {
      return {
        status: "unavailable",
        url: originalUrl,
        proxied: false,
        detail: error?.message || String(error || "webOS playback proxy service unavailable")
      };
    }

    const payload = service?.payload || {};
    const baseUrl = String(payload.url || "").trim();
    if (payload.returnValue === false || !payload.settingsReachable || !baseUrl) {
      return {
        status: "unavailable",
        url: originalUrl,
        proxied: false,
        detail: payload.errorText || "webOS playback proxy service unavailable"
      };
    }

    const proxyUrl = buildWebOsPlaybackProxyUrl(baseUrl, originalUrl, headers);
    if (!proxyUrl) {
      return {
        status: "unavailable",
        url: originalUrl,
        proxied: false,
        detail: "webOS playback proxy URL could not be built"
      };
    }

    return {
      status: "success",
      url: proxyUrl,
      proxied: true,
      baseUrl,
      headerNames: normalizeHeaderEntries(headers).map(([key]) => key)
    };
  }
};
