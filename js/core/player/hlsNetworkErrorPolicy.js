const TERMINAL_HLS_HTTP_STATUSES = new Set([400, 401, 403, 404, 410]);
const STREAM_EXPIRY_QUERY_KEYS = new Set([
  "expire",
  "expires",
  "expires_at",
  "expiresat",
  "expiration",
  "expiry"
]);
const MIN_EPOCH_TIMESTAMP_MS = Date.UTC(2000, 0, 1);

export function isTerminalHlsHttpStatus(statusCode = 0) {
  return TERMINAL_HLS_HTTP_STATUSES.has(Number(statusCode || 0));
}

export function getStreamUrlExpiryTimestampMs(streamUrl = "") {
  const value = String(streamUrl || "").trim();
  if (!value) {
    return 0;
  }

  try {
    const parsed = new URL(value);
    for (const [key, rawValue] of parsed.searchParams.entries()) {
      if (
        !STREAM_EXPIRY_QUERY_KEYS.has(
          String(key || "")
            .trim()
            .toLowerCase()
        )
      ) {
        continue;
      }
      const numericValue = Number(String(rawValue || "").trim());
      if (!Number.isFinite(numericValue) || numericValue <= 0) {
        continue;
      }
      const timestampMs = numericValue < 100000000000 ? numericValue * 1000 : numericValue;
      if (timestampMs >= MIN_EPOCH_TIMESTAMP_MS) {
        return timestampMs;
      }
    }
  } catch (_) {
    // Ignore non-URL stream locators and let the player resolve them normally.
  }

  return 0;
}

export function isExpiredStreamUrl(streamUrl = "", nowMs = Date.now()) {
  const expiryTimestampMs = getStreamUrlExpiryTimestampMs(streamUrl);
  return expiryTimestampMs > 0 && expiryTimestampMs <= Number(nowMs || Date.now());
}

export function isRecoverableHlsFragmentTimeout(diagnostic = null) {
  return Boolean(
    diagnostic &&
    diagnostic.fatal === false &&
    String(diagnostic.type || "")
      .trim()
      .toLowerCase() === "networkerror" &&
    String(diagnostic.details || "")
      .trim()
      .toLowerCase() === "fragloadtimeout" &&
    Number(diagnostic.responseCode || 0) === 0 &&
    Number(diagnostic.mediaErrorCode || 0) === 0
  );
}
