export const SUBTITLE_DELAY_MIN_MS = -180000;
export const SUBTITLE_DELAY_MAX_MS = 180000;
export const SUBTITLE_DELAY_STEP_MS = 100;
export const SUBTITLE_DELAY_OVERLAY_TIMEOUT_MS = 20000;
export const SUBTITLE_AUTO_SYNC_REACTION_COMPENSATION_MS = 300;
export const SUBTITLE_AUTO_SYNC_MARGIN_MS = 180000;
export const SUBTITLE_AUTO_SYNC_MAX_VISIBLE_CUES = 90;

function absoluteDistance(left, right) {
  return Math.abs(Number(left || 0) - Number(right || 0));
}

function takeCentered(items, centerIndex, maxVisible) {
  if (items.length <= maxVisible) {
    return items;
  }
  const half = Math.floor(maxVisible / 2);
  let start = Math.max(0, centerIndex - half);
  const end = Math.min(items.length, start + maxVisible);
  if (end - start < maxVisible) {
    start = Math.max(0, end - maxVisible);
  }
  return items.slice(start, end);
}

export function calculateSubtitleAutoSyncDelayMs(capturedVideoMs, cueStartTimeMs) {
  const captured = Number(capturedVideoMs);
  const cueStart = Number(cueStartTimeMs);
  if (!Number.isFinite(captured) || !Number.isFinite(cueStart)) {
    return 0;
  }
  const delayMs = Math.trunc(captured - cueStart - SUBTITLE_AUTO_SYNC_REACTION_COMPENSATION_MS);
  return Math.max(SUBTITLE_DELAY_MIN_MS, Math.min(SUBTITLE_DELAY_MAX_MS, delayMs));
}

export function selectSubtitleAutoSyncVisibleCues(
  cues,
  anchorTimeMs,
  marginMs = SUBTITLE_AUTO_SYNC_MARGIN_MS,
  maxVisible = SUBTITLE_AUTO_SYNC_MAX_VISIBLE_CUES
) {
  const sorted = (Array.isArray(cues) ? cues : [])
    .filter((cue) => cue && Number.isFinite(Number(cue.startTimeMs)))
    .slice()
    .sort((left, right) => Number(left.startTimeMs) - Number(right.startTimeMs));
  if (!sorted.length) {
    return [];
  }

  const anchor = Number.isFinite(Number(anchorTimeMs)) ? Number(anchorTimeMs) : 0;
  const margin = Math.max(0, Number(marginMs) || 0);
  const limit = Math.max(1, Math.trunc(Number(maxVisible) || 1));
  const lower = Math.max(0, anchor - margin);
  const upper = anchor + margin;
  const inWindow = sorted.filter(
    (cue) => Number(cue.startTimeMs) >= lower && Number(cue.startTimeMs) <= upper
  );
  if (inWindow.length) {
    if (inWindow.length <= limit) {
      return inWindow;
    }
    const centerIndex = inWindow.reduce(
      (bestIndex, cue, index, list) =>
        absoluteDistance(cue.startTimeMs, anchor) <
        absoluteDistance(list[bestIndex]?.startTimeMs, anchor)
          ? index
          : bestIndex,
      0
    );
    return takeCentered(inWindow, centerIndex, limit);
  }

  const nearestIndex = sorted.reduce(
    (bestIndex, cue, index, list) =>
      absoluteDistance(cue.startTimeMs, anchor) <
      absoluteDistance(list[bestIndex]?.startTimeMs, anchor)
        ? index
        : bestIndex,
    0
  );
  return takeCentered(sorted, nearestIndex, limit);
}

export function formatSubtitleAutoSyncTimestamp(positionMs) {
  const totalSeconds = Math.max(0, Math.trunc(Number(positionMs) || 0) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatSubtitleAutoSyncDelay(delayMs) {
  const normalized = Math.trunc(Number(delayMs) || 0);
  const sign = normalized >= 0 ? "+" : "-";
  const absoluteMs = Math.abs(normalized);
  const seconds = Math.floor(absoluteMs / 1000);
  const milliseconds = absoluteMs % 1000;
  return `${sign}${seconds}.${String(milliseconds).padStart(3, "0")}s`;
}

export function sanitizeSubtitleAutoSyncCueText(text) {
  const original = String(text ?? "").trim();
  const cleaned = original
    .replace(/\{\\[^{}]*\}/g, "")
    .replace(/\\N|\\n|\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || original;
}
