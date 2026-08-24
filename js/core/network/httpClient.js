import { SessionStore } from "../storage/sessionStore.js";
import { AuthManager } from "../auth/authManager.js";
import { fetchViaWebOsSupabaseProxy } from "../../platform/webos/webosSupabaseProxy.js";

const DEFAULT_HTTP_REQUEST_TIMEOUT_MS = 60_000;

function toHeaderObject(headers) {
  if (!headers) {
    return {};
  }
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  return { ...headers };
}

function hasHeader(headers, name) {
  const target = String(name || "").toLowerCase();
  return Object.keys(headers || {}).some((key) => String(key).toLowerCase() === target);
}

function resolveTimeoutMs(value) {
  if (value === undefined) {
    return DEFAULT_HTTP_REQUEST_TIMEOUT_MS;
  }
  const timeoutMs = Number(value);
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0;
}

function createRequestTimeoutError(timeoutMs) {
  const error = new Error(`Request timed out after ${timeoutMs}ms`);
  error.code = "REQUEST_TIMEOUT";
  error.name = "TimeoutError";
  return error;
}

async function withRequestTimeout(task, timeoutMs, callerSignal) {
  if (!timeoutMs) {
    return task(callerSignal);
  }

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const requestSignal = controller?.signal || callerSignal;
  let removeAbortListener = null;
  if (controller && callerSignal) {
    const forwardAbort = () => controller.abort();
    if (callerSignal.aborted) {
      controller.abort();
    } else if (typeof callerSignal.addEventListener === "function") {
      callerSignal.addEventListener("abort", forwardAbort, { once: true });
      removeAbortListener = () => callerSignal.removeEventListener("abort", forwardAbort);
    }
  }

  let timeoutId = 0;
  let didTimeout = false;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        didTimeout = true;
        controller?.abort();
        reject(createRequestTimeoutError(timeoutMs));
      }, timeoutMs);
    });
    return await Promise.race([Promise.resolve().then(() => task(requestSignal)), timeoutPromise]);
  } catch (error) {
    if (didTimeout) {
      throw createRequestTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    removeAbortListener?.();
  }
}

export async function httpRequest(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const includeSessionAuth = options.includeSessionAuth !== false;
  let refreshFailedTransiently = false;

  const headers = toHeaderObject(options.headers);

  if (includeSessionAuth && SessionStore.refreshToken && AuthManager.isAccessTokenExpired()) {
    await AuthManager.refreshSessionIfNeeded();
    refreshFailedTransiently = AuthManager.wasLastSessionRefreshTransientFailure?.() === true;
  }

  if (includeSessionAuth && SessionStore.accessToken && !hasHeader(headers, "Authorization")) {
    headers["Authorization"] = `Bearer ${SessionStore.accessToken}`;
  }

  const body = options.body;
  const hasBody = body != null && method !== "GET" && method !== "HEAD";
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  const isBlob = typeof Blob !== "undefined" && body instanceof Blob;
  const isSearchParams = typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams;
  if (hasBody && !hasHeader(headers, "Content-Type") && !isFormData && !isBlob && !isSearchParams) {
    headers["Content-Type"] = "application/json";
  }

  const {
    includeSessionAuth: _ignoredIncludeSessionAuth,
    responseType: requestedResponseType,
    timeoutMs: requestedTimeoutMs,
    signal: callerSignal,
    ...fetchOptions
  } = options;

  const timeoutMs = resolveTimeoutMs(requestedTimeoutMs);
  return withRequestTimeout(
    async (requestSignal) => {
      const fetchInit = {
        ...fetchOptions,
        method,
        credentials: fetchOptions.credentials || "omit",
        headers,
        ...(requestSignal ? { signal: requestSignal } : {})
      };

      let response =
        (await fetchViaWebOsSupabaseProxy(url, fetchInit)) || (await fetch(url, fetchInit));

      if (response.status === 401 && includeSessionAuth && SessionStore.refreshToken) {
        const refreshed = await AuthManager.refreshSessionIfNeeded({ force: true });
        refreshFailedTransiently = AuthManager.wasLastSessionRefreshTransientFailure?.() === true;
        if (refreshed && SessionStore.accessToken) {
          const retryInit = {
            ...fetchInit,
            method,
            headers: {
              ...headers,
              Authorization: `Bearer ${SessionStore.accessToken}`
            }
          };
          response =
            (await fetchViaWebOsSupabaseProxy(url, retryInit)) || (await fetch(url, retryInit));
        }
      }

      if (!response.ok) {
        if (
          response.status === 401 &&
          includeSessionAuth &&
          (SessionStore.accessToken || SessionStore.refreshToken) &&
          !refreshFailedTransiently
        ) {
          await AuthManager.signOut();
        }
        const text = await response.text();
        const error = new Error(text);
        error.status = response.status;
        const retryAfter = response.headers?.get?.("retry-after");
        if (retryAfter) {
          const seconds = Number(retryAfter);
          const retryDate = Date.parse(retryAfter);
          if (Number.isFinite(seconds) && seconds > 0) {
            error.retryAfterMs = seconds * 1000;
          } else if (Number.isFinite(retryDate) && retryDate > Date.now()) {
            error.retryAfterMs = retryDate - Date.now();
          }
        }
        try {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed === "object") {
            if (typeof parsed.code === "string") {
              error.code = parsed.code;
            }
            if (typeof parsed.message === "string") {
              error.detail = parsed.message;
            }
          }
        } catch (_parseError) {
          // Keep raw response text in error.message when payload is not JSON.
        }
        throw error;
      }

      if (response.status === 204) {
        return null;
      }
      const responseType = String(requestedResponseType || "json")
        .trim()
        .toLowerCase();
      if (responseType === "response") {
        return response;
      }
      if (responseType === "blob") {
        return response.blob();
      }
      if (responseType === "arraybuffer" || responseType === "array_buffer") {
        return response.arrayBuffer();
      }
      if (responseType === "text") {
        return response.text();
      }
      const text = await response.text();
      const normalized = typeof text === "string" ? text.trim() : "";
      if (!normalized) {
        return null;
      }
      return JSON.parse(normalized);
    },
    timeoutMs,
    callerSignal
  );
}
