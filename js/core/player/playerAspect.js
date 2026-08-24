/**
 * `objectFit` here is read ONLY on webOS. Every other platform forces
 * `object-fit: fill` and produces the mode with `transform: scale()` — see
 * applyAspectMode in playerScreen.js, where `canTransformVideo` is false for
 * webOS precisely because that path is unavailable there.
 *
 * Which is why six of the seven modes used to be `contain`: on this TV that made
 * Fit, Crop, Slight Zoom, Cinema Zoom, Fit Height and Fit Width render
 * identically, and picking "Crop" did nothing about a letterboxed source.
 *
 * The webOS-reachable set is what object-fit itself offers — contain, cover,
 * fill. The DEGREE of zoom cannot be expressed: transform is out, and resizing
 * the video element is out too, because webOS only suppresses its screensaver
 * while that element covers the whole viewport. So the zoom modes map to the
 * nearest honest behaviour (crop to fill) rather than to nothing at all.
 */
export const ASPECT_MODE_IDS = Object.freeze([
  "ORIGINAL",
  "FULL_SCREEN",
  "STRETCH",
  "SLIGHT_ZOOM",
  "CINEMA_ZOOM",
  "VERTICAL_STRETCH",
  "HORIZONTAL_STRETCH"
]);

export const DEFAULT_ASPECT_MODE = "ORIGINAL";

export const ASPECT_MODE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "ORIGINAL",
    labelKey: "player_aspect_fit",
    fallbackLabel: "Fit (Original)",
    objectFit: "contain"
  }),
  Object.freeze({
    id: "FULL_SCREEN",
    labelKey: "player_aspect_crop",
    fallbackLabel: "Crop",
    objectFit: "cover"
  }),
  Object.freeze({
    id: "STRETCH",
    labelKey: "player_aspect_stretch",
    fallbackLabel: "Stretch",
    objectFit: "fill"
  }),
  Object.freeze({
    id: "SLIGHT_ZOOM",
    labelKey: "player_aspect_mode_slight_zoom",
    fallbackLabel: "Slight Zoom",
    objectFit: "cover"
  }),
  Object.freeze({
    id: "CINEMA_ZOOM",
    labelKey: "player_aspect_mode_cinema_zoom",
    fallbackLabel: "Cinema Zoom",
    objectFit: "cover"
  }),
  Object.freeze({
    id: "VERTICAL_STRETCH",
    labelKey: "player_aspect_fit_height",
    fallbackLabel: "Fit Height",
    objectFit: "cover"
  }),
  Object.freeze({
    id: "HORIZONTAL_STRETCH",
    labelKey: "player_aspect_fit_width",
    fallbackLabel: "Fit Width",
    objectFit: "contain"
  })
]);

const LEGACY_OBJECT_FIT_MODES = Object.freeze({
  contain: "ORIGINAL",
  cover: "FULL_SCREEN",
  fill: "STRETCH"
});

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function parseAspectRatio(value) {
  const numeric = positiveNumber(value);
  if (numeric) {
    return numeric;
  }

  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }
  const match = text.match(/^(\d+(?:\.\d+)?)\s*[:/xX]\s*(\d+(?:\.\d+)?)$/);
  if (!match) {
    return null;
  }
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  return numerator > 0 && denominator > 0 ? numerator / denominator : null;
}

export function normalizeAspectMode(value) {
  const raw = String(value ?? "").trim();
  const normalized = raw.toUpperCase();
  if (ASPECT_MODE_IDS.includes(normalized)) {
    return normalized;
  }
  return LEGACY_OBJECT_FIT_MODES[raw.toLowerCase()] || DEFAULT_ASPECT_MODE;
}

export function aspectModeIndex(mode) {
  const index = ASPECT_MODE_IDS.indexOf(normalizeAspectMode(mode));
  return index >= 0 ? index : 0;
}

export function aspectModeNeedsVideoAspect(mode) {
  switch (normalizeAspectMode(mode)) {
    case "FULL_SCREEN":
    case "STRETCH":
    case "VERTICAL_STRETCH":
    case "HORIZONTAL_STRETCH":
      return true;
    default:
      return false;
  }
}

