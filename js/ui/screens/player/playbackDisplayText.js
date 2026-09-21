export function normalizePlaybackDisplayLineBreaks(value = "") {
  return String(value ?? "").replace(/\\r\\n|\\n|\\r/g, "\n");
}

export function formatPlaybackSourceName(value = "") {
  return normalizePlaybackDisplayLineBreaks(value)
    .replace(/\r\n|\r|\n/g, " · ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolvePlaybackSourceName(stream = {}) {
  if (stream?.isSynthetic) {
    return "";
  }

  return (
    formatPlaybackSourceName(stream?.name) ||
    formatPlaybackSourceName(stream?.addonName).replace(/^Addon$/i, "")
  );
}
