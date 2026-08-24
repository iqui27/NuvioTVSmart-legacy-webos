/**
 * Non-blocking web font loading for the packaged TV app.
 *
 * The three font families used to arrive through an `@import` at the top of
 * css/base.css. In a `file://` packaged app that import is a render-blocking
 * request to fonts.googleapis.com: on webOS 4.10 it sits inside the ~1.2 s that
 * elapses before the app bundle runs its first statement, and offline it has to
 * time out before anything paints at all.
 *
 * Instead the app now paints with the local fallback stack and upgrades the
 * typeface afterwards, in three steps:
 *
 *   1. `--app-font-family` is set to the fallback-only stack, so first paint
 *      never depends on the network.
 *   2. After first paint the Google Fonts stylesheet for the *selected* family
 *      only is appended to <head>. This is a dynamically inserted stylesheet, so
 *      it cannot block a paint that already happened.
 *   3. The face is downloaded through the CSS Font Loading API
 *      (`document.fonts.load`) BEFORE the family is named in
 *      `--app-font-family`. Chromium 53 predates `font-display`, so a face that
 *      becomes matchable while it is still downloading makes its text invisible
 *      for up to three seconds. Loading first and applying second means the
 *      swap happens in one step with no blank-text window, and if the request
 *      fails (offline, DNS, Access-blocked) the family is simply never applied
 *      and the fallback stack stays.
 *
 * Deliberately NOT used here:
 *   - `rel="preload"`: it exists in Chromium 53, but `as="style"` still needs an
 *     `onload` handler to flip `rel` to "stylesheet", and that flip is exactly
 *     the behaviour whose support is inconsistent in that generation. It also
 *     does not solve the font-display problem at all.
 *   - `media="print"` + `onload` swap: the media swap works, but @font-face
 *     files are only fetched once a rule is matched, so the fetch — and the
 *     invisible-text window — just moves to the moment media flips to "all".
 *
 * Weights are requested as discrete values rather than as variable-font axis
 * ranges. Chromium 53 has no variable font support, so an axis-range request
 * either yields a face it cannot use or a much larger download than needed.
 */

const FONT_FALLBACK_STACK = '"Segoe UI", Arial, sans-serif';

const APP_FONTS = {
  INTER: { family: "Inter", googleFamily: "Inter" },
  DM_SANS: { family: "DM Sans", googleFamily: "DM+Sans" },
  OPEN_SANS: { family: "Open Sans", googleFamily: "Open+Sans" }
};

const FONT_WEIGHTS = [400, 500, 600, 700];
const DEFAULT_FONT_ID = "INTER";
const STYLESHEET_ELEMENT_ID_PREFIX = "nuvioAppFont-";
const FONT_LOAD_TIMEOUT_MS = 8000;

// Font ids whose face is confirmed usable, so a later theme apply can name the
// family immediately instead of falling back and upgrading a second time.
const readyFontIds = new Set();
const pendingFontIds = new Set();
let activeFontId = DEFAULT_FONT_ID;

function normalizeFontId(fontId) {
  const id = String(fontId || "")
    .trim()
    .toUpperCase();
  return APP_FONTS[id] ? id : DEFAULT_FONT_ID;
}

/**
 * @param {string} fontId
 * @returns {string} CSS font stack, naming the web font only once it is usable.
 */
export function resolveAppFontStack(fontId) {
  const id = normalizeFontId(fontId);
  if (!readyFontIds.has(id)) {
    return FONT_FALLBACK_STACK;
  }
  return `"${APP_FONTS[id].family}", ${FONT_FALLBACK_STACK}`;
}

function writeAppFontFamily(fontId) {
  const root = typeof document !== "undefined" ? document.documentElement : null;
  if (!root || !root.style || typeof root.style.setProperty !== "function") {
    return;
  }
  root.style.setProperty("--app-font-family", resolveAppFontStack(fontId));
}

function buildStylesheetUrl(fontId) {
  const descriptor = APP_FONTS[fontId];
  return `https://fonts.googleapis.com/css2?family=${descriptor.googleFamily}:wght@${FONT_WEIGHTS.join(";")}&display=swap`;
}

function ensureStylesheet(fontId) {
  const elementId = `${STYLESHEET_ELEMENT_ID_PREFIX}${fontId}`;
  const existing = document.getElementById(elementId);
  if (existing) {
    return existing;
  }
  const link = document.createElement("link");
  link.id = elementId;
  link.rel = "stylesheet";
  link.href = buildStylesheetUrl(fontId);
  document.head.appendChild(link);
  return link;
}

function markFontReady(fontId) {
  pendingFontIds.delete(fontId);
  if (readyFontIds.has(fontId)) {
    return;
  }
  readyFontIds.add(fontId);
  if (activeFontId === fontId) {
    writeAppFontFamily(fontId);
  }
}

function loadFontFaces(fontId) {
  const family = APP_FONTS[fontId].family;
  const fontSet = typeof document !== "undefined" ? document.fonts : null;
  if (!fontSet || typeof fontSet.load !== "function") {
    // No CSS Font Loading API: the only option left is to name the family and
    // let the engine fetch it. Text can flash while the face downloads, which
    // is why this is the fallback path and not the primary one.
    markFontReady(fontId);
    return;
  }

  let settled = false;
  const timeoutId = setTimeout(() => {
    // Give up quietly. The fallback stack is already on screen.
    settled = true;
    pendingFontIds.delete(fontId);
  }, FONT_LOAD_TIMEOUT_MS);

  const requests = FONT_WEIGHTS.map((weight) => fontSet.load(`${weight} 16px "${family}"`));
  Promise.all(requests)
    .then(() => {
      if (settled) {
        return;
      }
      clearTimeout(timeoutId);
      settled = true;
      markFontReady(fontId);
    })
    .catch(() => {
      if (settled) {
        return;
      }
      clearTimeout(timeoutId);
      settled = true;
      pendingFontIds.delete(fontId);
    });
}

function afterFirstPaint(callback) {
  const run = () => {
    // One frame plus a macrotask: the frame gets us past the paint, the task
    // keeps the stylesheet insertion off the critical path of that frame.
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => setTimeout(callback, 0));
      return;
    }
    setTimeout(callback, 0);
  };

  if (typeof document === "undefined") {
    return;
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
    return;
  }
  run();
}

/**
 * Applies the selected font to `--app-font-family` and, when the face is not
 * cached yet, starts a non-blocking download that upgrades the typeface once it
 * arrives. Safe to call on every theme apply.
 *
 * @param {string} fontId One of INTER, DM_SANS, OPEN_SANS.
 */
export function applyAppFontFamily(fontId) {
  const id = normalizeFontId(fontId);
  activeFontId = id;
  writeAppFontFamily(id);
  if (readyFontIds.has(id) || pendingFontIds.has(id)) {
    return;
  }
  pendingFontIds.add(id);
  afterFirstPaint(() => {
    if (!pendingFontIds.has(id)) {
      return;
    }
    try {
      ensureStylesheet(id);
      loadFontFaces(id);
    } catch (_) {
      // A font is cosmetic; never let it break a theme apply.
      pendingFontIds.delete(id);
    }
  });
}

export { FONT_FALLBACK_STACK };
