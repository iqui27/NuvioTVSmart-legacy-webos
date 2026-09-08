export const SUBTITLE_VERTICAL_OFFSET_CONTRACT = "android-v1";
export const SUBTITLE_VERTICAL_OFFSET_DEFAULT = 5;
export const SUBTITLE_VERTICAL_OFFSET_MIN = -20;
export const SUBTITLE_VERTICAL_OFFSET_MAX = 50;
export const SUBTITLE_VERTICAL_OFFSET_PLAYER_STEP = 5;

const ANDROID_POINTS_PER_WEB_STEP = 5;
const ANDROID_SUBTITLE_BOTTOM_BASE_VH = 6;
const ANDROID_SUBTITLE_BOTTOM_PER_SETTING_VH = 0.4;
const ANDROID_SUBTITLE_BOTTOM_MIN_VH = 0;
const ANDROID_SUBTITLE_BOTTOM_MAX_VH = 40;
const SUBTITLE_VERTICAL_OFFSET_DEFAULT_BOTTOM_VH = 8;
const SUBTITLE_VERTICAL_OFFSET_VH_PER_STEP = 2;
const SUBTITLE_VERTICAL_RESIDUAL_MIN_VH = -SUBTITLE_VERTICAL_OFFSET_VH_PER_STEP;
const SUBTITLE_VERTICAL_RESIDUAL_MAX_VH =
  SUBTITLE_VERTICAL_OFFSET_DEFAULT_BOTTOM_VH - ANDROID_SUBTITLE_BOTTOM_MIN_VH;

function clampNumber(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value)));
}

function roundNumber(value) {
  const rounded = Number(Number(value).toFixed(2));
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function normalizeSubtitleVerticalOffset(
  value,
  fallback = SUBTITLE_VERTICAL_OFFSET_DEFAULT
) {
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed) ? Math.round(parsed) : fallback;
  return Math.min(SUBTITLE_VERTICAL_OFFSET_MAX, Math.max(SUBTITLE_VERTICAL_OFFSET_MIN, normalized));
}

export function splitSubtitleVerticalOffset(value) {
  const storedValue = normalizeSubtitleVerticalOffset(value);
  const relativeOffset =
    (storedValue - SUBTITLE_VERTICAL_OFFSET_DEFAULT) / ANDROID_POINTS_PER_WEB_STEP;
  // A negative line number is measured from the bottom, while zero and
  // positive line numbers are measured from the top. Never turn an automatic
  // bottom cue into a top-referenced cue while moving it down; the residual
  // CSS translation handles that direction safely instead.
  const requestedLineOffset =
    relativeOffset < 0 ? Math.ceil(relativeOffset) : Math.floor(relativeOffset);
  const lineOffset = Math.max(0, requestedLineOffset);
  const residualOffset = Number((relativeOffset - lineOffset).toFixed(2));
  return {
    storedValue,
    value: relativeOffset,
    lineOffset,
    residualOffset: Object.is(residualOffset, -0) ? 0 : residualOffset
  };
}

/**
 * Convert the Android SubtitleView bottom-padding contract to a safe CSS
 * translation. Android starts at 6% + offset / 250 and clamps the padding at
 * the viewport edges; the Smart TV default is 8vh, so the values are
 * equivalent at the default and at both safe endpoints.
 */
export function getSubtitleVerticalOffsetVh(value) {
  const normalized = normalizeSubtitleVerticalOffset(value);
  const requestedBottomVh =
    ANDROID_SUBTITLE_BOTTOM_BASE_VH + normalized * ANDROID_SUBTITLE_BOTTOM_PER_SETTING_VH;
  const bottomVh = clampNumber(
    requestedBottomVh,
    ANDROID_SUBTITLE_BOTTOM_MIN_VH,
    ANDROID_SUBTITLE_BOTTOM_MAX_VH
  );
  return roundNumber(SUBTITLE_VERTICAL_OFFSET_DEFAULT_BOTTOM_VH - bottomVh);
}

/**
 * Return the remaining CSS translation used by native browser cue rendering.
 * It is independently bounded so a low user value cannot move a cue below
 * the player viewport.
 */
export function getSubtitleVerticalResidualOffsetVh(value) {
  const { residualOffset } = splitSubtitleVerticalOffset(value);
  return roundNumber(
    clampNumber(
      residualOffset * -SUBTITLE_VERTICAL_OFFSET_VH_PER_STEP,
      SUBTITLE_VERTICAL_RESIDUAL_MIN_VH,
      SUBTITLE_VERTICAL_RESIDUAL_MAX_VH
    )
  );
}

export function formatSubtitleVerticalOffset(value) {
  return String(normalizeSubtitleVerticalOffset(value));
}
