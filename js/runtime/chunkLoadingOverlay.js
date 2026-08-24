import { renderLoadingIndicator } from "../ui/components/loadingIndicator.js";

// Chunk-load feedback for lazy routes.
//
// The indicator is shown only after a delay. On the warm path (the chunk was
// already prefetched by warmScreenChunks, or is in the HTTP cache) the load
// resolves in a handful of milliseconds, and painting an indicator for those
// few frames reads as a flash of broken UI rather than as progress. Showing
// nothing is the correct answer for a load the user cannot perceive.
const OVERLAY_SHOW_DELAY_MS = 250;
const FAILURE_MESSAGE_MS = 3200;
const OVERLAY_ID = "nuvio-chunk-loading-overlay";

let showTimer = null;
let hideTimer = null;

function removeOverlay() {
  document.getElementById(OVERLAY_ID)?.remove();
}

function paintOverlay(innerHtml) {
  let overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.className = "nuvio-chunk-loading-overlay";
    // Inline styles on purpose: this overlay must be paintable even when the
    // stylesheet for the screen being loaded is not the one in effect, and it
    // is one element that exists for a few hundred milliseconds.
    overlay.style.cssText = [
      "position:fixed",
      "left:0",
      "top:0",
      "right:0",
      "bottom:0",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "flex-direction:column",
      "background:rgba(0, 0, 0, 0.55)",
      "z-index:9000",
      "pointer-events:none"
    ].join(";");
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = innerHtml;
  return overlay;
}

function clearTimers() {
  if (showTimer) {
    clearTimeout(showTimer);
    showTimer = null;
  }
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

export function beginChunkLoadingIndicator(label = "") {
  clearTimers();
  const text = String(label || "").trim() || "Loading...";
  showTimer = setTimeout(() => {
    showTimer = null;
    paintOverlay(renderLoadingIndicator({ label: text }));
  }, OVERLAY_SHOW_DELAY_MS);
}

export function endChunkLoadingIndicator() {
  clearTimers();
  removeOverlay();
}

// Failure is transient feedback, never a dead end: the message removes itself
// and the previous screen stays mounted and focusable, so pressing the same
// key again retries the load.
export function reportChunkLoadFailure(message = "") {
  clearTimers();
  const text = String(message || "").trim() || "Could not open this screen. Try again.";
  const overlay = paintOverlay("");
  const paragraph = document.createElement("p");
  paragraph.setAttribute("role", "status");
  paragraph.style.cssText = "color:#f5f5f5;font-size:1.4rem;text-align:center;max-width:60%";
  paragraph.textContent = text;
  overlay.appendChild(paragraph);
  hideTimer = setTimeout(() => {
    hideTimer = null;
    removeOverlay();
  }, FAILURE_MESSAGE_MS);
}
