export function parseEpisodeRuntimeMinutes(value) {
  if (value == null || value === "") {
    return 0;
  }

  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && numericValue > 0) {
    return numericValue;
  }

  const normalized = String(value).trim().toLowerCase();
  const hourMatch = normalized.match(/(\d+(?:\.\d+)?)\s*h/);
  const minuteMatch = normalized.match(/(\d+)\s*m(?:in)?/);
  if (hourMatch || minuteMatch) {
    const hours = hourMatch ? Number(hourMatch[1]) : 0;
    const minutes = minuteMatch ? Number(minuteMatch[1]) : 0;
    return Math.round(hours * 60 + minutes);
  }

  const digits = normalized.replace(/\D/g, "");
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatDurationMinutes(totalMinutes) {
  const minutesValue = Number(totalMinutes || 0);
  if (!Number.isFinite(minutesValue) || minutesValue <= 0) {
    return "";
  }
  const roundedMinutes = Math.max(0, Math.round(minutesValue));
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

export function formatHeroRuntime(runtime) {
  const raw = String(runtime ?? "").trim();
  if (!raw) {
    return "";
  }

  const normalized = raw.toLowerCase();
  if (normalized.includes(":")) {
    const [hoursValue, minutesValue] = normalized.split(":");
    const hours = Number(hoursValue);
    const minutes = Number(minutesValue);
    if (Number.isFinite(hours) && Number.isFinite(minutes)) {
      const totalMinutes = hours * 60 + minutes;
      return totalMinutes > 0 ? formatDurationMinutes(totalMinutes) : "";
    }
  }

  const parsedMinutes = parseEpisodeRuntimeMinutes(normalized);
  if (parsedMinutes > 0) {
    return formatDurationMinutes(parsedMinutes);
  }

  // Keep genuinely textual provider values visible, but never render a numeric
  // zero as a real runtime. TMDB uses 0 to mean that the duration is unknown.
  return /\d/.test(raw) ? "" : raw;
}

export function normalizeEpisodeImdbRating(value) {
  const rating = Number(value);
  return Number.isFinite(rating) && rating > 0 ? rating : null;
}