export function resolveAspectScale(mode, viewAspect, videoAspect) {
  const safeViewAspect = positiveNumber(viewAspect);
  if (!safeViewAspect) {
    return { scaleX: 1, scaleY: 1 };
  }

  const normalizedMode = normalizeAspectMode(mode);
  const safeVideoAspect = positiveNumber(videoAspect);
  if (!safeVideoAspect && aspectModeNeedsVideoAspect(normalizedMode)) {
    return { scaleX: 1, scaleY: 1 };
  }

  switch (normalizedMode) {
    case "FULL_SCREEN": {
      const uniformScale =
        safeVideoAspect > safeViewAspect
          ? safeVideoAspect / safeViewAspect
          : safeViewAspect / safeVideoAspect;
      return { scaleX: uniformScale, scaleY: uniformScale };
    }
    case "STRETCH":
      if (safeVideoAspect > safeViewAspect) {
        return { scaleX: 1, scaleY: safeVideoAspect / safeViewAspect };
      }
      return { scaleX: safeViewAspect / safeVideoAspect, scaleY: 1 };
    case "SLIGHT_ZOOM":
      return { scaleX: 1.15, scaleY: 1.15 };
    case "CINEMA_ZOOM":
      return { scaleX: 1.33, scaleY: 1.33 };
    case "VERTICAL_STRETCH":
      if (safeVideoAspect > safeViewAspect) {
        const uniformScale = safeVideoAspect / safeViewAspect;
        return { scaleX: uniformScale, scaleY: uniformScale };
      }
      return { scaleX: 1, scaleY: 1 };
    case "HORIZONTAL_STRETCH":
      if (safeVideoAspect < safeViewAspect) {
        const uniformScale = safeViewAspect / safeVideoAspect;
        return { scaleX: uniformScale, scaleY: uniformScale };
      }
      return { scaleX: 1, scaleY: 1 };
    case "ORIGINAL":
    default:
      return { scaleX: 1, scaleY: 1 };
  }
}

export function resolveAspectContentRect(viewportWidth, viewportHeight, videoAspect) {
  const width = positiveNumber(viewportWidth) || 1;
  const height = positiveNumber(viewportHeight) || 1;
  const mediaAspect = positiveNumber(videoAspect) || 16 / 9;
  const viewportAspect = width / height;
  const widthLimited = viewportAspect < mediaAspect;
  const contentWidth = widthLimited ? width : height * mediaAspect;
  const contentHeight = widthLimited ? width / mediaAspect : height;

  return {
    x: (width - contentWidth) / 2,
    y: (height - contentHeight) / 2,
    width: contentWidth,
    height: contentHeight
  };
}

export function resolveTizenDisplayMethod(mode, viewAspect, videoAspect) {
  const normalizedMode = normalizeAspectMode(mode);
  const safeViewAspect = positiveNumber(viewAspect);
  const safeVideoAspect = positiveNumber(videoAspect);
  if (normalizedMode === "FULL_SCREEN" || normalizedMode === "STRETCH") {
    return "PLAYER_DISPLAY_MODE_FULL_SCREEN";
  }

  if (normalizedMode === "VERTICAL_STRETCH") {
    return safeVideoAspect && safeViewAspect && safeVideoAspect > safeViewAspect
      ? "PLAYER_DISPLAY_MODE_FULL_SCREEN"
      : "PLAYER_DISPLAY_MODE_LETTER_BOX";
  }

  if (normalizedMode === "HORIZONTAL_STRETCH") {
    return safeVideoAspect && safeViewAspect && safeVideoAspect < safeViewAspect
      ? "PLAYER_DISPLAY_MODE_FULL_SCREEN"
      : "PLAYER_DISPLAY_MODE_LETTER_BOX";
  }

  // AVPlay has no native zoom primitive. Letter-boxing is the closest
  // aspect-preserving fallback for Original and the two zoom modes.
  return "PLAYER_DISPLAY_MODE_LETTER_BOX";
}

export function resolveAspectRender(mode, viewportWidth, viewportHeight, videoAspect) {
  const contentRect = resolveAspectContentRect(viewportWidth, viewportHeight, videoAspect);
  const viewAspect =
    contentRect.width > 0 && contentRect.height > 0
      ? (positiveNumber(viewportWidth) || 1) / (positiveNumber(viewportHeight) || 1)
      : 0;
  const scale = resolveAspectScale(mode, viewAspect, videoAspect);

  return {
    ...contentRect,
    ...scale,
    viewAspect,
    displayMethod: resolveTizenDisplayMethod(mode, viewAspect, videoAspect)
  };
}
