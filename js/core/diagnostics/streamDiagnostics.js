// Diagnostic collector for the source-loading path.
//
// Addon stream requests fail silently today: getStreamsFromAllAddons turns
// every failure -- HTTP error, TLS rejection, timeout, malformed payload --
// into `null`, and the stream screen renders the same "No streams found" for
// all of them. There is no console on a TV, so a user reporting "addons are
// not fetching" and a user whose addons legitimately have no results look
// identical from here.
//
// This records why each source produced nothing so the empty state can say it.

const MAX_ENTRIES = 40;

const entries = [];
let sequence = 0;

function describeError(error) {
  if (!error) {
    return "unknown error";
  }
  const status = Number(error.status || 0);
  const name = String(error.name || "");
  const message = String(error.message || error.detail || "").trim();
  if (name === "TimeoutError" || error.code === "REQUEST_TIMEOUT") {
    return "timed out";
  }
  if (status) {
    return `HTTP ${status}${message ? ` - ${message.slice(0, 100)}` : ""}`;
  }
  // A TLS rejection or a blocked request surfaces as an opaque "Failed to
  // fetch" in Chromium; the page is not allowed to see which of the two it is.
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "connection failed (DNS, TLS or blocked)";
  }
  return message ? message.slice(0, 140) : "unknown error";
}

function push(source, outcome, detail) {
  entries.push({
    order: sequence++,
    source: String(source || "unknown"),
    outcome: String(outcome || ""),
    detail: String(detail || "")
  });
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
}

export const StreamDiagnostics = {
  reset() {
    entries.length = 0;
    sequence = 0;
  },

  recordFailure(source, error) {
    push(source, "failed", describeError(error));
  },

  recordEmpty(source) {
    push(source, "empty", "responded, no streams");
  },

  recordSuccess(source, count) {
    push(source, "ok", `${Number(count) || 0} streams`);
  },

  entries() {
    return entries.slice();
  },

  summaryLines() {
    return entries.map(
      (entry) => `${entry.source}: ${entry.outcome}${entry.detail ? ` (${entry.detail})` : ""}`
    );
  }
};
