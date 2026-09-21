const LANGUAGE_CODE_ALIASES = Object.freeze({
  id: "id",
  in: "id",
  ind: "id",
  ms: "ms",
  may: "ms",
  msa: "ms"
});

function normalizeLanguageText(value) {
  const text = String(value || "")
    .trim()
    .toLowerCase();
  const withoutAccents =
    typeof text.normalize === "function"
      ? text.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      : text;
  return withoutAccents
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasWholeWord(text, value) {
  return ` ${text} `.includes(` ${value} `);
}

/**
 * Resolve subtitle-only language aliases without changing the broader audio
 * track language mapping. Human-readable labels take precedence over an
 * ambiguous Malay/Malaysian technical code when they explicitly say
 * Indonesian.
 */
export function normalizeSubtitleLanguageAlias(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  const text = normalizeLanguageText(raw);
  if (
    hasWholeWord(text, "bahasa indonesia") ||
    hasWholeWord(text, "indonesia") ||
    hasWholeWord(text, "indonesian")
  ) {
    return "id";
  }
  if (
    hasWholeWord(text, "bahasa malaysia") ||
    hasWholeWord(text, "bahasa melayu") ||
    hasWholeWord(text, "malay") ||
    hasWholeWord(text, "malaysian")
  ) {
    return "ms";
  }

  const codeMatch = raw.match(/^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})*$/i);
  if (!codeMatch) {
    return "";
  }
  const baseCode = codeMatch[0].split(/[-_]/)[0].toLowerCase();
  return LANGUAGE_CODE_ALIASES[baseCode] || "";
}
