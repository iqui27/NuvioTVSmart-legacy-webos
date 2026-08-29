/**
 * Normalizes a Trakt token lifetime in seconds. An older build forced every token to a one day
 * lifetime, so a stored value of exactly 86400 is migrated to the documented Trakt lifetime of
 * seven days. Every other value is kept as is, including the real lifetime Trakt returns and any
 * invalid value like 0 or a negative number, which is left untouched so the token refreshes right
 * away. This matches the Android app.
 */

const TRAKT_LEGACY_FORCED_TOKEN_LIFETIME_SECONDS = 86400;
const TRAKT_DOCUMENTED_TOKEN_LIFETIME_SECONDS = 604800;

export function normalizeTraktTokenLifetimeSeconds(expiresIn) {
  const seconds = Math.trunc(Number(expiresIn));
  if (!Number.isFinite(seconds)) {
    return 0;
  }
  return seconds === TRAKT_LEGACY_FORCED_TOKEN_LIFETIME_SECONDS
    ? TRAKT_DOCUMENTED_TOKEN_LIFETIME_SECONDS
    : seconds;
}
