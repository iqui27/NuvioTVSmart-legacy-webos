import { Environment } from "../../platform/environment.js";
import { Platform } from "../../platform/index.js";
import { SessionStore } from "../storage/sessionStore.js";
import { AuthManager } from "./authManager.js";
import { AuthState } from "./authState.js";
import { fetchSupabaseAuth } from "./supabaseAuthFetch.js";
import { ServerConfigurationStore } from "../../data/local/serverConfigurationStore.js";
import { supportsTvLogin } from "../../core/server/serverConfiguration.js";

let lastError = null;

function loginTrace(event, data) {
  try {
    globalThis.__NUVIO_TIZEN_LOGIN_TRACE__?.(event, data);
  } catch (_) {
    // Login diagnostics must never change the authentication flow.
  }
}

function hasQrAuthConfig() {
  return supportsTvLogin(ServerConfigurationStore.getActive());
}

function isJwtLike(token) {
  const value = String(token || "").trim();
  return value.split(".").length === 3;
}

function decodeJwtPayload(token) {
  try {
    const [, payload] = String(token || "").split(".");
    if (!payload) {
      return null;
    }
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function isJwtExpired(token, leewaySeconds = 30) {
  if (!isJwtLike(token)) {
    return true;
  }
  const payload = decodeJwtPayload(token);
  const exp = Number(payload?.exp || 0);
  if (!Number.isFinite(exp) || exp <= 0) {
    return false;
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  return exp <= nowSeconds + leewaySeconds;
}

function getBearerToken() {
  const token = SessionStore.accessToken;
  if (isJwtLike(token) && !isJwtExpired(token, 0)) {
    return token;
  }
  return ServerConfigurationStore.getActive()?.publishableKey || "";
}

function generateDeviceNonce() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(24);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  let binary = "";
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function resolveRedirectBaseUrl({ legacy = false } = {}) {
  const configuration = ServerConfigurationStore.getActive();
  const configuredUrl = legacy
    ? configuration.tvLoginWebBaseUrl
    : configuration.deviceLoginWebBaseUrl;
  if (configuredUrl) {
    return configuredUrl;
  }
  if (typeof window !== "undefined") {
    const protocol = String(window.location?.protocol || "");
    if (protocol === "http:" || protocol === "https:") {
      return window.location.origin;
    }
  }
  return "";
}

function toEpochMillis(session) {
  const rawExpiresAtMillis = session?.expires_at_millis ?? session?.expiresAtMillis;
  if (typeof rawExpiresAtMillis === "number") {
    return rawExpiresAtMillis;
  }
  const rawExpiresAt = session?.expires_at ?? session?.expiresAt;
  if (typeof rawExpiresAt === "number") {
    return rawExpiresAt > 10_000_000_000 ? rawExpiresAt : rawExpiresAt * 1000;
  }
  if (rawExpiresAt) {
    const parsed = Date.parse(rawExpiresAt);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return Date.now() + 5 * 60 * 1000;
}

function assertSessionGeneration(generation) {
  if (generation !== AuthManager.sessionGeneration) {
    throw new Error("Login was cancelled because the server changed");
  }
}

function isCallerSessionRejected(text) {
  const message = String(text || "").toLowerCase();
  return (
    message.includes("http 401") ||
    message.includes("invalid caller session") ||
    message.includes("jwt expired") ||
    message.includes("invalid jwt")
  );
}

async function parseErrorText(response) {
  const status = Number(response?.status || 0);
  try {
    const rawText = await response.text();
    const text = String(rawText || "").trim();
    if (!text) {
      return status ? `HTTP ${status}` : "Request failed";
    }

    try {
      const parsed = JSON.parse(text);
      const jsonMessage = [
        parsed?.msg,
        parsed?.message,
        parsed?.error_description,
        parsed?.error,
        parsed?.hint
      ].find((value) => typeof value === "string" && value.trim());
      if (jsonMessage) {
        return status ? `HTTP ${status}: ${jsonMessage.trim()}` : jsonMessage.trim();
      }
    } catch {
      // Ignore non-JSON payloads.
    }

    const strippedHtml = text
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!strippedHtml) {
      return status ? `HTTP ${status}` : "Request failed";
    }

    if (/<!doctype html>|<html[\s>]/i.test(text) && status) {
      return `HTTP ${status}: ${strippedHtml}`;
    }

    return status ? `HTTP ${status}: ${strippedHtml}` : strippedHtml;
  } catch {
    return status ? `HTTP ${status}` : "Request failed";
  }
}

function extractSessionTokens(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const accessToken =
    payload.access_token || payload.accessToken || payload?.session?.access_token || null;
  const refreshToken =
    payload.refresh_token || payload.refreshToken || payload?.session?.refresh_token || null;
  if (!accessToken || !refreshToken) {
    return null;
  }
  return { accessToken, refreshToken };
}

async function ensureQrSessionAuthenticated({
  forceNewAnonymous = false,
  expectedGeneration = AuthManager.sessionGeneration
} = {}) {
  assertSessionGeneration(expectedGeneration);
  if (forceNewAnonymous) {
    const wasAnonymous = SessionStore.isAnonymousSession;
    if (!wasAnonymous && SessionStore.refreshToken) {
      const refreshed = await AuthManager.refreshSessionIfNeeded({ force: true });
      assertSessionGeneration(expectedGeneration);
      if (refreshed && SessionStore.accessToken && !isJwtExpired(SessionStore.accessToken, 0)) {
        return true;
      }
      if (AuthManager.wasLastSessionRefreshTransientFailure?.()) {
        return true;
      }
    }
    SessionStore.accessToken = null;
    SessionStore.refreshToken = null;
    SessionStore.isAnonymousSession = false;
  }

  if (SessionStore.accessToken && !isJwtLike(SessionStore.accessToken)) {
    SessionStore.accessToken = null;
    SessionStore.refreshToken = null;
  }
  if (SessionStore.accessToken && !SessionStore.isAnonymousSession) {
    if (!isJwtExpired(SessionStore.accessToken)) {
      assertSessionGeneration(expectedGeneration);
      return true;
    }
    const refreshed = await AuthManager.refreshSessionIfNeeded();
    assertSessionGeneration(expectedGeneration);
    if (refreshed && SessionStore.accessToken && !isJwtExpired(SessionStore.accessToken)) {
      return true;
    }
    if (AuthManager.wasLastSessionRefreshTransientFailure?.()) {
      return true;
    }
    SessionStore.clear();
  }
  if (SessionStore.accessToken && SessionStore.isAnonymousSession) {
    if (!isJwtExpired(SessionStore.accessToken)) {
      assertSessionGeneration(expectedGeneration);
      return true;
    }
    SessionStore.accessToken = null;
    SessionStore.refreshToken = null;
    SessionStore.isAnonymousSession = false;
  }

  const publishableKey = ServerConfigurationStore.getActive()?.publishableKey || "";
  const commonHeaders = {
    "Content-Type": "application/json",
    apikey: publishableKey,
    Authorization: `Bearer ${publishableKey}`
  };

  const tryAnonymousSignup = async () => {
    const response = await fetchSupabaseAuth("/auth/v1/signup", {
      method: "POST",
      headers: commonHeaders,
      body: JSON.stringify({
        data: { tv_client: Platform.getName() }
      }),
      signal: AuthManager.getSessionSignal()
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(text || `HTTP ${response.status}`);
    }
    return text ? JSON.parse(text) : {};
  };

  const tryAnonymousToken = async () => {
    const response = await fetchSupabaseAuth("/auth/v1/token?grant_type=anonymous", {
      method: "POST",
      headers: commonHeaders,
      body: JSON.stringify({}),
      signal: AuthManager.getSessionSignal()
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(text || `HTTP ${response.status}`);
    }
    return text ? JSON.parse(text) : {};
  };

  let payload;
  try {
    payload = await tryAnonymousSignup();
  } catch (firstError) {
    payload = await tryAnonymousToken().catch((secondError) => {
      throw new Error(
        `${firstError?.message || "anonymous signup failed"} | ${secondError?.message || "anonymous token failed"}`
      );
    });
  }

  const tokens = extractSessionTokens(payload);
  if (!tokens) {
    throw new Error("Anonymous auth did not return session tokens");
  }

  SessionStore.accessToken = tokens.accessToken;
  SessionStore.refreshToken = tokens.refreshToken;
  SessionStore.isAnonymousSession = true;
  assertSessionGeneration(expectedGeneration);
  return true;
}

async function fetchWithCallerSessionRecovery(
  requestFactory,
  expectedGeneration = AuthManager.sessionGeneration
) {
  await ensureQrSessionAuthenticated({ expectedGeneration });
  let response = await requestFactory();
  assertSessionGeneration(expectedGeneration);
  if (response.ok || response.status !== 401) {
    return response;
  }

  const firstErrorText = await parseErrorText(response);
  if (!isCallerSessionRejected(firstErrorText)) {
    throw new Error(firstErrorText || `HTTP ${response.status}`);
  }

  await ensureQrSessionAuthenticated({ forceNewAnonymous: true, expectedGeneration });
  const retryResponse = await requestFactory();
  assertSessionGeneration(expectedGeneration);
  return retryResponse;
}

async function startRpc(deviceNonce, redirectBaseUrl, legacyRedirectBaseUrl, expectedGeneration) {
  assertSessionGeneration(expectedGeneration);
  await ensureQrSessionAuthenticated({ expectedGeneration });
  const session = await AuthManager.startDeviceLoginSession(
    deviceNonce,
    Environment.getDeviceLabel(),
    "tv",
    redirectBaseUrl,
    legacyRedirectBaseUrl
  );
  assertSessionGeneration(expectedGeneration);
  return session;
}

export const QrLoginService = {
  getLastError() {
    return lastError;
  },

  async start() {
    lastError = null;
    loginTrace("qr start begin");
    try {
      const expectedGeneration = AuthManager.sessionGeneration;
      if (!hasQrAuthConfig()) {
        throw new Error("QR auth is not configured");
      }
      await ensureQrSessionAuthenticated({ expectedGeneration });
      const deviceNonce = generateDeviceNonce();
      const redirectBaseUrl = resolveRedirectBaseUrl();
      const legacyRedirectBaseUrl = resolveRedirectBaseUrl({ legacy: true }) || redirectBaseUrl;
      if (!redirectBaseUrl) {
        throw new Error("Missing redirect_base_url configuration");
      }

      const session = await startRpc(
        deviceNonce,
        redirectBaseUrl,
        legacyRedirectBaseUrl,
        expectedGeneration
      );
      if (!session) {
        throw new Error("Empty response from start_device_login_session");
      }

      const code = String(session.deviceCode || "").trim();
      const displayCode = String(session.userCode || "").trim();
      const loginUrl = session.verificationUriComplete || null;
      if (!code || !displayCode || !loginUrl) {
        throw new Error("Incomplete response from device login session");
      }
      const result = {
        code,
        displayCode,
        loginUrl,
        verificationUri: session.verificationUri || null,
        expiresAt: toEpochMillis(session),
        pollIntervalSeconds: Number(
          session.pollIntervalSeconds || session.poll_interval_seconds || 3
        ),
        deviceNonce,
        legacy: session.legacy === true
      };
      loginTrace("qr start success", {
        pollIntervalSeconds: result.pollIntervalSeconds,
        hasQrContent: Boolean(result.loginUrl)
      });
      return result;
    } catch (error) {
      lastError = String(error?.message || "QR start failed");
      loginTrace("qr start failed", { name: error?.name || "Error" });
      console.error("QR start error:", error);
      return null;
    }
  },

  async poll(code, deviceNonce) {
    lastError = null;
    try {
      const expectedGeneration = AuthManager.sessionGeneration;
      if (!hasQrAuthConfig()) {
        lastError = "QR auth is not configured";
        return null;
      }
      const response = await fetchWithCallerSessionRecovery(
        () =>
          fetchSupabaseAuth("/rest/v1/rpc/poll_tv_login_session", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: ServerConfigurationStore.getActive()?.publishableKey || "",
              Authorization: `Bearer ${getBearerToken()}`
            },
            body: JSON.stringify({
              p_code: code,
              p_device_nonce: deviceNonce
            }),
            signal: AuthManager.getSessionSignal()
          }),
        expectedGeneration
      );

      if (!response.ok) {
        lastError = await parseErrorText(response);
        return null;
      }

      const data = await response.json();
      assertSessionGeneration(expectedGeneration);
      const row = data?.[0] || {};
      const status = row.status || null;
      const rawPollInterval = Number(
        row.poll_interval_seconds ?? row.pollIntervalSeconds ?? Number.NaN
      );
      const pollIntervalSeconds =
        Number.isFinite(rawPollInterval) && rawPollInterval > 0 ? rawPollInterval : null;
      const result = {
        status,
        expiresAt: row.expires_at ?? row.expiresAt ?? null,
        pollIntervalSeconds
      };
      loginTrace("qr poll parsed", {
        status: status || "empty",
        pollIntervalSeconds: pollIntervalSeconds || "-",
        hasExpiresAt: Boolean(result.expiresAt)
      });
      return result;
    } catch (error) {
      lastError = String(error?.message || "QR poll failed");
      loginTrace("qr poll failed", { name: error?.name || "Error" });
      console.error("QR poll error:", error);
      return null;
    }
  },

  async exchange(code, deviceNonce) {
    lastError = null;
    loginTrace("qr exchange begin");
    try {
      const expectedGeneration = AuthManager.sessionGeneration;
      if (!hasQrAuthConfig()) {
        lastError = "QR auth is not configured";
        return false;
      }
      const response = await fetchWithCallerSessionRecovery(
        () =>
          fetchSupabaseAuth("/functions/v1/tv-logins-exchange", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: ServerConfigurationStore.getActive()?.publishableKey || "",
              Authorization: `Bearer ${getBearerToken()}`
            },
            body: JSON.stringify({
              code,
              device_nonce: deviceNonce
            }),
            signal: AuthManager.getSessionSignal()
          }),
        expectedGeneration
      );

      if (!response.ok) {
        lastError = await parseErrorText(response);
        console.error("Exchange failed", lastError);
        return false;
      }

      const result = await response.json();
      const tokens = extractSessionTokens(result) || {
        accessToken: result?.access_token || null,
        refreshToken: result?.refresh_token || null
      };
      if (!tokens?.accessToken || !tokens?.refreshToken) {
        lastError = "QR exchange missing session tokens";
        loginTrace("qr exchange missing tokens");
        return false;
      }
      assertSessionGeneration(expectedGeneration);
      SessionStore.accessToken = tokens.accessToken;
      SessionStore.refreshToken = tokens.refreshToken;
      SessionStore.isAnonymousSession = false;
      loginTrace("qr exchange session ready");
      AuthManager.setState(AuthState.AUTHENTICATED);
      loginTrace("qr exchange authenticated");
      return result;
    } catch (error) {
      lastError = String(error?.message || "QR exchange failed");
      loginTrace("qr exchange failed", { name: error?.name || "Error" });
      console.error("QR exchange error:", error);
      return false;
    }
  },

  cleanup() {
    // no-op: timers are owned by screen
  }
};
