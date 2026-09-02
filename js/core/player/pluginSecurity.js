export function validatePluginUrl(value, { allowPathOnly = false } = {}) {
  const raw = String(value || "").trim();
  if (!raw) {
    return { ok: false, reason: "URL is empty" };
  }
  try {
    const parsed = new URL(raw);
    if (!allowPathOnly && !["http:", "https:"].includes(parsed.protocol)) {
      return { ok: false, reason: "Only HTTP(S) URLs are allowed" };
    }
    return { ok: true, url: parsed.toString(), parsed };
  } catch (_) {
    return { ok: false, reason: "Invalid URL" };
  }
}

export function normalizePluginHeaders(headers = {}, { addDefaultUserAgent = true } = {}) {
  const result = {};
  Object.entries(headers || {}).forEach(([key, value]) => {
    const name = String(key || "");
    if (!name || value == null || name.toLowerCase() === "accept-encoding") return;
    result[name] = String(value);
  });
  if (addDefaultUserAgent && !Object.prototype.hasOwnProperty.call(result, "User-Agent")) {
    result["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
  }
  return result;
}

export function normalizePluginHttpMethod(method) {
  const normalized = String(method || "GET").toUpperCase();
  return ["POST", "PUT", "DELETE"].includes(normalized) ? normalized : "GET";
}

export function validatePluginFetchRequest(
  { url, method = "GET", headers = {}, body = "" } = {},
  limits = {}
) {
  const urlResult = validatePluginUrl(url);
  if (!urlResult.ok) {
    return urlResult;
  }
  const maxBodyBytes = Number(limits.maxBodyBytes || 1024 * 1024);
  const bodyText = typeof body === "string" ? body : "";
  const bodyBytes =
    typeof TextEncoder === "function"
      ? new TextEncoder().encode(bodyText).byteLength
      : unescape(encodeURIComponent(bodyText)).length;
  if (bodyBytes > maxBodyBytes) {
    return { ok: false, reason: "Request body exceeds the plugin quota" };
  }
  const normalizedMethod = normalizePluginHttpMethod(method);
  const normalizedHeaders = normalizePluginHeaders(headers, limits);
  if (!Object.keys(normalizedHeaders).some((key) => key.toLowerCase() === "content-type")) {
    if (normalizedMethod === "POST")
      normalizedHeaders["Content-Type"] = "application/x-www-form-urlencoded";
    if (normalizedMethod === "PUT") normalizedHeaders["Content-Type"] = "application/json";
  }
  return {
    ok: true,
    url: urlResult.url,
    method: normalizedMethod,
    headers: normalizedHeaders,
    body: bodyText
  };
}
