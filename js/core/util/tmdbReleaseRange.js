// Formats a TV show's release info the same way the Android app does.
// Ported from Android TmdbMetadataService.buildShowYearRange and yearPart so the
// web shows "2012-" for an ongoing show and "2012-2019" for one that has ended,
// instead of only the first air year.

export function tmdbYearPart(value) {
  const trimmed = String(value == null ? "" : value).trim();
  if (trimmed.length < 4) return null;
  const year = trimmed.slice(0, 4);
  return /^\d{4}$/.test(year) ? year : null;
}

export function buildShowYearRange(startYear, endYear, status) {
  const isEnded = status != null && status !== "Returning Series" && status !== "In Production";
  if (isEnded && endYear != null && endYear !== startYear) {
    return `${startYear}-${endYear}`;
  }
  if (isEnded) {
    return startYear;
  }
  return `${startYear}-`;
}

export function tmdbShowReleaseInfo(firstAirDate, lastAirDate, status) {
  const startYear = tmdbYearPart(firstAirDate);
  if (startYear == null) return null;
  const normalizedStatus =
    typeof status === "string" && status.trim() !== "" ? status.trim() : null;
  return buildShowYearRange(startYear, tmdbYearPart(lastAirDate), normalizedStatus);
}
