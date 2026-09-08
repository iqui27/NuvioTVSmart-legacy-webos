function parseKnownRuntimeMinutes(value) {
  if (value == null || value === "") {
    return 0;
  }

  const numberValue = Number(value);
  if (Number.isFinite(numberValue) && numberValue > 0) {
    return numberValue;
  }

  const text = String(value).trim().toLowerCase();
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*h/);
  const minuteMatch = text.match(/(\d+)\s*(?:m|min)/);
  if (!hourMatch && !minuteMatch) {
    return 0;
  }

  const hours = hourMatch ? Number(hourMatch[1]) : 0;
  const minutes = minuteMatch ? Number(minuteMatch[1]) : 0;
  return Math.round(hours * 60 + minutes);
}

function hasKnownDurationUnit(value) {
  const text = String(value || "")
    .trim()
    .toLowerCase();
  return /(?:\d+(?:\.\d+)?)\s*h|(?:\d+)\s*(?:m|min)/.test(text);
}

function isExplicitZeroRuntime(value) {
  const text = String(value || "").trim();
  if (!text) {
    return false;
  }

  const numberValue = Number(text);
  if (Number.isFinite(numberValue)) {
    return numberValue <= 0;
  }

  return hasKnownDurationUnit(text) && parseKnownRuntimeMinutes(text) <= 0;
}

export function shouldPreserveHomeRuntimeText(value) {
  const text = String(value || "").trim();
  return Boolean(text) && !isExplicitZeroRuntime(text);
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

export function formatHomeRuntimeText(item = {}) {
  const rawRuntime = String(item?.runtime || "").trim();
  if (rawRuntime) {
    const parsedRuntime = parseKnownRuntimeMinutes(rawRuntime);
    if (parsedRuntime > 0) {
      return formatDurationMinutes(parsedRuntime);
    }
    return shouldPreserveHomeRuntimeText(rawRuntime) ? rawRuntime : "";
  }

  const fallbackRuntime =
    item?.runtimeMinutes ?? item?.durationMinutes ?? item?.duration_minutes ?? 0;
  return formatDurationMinutes(parseKnownRuntimeMinutes(fallbackRuntime));
}
