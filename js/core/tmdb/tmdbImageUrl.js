const TMDB_IMAGE_HOST_PATTERN = /^(?:https?:)?\/\/image\.tmdb\.org\//i;

/**
 * Upgrade the legacy TMDB backdrop size used by cached/addon metadata.
 * Keep unrelated artwork URLs byte-for-byte unchanged.
 */
export function normalizeTmdbBackdropUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized || !TMDB_IMAGE_HOST_PATTERN.test(normalized)) {
    return normalized;
  }
  return normalized.replace(/(\/t\/p\/)w780\//i, "$1w1280/");
}
