function parseHourCycle(hourCycle) {
  const normalized = String(hourCycle || "").toLowerCase();
  if (normalized === "h11" || normalized === "h12") {
    return true;
  }
  if (normalized === "h23" || normalized === "h24") {
    return false;
  }
  return null;
}

function resolveIntlHour12(intlApi, locale = undefined) {
  try {
    if (typeof intlApi?.DateTimeFormat !== "function") {
      return null;
    }
    const resolved = new intlApi.DateTimeFormat(locale, {
      hour: "numeric"
    }).resolvedOptions();
    if (typeof resolved?.hour12 === "boolean") {
      return resolved.hour12;
    }
    return parseHourCycle(resolved?.hourCycle);
  } catch (_) {
    return null;
  }
}

export function parsePlatformTimeFormat(format) {
  const normalized = String(format || "").replace(/'[^']*'/g, "");
  // Tizen's time format uses `h` for both hour cycles; `ap` is the
  // discriminator for 12-hour output. Keep the LDML fallbacks for runtimes
  // that expose an uppercase hour-cycle token instead.
  if (/\b(?:ap|a)\b/i.test(normalized) || /K/.test(normalized)) {
    return true;
  }
  if (/[Hhk]/.test(normalized)) {
    return false;
  }
  return null;
}

export function resolveWebOsHour12(localeInfo, intlApi = null) {
  const clock = String(localeInfo?.clock || "")
    .trim()
    .toLowerCase();
  if (clock === "12") {
    return true;
  }
  if (clock === "24") {
    return false;
  }
  if (clock === "locale") {
    const formatLocale = String(localeInfo?.locales?.FMT || "").trim() || undefined;
    return resolveIntlHour12(intlApi, formatLocale);
  }
  return null;
}

export function resolveSystemHour12({
  tizenApi = null,
  webOsLocaleInfo = null,
  intlApi = null
} = {}) {
  try {
    const platformFormat = tizenApi?.time?.getTimeFormat?.();
    const platformHour12 = parsePlatformTimeFormat(platformFormat);
    if (typeof platformHour12 === "boolean") {
      return platformHour12;
    }
  } catch (_) {
    // Fall back to the browser runtime when the platform API is unavailable.
  }

  const webOsHour12 = resolveWebOsHour12(webOsLocaleInfo, intlApi);
  if (typeof webOsHour12 === "boolean") {
    return webOsHour12;
  }

  return resolveIntlHour12(intlApi);
}

export function buildClockFormatOptions(hour12 = null) {
  const options = {
    hour: "2-digit",
    minute: "2-digit"
  };
  if (typeof hour12 === "boolean") {
    options.hour12 = hour12;
  }
  return options;
}
