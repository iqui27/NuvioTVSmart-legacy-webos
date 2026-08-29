/**
 * Classifies a debrid stream resolution from its metadata fields.
 *
 * The Android app checks the resolution fields in priority order (parsed
 * resolution, then parsed quality, then the addon quality, then the free text)
 * and takes the first field that yields a resolution. The web app instead
 * joined every field into one string and took the highest token found anywhere,
 * so a correctly parsed 1080p file whose title mentions a 4K remaster or a
 * 2160p pack was classified as 4K. That wrong resolution then filtered and
 * sorted the stream as 4K. `resolutionFromFields` restores the Android field
 * priority so the parsed resolution wins over noise in the title.
 */

export function resolutionFromText(text = "") {
  if (/\b(2160p?|4k|uhd)\b/i.test(text)) return "P2160";
  if (/\b(1440p?|2k)\b/i.test(text)) return "P1440";
  if (/\b(1080p?|fhd)\b/i.test(text)) return "P1080";
  if (/\b(720p?|hd)\b/i.test(text)) return "P720";
  if (/\b576p?\b/i.test(text)) return "P576";
  if (/\b(480p?|sd)\b/i.test(text)) return "P480";
  if (/\b360p?\b/i.test(text)) return "P360";
  return "UNKNOWN";
}

export function resolutionFromFields(values = []) {
  for (const value of values) {
    if (!value) continue;
    const resolution = resolutionFromText(value);
    if (resolution !== "UNKNOWN") {
      return resolution;
    }
  }
  return "UNKNOWN";
}
