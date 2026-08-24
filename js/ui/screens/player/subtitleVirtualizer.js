// Keep the complete subtitle option collection in JavaScript while mounting
// only a bounded window in the TV DOM. This mirrors Android TV's LazyColumn
// without changing the logical order or removing any selectable option.

export const SUBTITLE_VIRTUALIZATION_THRESHOLD = 32;
export const SUBTITLE_VIRTUALIZATION_MIN_WINDOW = 18;
export const SUBTITLE_VIRTUALIZATION_OVERSCAN_PX = 720;
export const SUBTITLE_VIRTUALIZATION_DEFAULT_ROW_EXTENT = 112;

function finitePositive(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function finiteNonNegative(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function getMeasuredExtent(measuredExtents, key) {
  if (!measuredExtents) {
    return 0;
  }
  if (typeof measuredExtents.get === "function") {
    return Number(measuredExtents.get(key) || 0);
  }
  return Number(measuredExtents[key] || 0);
}

export function buildSubtitleVirtualModel(
  keys = [],
  measuredExtents = null,
  estimatedExtent = SUBTITLE_VIRTUALIZATION_DEFAULT_ROW_EXTENT,
  { rowGap = 8, lastRowGap = rowGap } = {}
) {
  const normalizedKeys = Array.isArray(keys) ? keys.map((key) => String(key)) : [];
  const fallbackExtent = finitePositive(
    estimatedExtent,
    SUBTITLE_VIRTUALIZATION_DEFAULT_ROW_EXTENT
  );
  const safeRowGap = finiteNonNegative(rowGap);
  const safeLastRowGap = finiteNonNegative(lastRowGap, safeRowGap);
  const fallbackHeight = Math.max(1, fallbackExtent - safeRowGap);
  const extents = normalizedKeys.map((key, index) => {
    const measuredHeight = getMeasuredExtent(measuredExtents, key);
    const contentHeight = finitePositive(measuredHeight, fallbackHeight);
    const trailingGap = index === normalizedKeys.length - 1 ? safeLastRowGap : safeRowGap;
    return contentHeight + trailingGap;
  });
  const offsets = new Array(extents.length + 1);
  offsets[0] = 0;
  for (let index = 0; index < extents.length; index += 1) {
    offsets[index + 1] = offsets[index] + extents[index];
  }
  return {
    keys: normalizedKeys,
    extents,
    offsets,
    totalExtent: offsets[offsets.length - 1] || 0,
    estimatedExtent: fallbackExtent
  };
}

function clampIndex(index, count) {
  return Math.max(0, Math.min(Math.max(0, count - 1), Math.trunc(Number(index) || 0)));
}

function findIndex(offsets = [], offset = 0) {
  const count = Math.max(0, offsets.length - 1);
  if (!count) {
    return -1;
  }
  const target = finiteNonNegative(offset);
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (Number(offsets[middle + 1] || 0) <= target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return Math.max(0, Math.min(count - 1, low));
}

export function getSubtitleVirtualWindow(
  model,
  {
    scrollTop = 0,
    viewportHeight = 0,
    overscanPx = SUBTITLE_VIRTUALIZATION_OVERSCAN_PX,
    minWindow = SUBTITLE_VIRTUALIZATION_MIN_WINDOW
  } = {}
) {
  const count = Array.isArray(model?.keys) ? model.keys.length : 0;
  if (!count) {
    return {
      start: 0,
      end: -1,
      topSpacer: 0,
      bottomSpacer: 0,
      totalExtent: 0
    };
  }

  const offsets = Array.isArray(model.offsets) ? model.offsets : [0];
  const totalExtent = finiteNonNegative(model.totalExtent, offsets[count] || 0);
  const estimatedExtent = finitePositive(
    model.estimatedExtent,
    SUBTITLE_VIRTUALIZATION_DEFAULT_ROW_EXTENT
  );
  const safeScrollTop = Math.max(0, Math.min(finiteNonNegative(scrollTop), totalExtent));
  const safeViewportHeight = finitePositive(
    viewportHeight,
    estimatedExtent * Math.max(1, minWindow)
  );
  const safeOverscan = finiteNonNegative(overscanPx);
  const safeMinWindow = Math.max(1, Math.min(count, Math.trunc(Number(minWindow) || 1)));

  let start = findIndex(offsets, Math.max(0, safeScrollTop - safeOverscan));
  let end = findIndex(
    offsets,
    Math.min(totalExtent, safeScrollTop + safeViewportHeight + safeOverscan)
  );

  if (end - start + 1 < safeMinWindow) {
    const anchor = Math.floor((start + end) / 2);
    const centeredStart = anchor - Math.floor(safeMinWindow / 2);
    start = Math.max(0, Math.min(count - safeMinWindow, centeredStart));
    end = Math.min(count - 1, start + safeMinWindow - 1);
  }

  return {
    start,
    end,
    topSpacer: Math.max(0, Number(offsets[start] || 0)),
    bottomSpacer: Math.max(0, totalExtent - Number(offsets[end + 1] || totalExtent)),
    totalExtent
  };
}

export function getSubtitleScrollTopForIndex(
  model,
  index,
  { currentScrollTop = 0, viewportHeight = 0, padding = 16 } = {}
) {
  const count = Array.isArray(model?.keys) ? model.keys.length : 0;
  if (!count || !Array.isArray(model?.offsets)) {
    return 0;
  }
  const rowIndex = clampIndex(index, count);
  const current = finiteNonNegative(currentScrollTop);
  const viewport = finitePositive(viewportHeight, model.estimatedExtent || 1);
  const safePadding = finiteNonNegative(padding);
  const rowTop = Number(model.offsets[rowIndex] || 0);
  const rowBottom = Number(model.offsets[rowIndex + 1] || rowTop);
  const viewBottom = current + viewport;
  if (rowTop < current + safePadding) {
    return Math.max(0, rowTop - safePadding);
  }
  if (rowBottom > viewBottom - safePadding) {
    return Math.max(0, rowBottom - viewport + safePadding);
  }
  return current;
}
