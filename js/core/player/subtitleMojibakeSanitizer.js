/**
 * Sanitizes common character encoding artifacts where UTF-8 subtitle text was interpreted as
 * Windows-1252 or ISO-8859-1 text (for example, a garbled music note instead of a real one).
 */

// Longer patterns must precede their shorter fallback prefixes. Patterns use explicit code point
// escapes because several contain invisible C1 control bytes and non-breaking spaces.
const REPLACEMENTS = [
  ["\u00e2\u2122\u00aa", "\u266a"], // â™ª -> ♪
  ["\u00e2\u2122\u00ab", "\u266b"], // â™« -> ♫
  ["\u00e2\u20ac\u2122", "\u2019"], // â€™ -> ’
  ["\u00e2\u20ac\u02dc", "\u2018"], // â€˜ -> ‘
  ["\u00e2\u20ac\u0153", "\u201c"], // â€œ -> “
  ["\u00e2\u20ac\u009d", "\u201d"], // â€· -> ”
  ["\u00e2\u20ac\u009c", "\u201c"], // â€· -> “
  ["\u00e2\u20ac\u0098", "\u2018"], // â€· -> ‘
  ["\u00e2\u20ac\u0099", "\u2019"], // â€· -> ’
  ["\u00e2\u20ac\u201c", "\u2013"], // â€“ -> –
  ["\u00e2\u20ac\u201d", "\u2014"], // â€” -> —
  ["\u00e2\u20ac\u00a6", "\u2026"], // â€¦ -> …
  ["\u00c2\u00a0", " "], // Â␣ -> ␠
  ["\u00c2\u00bf", "\u00bf"], // Â¿ -> ¿
  ["\u00c2\u00a1", "\u00a1"], // Â¡ -> ¡
  ["\u00c2\u00ab", "\u00ab"], // Â« -> «
  ["\u00c2\u00bb", "\u00bb"], // Â» -> »
  ["\u00c2 ", " "], // Â␠ -> ␠
  ["\u00e2\u2122", "\u266a"], // â™ -> ♪
  ["\u00e2\u20ac", "\u201d"], // â€ -> ”
  ["\ufffd", ""] // � -> (removed)
];

function hasPotentialMojibake(text) {
  for (let index = 0; index < text.length; index++) {
    const ch = text[index];
    if (ch === "\u00e2" || ch === "\u00c2" || ch === "\ufffd") {
      return true;
    }
  }
  return false;
}

/**
 * Returns the text with known mojibake sequences repaired. Text without any of the telltale
 * marker characters is returned unchanged.
 */
export function sanitizeSubtitleMojibake(text) {
  if (typeof text !== "string" || !hasPotentialMojibake(text)) {
    return text;
  }
  let sanitized = text;
  for (const [pattern, replacement] of REPLACEMENTS) {
    if (sanitized.includes(pattern)) {
      sanitized = sanitized.split(pattern).join(replacement);
    }
  }
  return sanitized;
}
