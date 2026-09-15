import { Environment } from "../environment.js";
import {
  isWebOsCompanionServiceAvailable,
  requestWebOsCompanionService
} from "./webosCompanionService.js";

const WEBOS_SUPABASE_PROXY_REQUEST_TIMEOUT_MS = 22000;
const NULL_BODY_RESPONSE_STATUSES = new Set([204, 205, 304]);

function withTimeout(promise, timeoutMs, signal = null) {
  return new Promise((resolve, reject) => {
    let timeoutId = 0;
    const onAbort = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = 0;
      }
      const error = new Error("Request aborted");
      error.name = "AbortError";
      reject(error);
    };
    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = 0;
      }
      signal?.removeEventListener?.("abort", onAbort);
    };
    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("webOS Supabase proxy status timed out"));
    }, timeoutMs);
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener?.("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      }
    );
  });
}

function isProxyableSupabaseUrl(value = "") {
  try {
    const parsed = new URL(String(value || "").trim());
    const host = parsed.hostname.toLowerCase();
    return (
      parsed.protocol === "https:" &&
      (parsed.pathname.startsWith("/rest/v1/") || parsed.pathname.startsWith("/storage/v1/")) &&
      (host === "api.nuvio.tv" || host.endsWith(".supabase.co"))
    );
  } catch (_) {
    return false;
  }
}

function isProxyableDebridAuthUrl(value = "", method = "GET") {
  try {
    const parsed = new URL(String(value || "").trim());
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname;
    if (parsed.protocol !== "https:") return false;
    const normalizedMethod = String(method || "GET").toUpperCase();
    const authTarget =
      (host === "api.torbox.app" &&
        path === "/v1/api/user/auth/device/start" &&
        normalizedMethod === "GET") ||
      (host === "api.torbox.app" &&
        path === "/v1/api/user/auth/device/token" &&
        normalizedMethod === "POST") ||
      (host === "www.premiumize.me" && path === "/token" && normalizedMethod === "POST");
    const cloudTarget =
      normalizedMethod === "GET" &&
      ((host === "api.torbox.app" &&
        [
          "/v1/api/torrents/mylist",
          "/v1/api/usenet/mylist",
          "/v1/api/webdl/mylist",
          "/v1/api/torrents/requestdl",
          "/v1/api/usenet/requestdl",
          "/v1/api/webdl/requestdl"
        ].includes(path)) ||
        (host === "www.premiumize.me" &&
          ["/api/item/listall", "/api/item/details"].includes(path)));
    return authTarget || cloudTarget;
  } catch (_) {
    return false;
  }
}

function serializeBody(body) {
  if (body == null) {
    return null;
  }
  if (typeof body === "string") {
    return body;
  }
  return null;
}

function decodeBase64Body(value) {
  if (typeof value !== "string" || typeof atob !== "function") {
    return value;
  }
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch (error) {
    console.warn("Unable to decode webOS Supabase proxy body", error);
    return value;
  }
}

function buildResponseFromServicePayload(payload) {
  const status = Number(payload?.statusCode || 0);
  if (!status) {
    return null;
  }
  const headers = payload?.headers && typeof payload.headers === "object" ? payload.headers : {};
  const body = NULL_BODY_RESPONSE_STATUSES.has(status)
    ? null
    : payload?.bodyEncoding === "base64"
      ? decodeBase64Body(payload.body)
      : typeof payload?.body === "string"
        ? payload.body
        : "";
  if (typeof Response === "function") {
    return new Response(body, {
      status,
      headers
    });
  }
  return {
    status,
    ok: status >= 200 && status < 300,
    async text() {
      if (typeof body === "string") {
        return body || "";
      }
      if (typeof TextDecoder !== "undefined" && body instanceof Uint8Array) {
        return new TextDecoder().decode(body);
      }
      return "";
    },
    async blob() {
      if (typeof Blob === "function") {
        return new Blob([body || new Uint8Array()]);
      }
      return body;
    },
    async arrayBuffer() {
      if (body instanceof Uint8Array) {
        return body.buffer;
      }
      return new TextEncoder().encode(String(body || "")).buffer;
    }
  };
}

export async function fetchViaWebOsSupabaseProxy(url, fetchOptions = {}) {
  if (!isProxyableSupabaseUrl(url)) {
    return null;
  }
  const body = serializeBody(fetchOptions.body);
  if (fetchOptions.body != null && body == null) {
    return null;
  }
  if (!Environment.isWebOS() || !isWebOsCompanionServiceAvailable()) {
    return null;
  }

  const serviceResult = await withTimeout(
    requestWebOsCompanionService({
      method: "supabaseProxy",
      parameters: {
        url: String(url || ""),
        method: fetchOptions.method || "GET",
        headers: fetchOptions.headers || {},
        body
      }
    }),
    WEBOS_SUPABASE_PROXY_REQUEST_TIMEOUT_MS,
    fetchOptions.signal
  ).catch(() => null);
  const serviceResponse = buildResponseFromServicePayload(serviceResult?.payload);
  if (serviceResponse) {
    return serviceResponse;
  }
  return null;
}

export async function fetchViaWebOsDebridAuthProxy(url, fetchOptions = {}) {
  if (!isProxyableDebridAuthUrl(url, fetchOptions.method || "GET")) return null;
  const body = serializeBody(fetchOptions.body);
  if (fetchOptions.body != null && body == null) return null;
  if (!Environment.isWebOS() || !isWebOsCompanionServiceAvailable()) return null;

  const serviceResult = await withTimeout(
    requestWebOsCompanionService({
      method: "safeHttpProxy",
      parameters: {
        url: String(url || ""),
        method: fetchOptions.method || "GET",
        headers: fetchOptions.headers || {},
        body
      }
    }),
    WEBOS_SUPABASE_PROXY_REQUEST_TIMEOUT_MS
  ).catch(() => null);
  return buildResponseFromServicePayload(serviceResult?.payload);
}
