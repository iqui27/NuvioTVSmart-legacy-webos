import { SUPABASE_URL } from "../../config.js";
import { withRequestTimeout } from "../network/requestTimeout.js";
import {
  createServerConfiguration,
  normalizeBackendUrl,
  sameServer
} from "./serverConfiguration.js";

export const MAX_DISCOVERY_DOCUMENT_BYTES = 64 * 1024;
const DISCOVERY_SUFFIX = "/.well-known/nuvio";

function serverError(code, details = {}) {
  return Object.assign(new Error(code), { code, ...details });
}

export function normalizeDiscoveryUrl(input) {
  const normalized = String(input || "").trim();
  if (!normalized) throw serverError("invalid_url");
  const candidate = normalized.includes("://") ? normalized : `https://${normalized}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch (_) {
    throw serverError("invalid_url");
  }
  if (
    !parsed.hostname ||
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  ) {
    throw serverError("invalid_url");
  }
  const basePath = parsed.pathname.replace(/\/\.well-known\/nuvio\/?$/, "").replace(/\/+$/, "");
  parsed.pathname = `${basePath}${DISCOVERY_SUFFIX}`;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function utf8ByteLength(value) {
  return typeof TextEncoder === "function"
    ? new TextEncoder().encode(value).byteLength
    : unescape(encodeURIComponent(value)).length;
}

export function parseDiscoveryDocument(discoveryUrl, source) {
  let payload;
  try {
    payload = JSON.parse(String(source || ""));
  } catch (error) {
    throw serverError("invalid_document", { cause: error });
  }
  if (payload?.version !== 1) throw serverError("unsupported_version");
  if (String(payload?.service || "").toLowerCase() !== "nuvio") {
    throw serverError("wrong_service");
  }
  if (payload?.self_hosted !== true) throw serverError("not_self_hosted");

  const backendUrl = normalizeBackendUrl(payload?.backend_url);
  if (!backendUrl) throw serverError("missing_configuration");
  const publishableKey = String(payload?.publishable_key || "").trim();
  if (!publishableKey) throw serverError("missing_configuration");

  const capabilities = {
    emailPasswordAuth: payload?.capabilities?.email_password_auth === true,
    tvLogin: payload?.capabilities?.tv_login === true
  };
  if (!capabilities.emailPasswordAuth && !capabilities.tvLogin) {
    throw serverError("no_supported_auth");
  }

  return createServerConfiguration({
    backendUrl,
    publishableKey,
    capabilities,
    isCustom: true,
    discoveryUrl
  });
}

async function readLimitedText(response) {
  const contentLength = Number(response.headers?.get?.("content-length") || 0);
  if (contentLength > MAX_DISCOVERY_DOCUMENT_BYTES) throw serverError("response_too_large");

  if (!response.body?.getReader) {
    const text = await response.text();
    if (utf8ByteLength(text) > MAX_DISCOVERY_DOCUMENT_BYTES) {
      throw serverError("response_too_large");
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_DISCOVERY_DOCUMENT_BYTES) {
      await reader.cancel();
      throw serverError("response_too_large");
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(size);
  let offset = 0;
  chunks.forEach((chunk) => {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  });
  if (typeof TextDecoder === "function") return new TextDecoder().decode(combined);
  let binary = "";
  combined.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return decodeURIComponent(escape(binary));
}

export async function discoverServer(
  input,
  { fetchImpl = globalThis.fetch, signal, timeoutMs = 15_000 } = {}
) {
  const discoveryUrl = normalizeDiscoveryUrl(input);
  if (sameServer(discoveryUrl, SUPABASE_URL)) throw serverError("official_server");
  try {
    return await withRequestTimeout(
      async (requestSignal) => {
        const response = await fetchImpl(discoveryUrl, {
          method: "GET",
          headers: { Accept: "application/json" },
          ...(requestSignal ? { signal: requestSignal } : {})
        });
        if (!response?.ok) {
          throw serverError("http_error", { statusCode: Number(response?.status || 0) });
        }
        const responseUrl = new URL(response.url || discoveryUrl);
        if (new URL(discoveryUrl).protocol === "https:" && responseUrl.protocol !== "https:") {
          throw serverError("connection_failed");
        }
        return parseDiscoveryDocument(discoveryUrl, await readLimitedText(response));
      },
      Math.max(1, Number(timeoutMs) || 15_000),
      signal
    );
  } catch (error) {
    if (error?.code === "REQUEST_TIMEOUT") {
      throw serverError("connection_failed", { cause: error });
    }
    if (error?.code) throw error;
    throw serverError("connection_failed", { cause: error });
  }
}
