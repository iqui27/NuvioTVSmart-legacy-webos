const CONTROL_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "proxy-authorization",
  "proxy-authenticate",
  "range",
  "set-cookie",
  "transfer-encoding"
]);

const CROSS_ORIGIN_STREAM_HEADERS = new Set(["accept-language", "origin", "referer", "user-agent"]);

const DOWNGRADE_UNSAFE_HEADERS = new Set([
  "authorization",
  "origin",
  "referer",
  "www-authenticate"
]);

function toHeaderEntries(headers) {
  if (!headers) {
    return [];
  }
  if (typeof headers.entries === "function") {
    return Array.from(headers.entries());
  }
  if (typeof headers === "object") {
    return Object.entries(headers);
  }
  return [];
}

function parseHttpUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch (_) {
    return null;
  }
}

function isHttpsDowngrade(fromUrl, toUrl) {
  return fromUrl?.protocol === "https:" && toUrl?.protocol === "http:";
}

function isForbiddenHeader(name) {
  const normalized = String(name || "")
    .trim()
    .toLowerCase();
  return (
    !normalized ||
    CONTROL_HEADERS.has(normalized) ||
    normalized === "cookie" ||
    normalized.startsWith("access-control-") ||
    normalized.startsWith("proxy-") ||
    normalized.startsWith("sec-")
  );
}

function filterHeaders(headers, { allowList = null, downgrade = false } = {}) {
  const filtered = {};
  toHeaderEntries(headers).forEach(([rawName, rawValue]) => {
    const name = String(rawName || "")
      .trim()
      .toLowerCase();
    const value = String(rawValue ?? "").trim();
    if (
      isForbiddenHeader(name) ||
      !value ||
      (allowList && !allowList.has(name)) ||
      (downgrade && DOWNGRADE_UNSAFE_HEADERS.has(name))
    ) {
      return;
    }
    filtered[name] = value;
  });
  return filtered;
}

function mergeHeaders(...headerMaps) {
  return Object.assign(
    {},
    ...headerMaps.filter((headers) => headers && typeof headers === "object")
  );
}

/**
 * Scope stream and subtitle-owned headers to the URL that will receive them.
 *
 * Stream headers may cross hosts only through the small Android-compatible
 * safe list. Subtitle-owned headers are kept on the original subtitle origin
 * and are never forwarded to a redirect target on another origin.
 */
export function buildSubtitleRequestHeaders(
  subtitleUrl,
  {
    streamUrl = "",
    streamHeaders = {},
    subtitleHeaders = {},
    originalSubtitleUrl = subtitleUrl
  } = {}
) {
  const target = parseHttpUrl(subtitleUrl);
  const stream = parseHttpUrl(streamUrl);
  const originalSubtitle = parseHttpUrl(originalSubtitleUrl);
  if (!target) {
    return {};
  }

  const streamSameHost = Boolean(stream && stream.host.toLowerCase() === target.host.toLowerCase());
  const streamDowngrade = isHttpsDowngrade(stream, target);
  const scopedStreamHeaders = streamSameHost
    ? filterHeaders(streamHeaders, { downgrade: streamDowngrade })
    : filterHeaders(streamHeaders, {
        allowList: CROSS_ORIGIN_STREAM_HEADERS,
        downgrade: streamDowngrade
      });

  const subtitleSameOrigin = Boolean(
    originalSubtitle && originalSubtitle.origin.toLowerCase() === target.origin.toLowerCase()
  );
  const subtitleDowngrade = isHttpsDowngrade(originalSubtitle, target);
  const scopedSubtitleHeaders = subtitleSameOrigin
    ? filterHeaders(subtitleHeaders, { downgrade: subtitleDowngrade })
    : {};

  return mergeHeaders(scopedStreamHeaders, scopedSubtitleHeaders);
}

export function isSubtitleHeaderForwardingSameOrigin(sourceUrl, targetUrl) {
  const source = parseHttpUrl(sourceUrl);
  const target = parseHttpUrl(targetUrl);
  return Boolean(source && target && source.origin.toLowerCase() === target.origin.toLowerCase());
}
