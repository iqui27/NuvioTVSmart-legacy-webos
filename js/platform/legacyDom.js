/*
 * DOM helpers for engines that predate the options objects this app relies on.
 *
 * Chromium 53 (webOS TV 4.x) is the problem case, and it is a nasty one because
 * both APIs below *exist* there and accept the call without throwing — they
 * just ignore, or worse misread, the options object:
 *
 *   focus({ preventScroll: true })  — option added in Chrome 64. Older engines
 *     ignore it and scroll the focused element into view, so every D-pad move
 *     yanks the page.
 *
 *   scrollIntoView({ block: "nearest" }) — options added in Chrome 61. Older
 *     engines coerce the object to `true`, which means alignToTop, so a call
 *     that should nudge the view by a few pixels jumps to the top instead.
 *
 * Because neither failure throws, try/catch guards around these calls do
 * nothing. The support probes here read the option through a getter, which only
 * fires on an engine that actually looks at it.
 */

let preventScrollSupport = null;
let scrollIntoViewOptionsSupport = null;

function supportsPreventScroll() {
  if (preventScrollSupport !== null) {
    return preventScrollSupport;
  }

  preventScrollSupport = false;
  const body = globalThis?.document?.body;
  if (!body) {
    return false;
  }

  const previouslyFocused = document.activeElement;
  const probe = document.createElement("div");
  probe.tabIndex = -1;
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;";

  try {
    body.appendChild(probe);
    const options = Object.defineProperty({}, "preventScroll", {
      get() {
        preventScrollSupport = true;
        return true;
      }
    });
    probe.focus(options);
  } catch (_) {
    preventScrollSupport = false;
  } finally {
    try {
      probe.remove();
    } catch (_) {}
    try {
      if (previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus();
      }
    } catch (_) {}
  }

  return preventScrollSupport;
}

function supportsScrollIntoViewOptions() {
  if (scrollIntoViewOptionsSupport !== null) {
    return scrollIntoViewOptionsSupport;
  }

  scrollIntoViewOptionsSupport = false;
  try {
    // A detached node never scrolls anything, so probing it has no side effect.
    const probe = document.createElement("div");
    const options = Object.defineProperty({}, "block", {
      get() {
        scrollIntoViewOptionsSupport = true;
        return "nearest";
      }
    });
    probe.scrollIntoView(options);
  } catch (_) {
    scrollIntoViewOptionsSupport = false;
  }

  return scrollIntoViewOptionsSupport;
}

function isScrollable(node) {
  if (!(node instanceof HTMLElement)) {
    return false;
  }
  return node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth;
}

function captureScrollPositions(element) {
  const positions = [];
  let node = element?.parentElement || null;
  while (node) {
    if (isScrollable(node)) {
      positions.push({ node, top: node.scrollTop, left: node.scrollLeft });
    }
    node = node.parentElement;
  }
  positions.push({
    node: null,
    top: globalThis.scrollY || globalThis.pageYOffset || 0,
    left: globalThis.scrollX || globalThis.pageXOffset || 0
  });
  return positions;
}

function restoreScrollPositions(positions) {
  for (const entry of positions) {
    if (entry.node) {
      entry.node.scrollTop = entry.top;
      entry.node.scrollLeft = entry.left;
    } else if (typeof globalThis.scrollTo === "function") {
      globalThis.scrollTo(entry.left, entry.top);
    }
  }
}

/**
 * Focus without letting the engine scroll the element into view.
 * Returns true when the element was focused.
 */
export function focusWithoutScroll(element) {
  if (!(element instanceof HTMLElement) || typeof element.focus !== "function") {
    return false;
  }

  if (supportsPreventScroll()) {
    try {
      element.focus({ preventScroll: true });
      return true;
    } catch (_) {
      /* fall through to the manual path */
    }
  }

  // Snapshot every scroll container above the element and put them back after
  // the focus call. This is what preventScroll does, done by hand.
  const positions = captureScrollPositions(element);
  try {
    element.focus();
  } catch (_) {
    return false;
  }
  restoreScrollPositions(positions);
  return true;
}

function findScrollParent(element) {
  let node = element?.parentElement || null;
  while (node) {
    if (isScrollable(node)) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function readScrollMargin(element) {
  try {
    const style = globalThis.getComputedStyle?.(element);
    if (!style) {
      return { top: 0, bottom: 0, left: 0, right: 0 };
    }
    return {
      top: Number.parseFloat(style.scrollMarginTop) || 0,
      bottom: Number.parseFloat(style.scrollMarginBottom) || 0,
      left: Number.parseFloat(style.scrollMarginLeft) || 0,
      right: Number.parseFloat(style.scrollMarginRight) || 0
    };
  } catch (_) {
    return { top: 0, bottom: 0, left: 0, right: 0 };
  }
}

/**
 * scrollIntoView with `block: "nearest"` semantics: scroll by the smallest
 * amount that brings the element fully inside its scroll container, and do
 * nothing when it already is.
 *
 * scroll-margin-* is Chrome 69, so the padding it asks for is applied here by
 * hand — the property is already in the stylesheet and would otherwise be
 * silently ignored, leaving focused items flush against the container edge.
 */
export function scrollIntoNearestView(element, options = {}) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const behavior = options.behavior === "smooth" ? "smooth" : "auto";

  if (supportsScrollIntoViewOptions()) {
    try {
      element.scrollIntoView({ block: "nearest", inline: "nearest", behavior });
      return true;
    } catch (_) {
      /* fall through to the manual path */
    }
  }

  const scroller = findScrollParent(element);
  if (!scroller) {
    return false;
  }

  const elementRect = element.getBoundingClientRect();
  const scrollerRect = scroller.getBoundingClientRect();
  const margin = readScrollMargin(element);

  const overflowTop = scrollerRect.top - (elementRect.top - margin.top);
  const overflowBottom = elementRect.bottom + margin.bottom - scrollerRect.bottom;
  if (overflowTop > 0) {
    scroller.scrollTop -= overflowTop;
  } else if (overflowBottom > 0) {
    scroller.scrollTop += overflowBottom;
  }

  const overflowLeft = scrollerRect.left - (elementRect.left - margin.left);
  const overflowRight = elementRect.right + margin.right - scrollerRect.right;
  if (overflowLeft > 0) {
    scroller.scrollLeft -= overflowLeft;
  } else if (overflowRight > 0) {
    scroller.scrollLeft += overflowRight;
  }

  return true;
}
