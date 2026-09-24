const SUBTITLE_STYLE_CONTROL_IDS = [
  "delay",
  "fontSize",
  "bold",
  "textColor",
  "textOpacity",
  "outlineEnabled",
  "outlineColor",
  "verticalOffset",
  "reset"
];
const ASS_STYLE_CONTROL_IDS = [
  "fontSize",
  "bold",
  "textColor",
  "textOpacity",
  "outlineEnabled",
  "outlineColor",
  "verticalOffset",
  "reset"
];

export function resolveSubtitleStyleControlAvailability({
  isTizenAvPlay = false,
  isWebOsNative = false,
  rendererMode = "none",
  supportsExternalDelay = false,
  preserveAssStyles = false
} = {}) {
  const availability = Object.fromEntries(
    SUBTITLE_STYLE_CONTROL_IDS.map((controlId) => [controlId, true])
  );
  if (preserveAssStyles) {
    ASS_STYLE_CONTROL_IDS.forEach((controlId) => {
      availability[controlId] = false;
    });
  }
  if (isWebOsNative && !["html", "html-callback"].includes(rendererMode)) {
    availability.textOpacity = false;
  }
  if (
    !isTizenAvPlay ||
    rendererMode === "html" ||
    rendererMode === "html-callback" ||
    rendererMode === "none"
  ) {
    return availability;
  }
  if (rendererMode === "embedded-native") {
    SUBTITLE_STYLE_CONTROL_IDS.forEach((controlId) => {
      availability[controlId] = false;
    });
    return availability;
  }
  if (rendererMode === "external-native") {
    SUBTITLE_STYLE_CONTROL_IDS.forEach((controlId) => {
      availability[controlId] = false;
    });
    availability.delay = Boolean(supportsExternalDelay);
    availability.reset = preserveAssStyles ? false : availability.delay;
  }
  return availability;
}
