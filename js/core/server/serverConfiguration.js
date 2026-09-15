function normalizeUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}

export function parseServerUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (!parsed.hostname) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

export function isPrivateHostname(hostname = "") {
  const host = String(hostname)
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host === "::1") return true;
  if (host.startsWith("127.")) return true;
  if (host.startsWith("10.")) return true;
  if (host.startsWith("192.168.")) return true;

  const parts = host.split(".");
  if (parts.length === 4) {
    const first = Number.parseInt(parts[0], 10);
    const second = Number.parseInt(parts[1], 10);
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 169 && second === 254) return true;
  }
  return false;
}

export function isSecureUrl(value) {
  return parseServerUrl(value)?.protocol === "https:";
}

export function isPublicHost(value) {
  const parsed = parseServerUrl(value);
  return Boolean(parsed && !isPrivateHostname(parsed.hostname));
}

export function normalizeBackendUrl(value) {
  const normalized = normalizeUrl(value);
  const parsed = parseServerUrl(normalized);
  if (!parsed) return "";
  return parsed.toString().replace(/\/+$/, "");
}

export function normalizeDiscoveryBaseUrl(value) {
  const normalized = normalizeUrl(value);
  const parsed = parseServerUrl(normalized);
  if (!parsed) return "";
  return parsed.toString().replace(/\/+$/, "");
}

export function sameServer(left, right) {
  const a = parseServerUrl(left);
  const b = parseServerUrl(right);
  const effectivePort = (url) => Number(url?.port || (url?.protocol === "https:" ? 443 : 80));
  return Boolean(
    a &&
    b &&
    a.hostname.toLowerCase() === b.hostname.toLowerCase() &&
    effectivePort(a) === effectivePort(b)
  );
}

export function createServerConfiguration({
  backendUrl,
  publishableKey,
  capabilities,
  isCustom,
  discoveryUrl = "",
  fallbackBackendUrl = "",
  tvLoginWebBaseUrl = "",
  deviceLoginWebBaseUrl = "",
  avatarPublicBaseUrl = ""
}) {
  const normalizedBackendUrl = isCustom
    ? normalizeBackendUrl(backendUrl)
    : normalizeUrl(backendUrl);
  const normalizedKey = String(publishableKey || "").trim();
  const normalizedCapabilities = {
    emailPasswordAuth: capabilities?.emailPasswordAuth === true,
    tvLogin: capabilities?.tvLogin === true
  };
  if (
    isCustom &&
    (!normalizedBackendUrl ||
      !normalizedKey ||
      (!normalizedCapabilities.emailPasswordAuth && !normalizedCapabilities.tvLogin))
  ) {
    return null;
  }

  const normalizedDiscoveryUrl = isCustom
    ? normalizeDiscoveryBaseUrl(discoveryUrl) || `${normalizedBackendUrl}/.well-known/nuvio`
    : "";
  const normalizedTvLoginWebBaseUrl = isCustom
    ? `${normalizedBackendUrl}/tv-login`
    : normalizeUrl(tvLoginWebBaseUrl);
  const normalizedDeviceLoginWebBaseUrl = isCustom
    ? `${normalizedBackendUrl}/link`
    : normalizeUrl(deviceLoginWebBaseUrl || tvLoginWebBaseUrl);

  return Object.freeze({
    backendUrl: normalizedBackendUrl,
    publishableKey: normalizedKey,
    capabilities: Object.freeze(normalizedCapabilities),
    isCustom: Boolean(isCustom),
    discoveryUrl: normalizedDiscoveryUrl,
    fallbackBackendUrl: isCustom ? "" : normalizeUrl(fallbackBackendUrl),
    tvLoginWebBaseUrl: normalizedTvLoginWebBaseUrl,
    deviceLoginWebBaseUrl: normalizedDeviceLoginWebBaseUrl,
    avatarPublicBaseUrl:
      (isCustom ? "" : normalizeUrl(avatarPublicBaseUrl)) ||
      (normalizedBackendUrl ? `${normalizedBackendUrl}/storage/v1/object/public/avatars` : ""),
    isSecure: isSecureUrl(normalizedBackendUrl),
    isPublicHost: isPublicHost(normalizedBackendUrl)
  });
}

export function supportsTvLogin(configuration) {
  return Boolean(
    configuration?.backendUrl &&
    configuration?.publishableKey &&
    configuration?.capabilities?.tvLogin
  );
}

export function supportsEmailPasswordAuth(configuration) {
  return Boolean(configuration?.capabilities?.emailPasswordAuth);
}
