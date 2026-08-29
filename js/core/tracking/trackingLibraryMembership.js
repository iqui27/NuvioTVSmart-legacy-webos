const SERIES_CONTENT_TYPES = ["tv", "show", "anime"];

export function supportsMembershipFor(tab, contentType) {
  if (!tab || tab.isMembershipDestination === false) {
    return false;
  }
  const supported = tab.supportedContentTypes;
  if (!Array.isArray(supported)) {
    return true;
  }
  const normalized = String(contentType || "").toLowerCase();
  return supported.some((entry) => {
    const value = String(entry || "").toLowerCase();
    return (
      value === normalized || (value === "series" && SERIES_CONTENT_TYPES.includes(normalized))
    );
  });
}
