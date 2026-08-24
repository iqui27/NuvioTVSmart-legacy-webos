import { browserAdapter } from "./adapters/browserAdapter.js";
import { webosAdapter } from "./adapters/webosAdapter.js";
import { tizenAdapter } from "./adapters/tizenAdapter.js";

const ADAPTERS = {
  browser: browserAdapter,
  webos: webosAdapter,
  tizen: tizenAdapter
};

function parseWebOsMajorVersion() {
  const candidates = [
    String(globalThis.PalmSystem?.deviceInfo || ""),
    String(globalThis.webOSSystem?.deviceInfo || ""),
    String(globalThis.navigator?.userAgent || "")
  ].filter(Boolean);

  // `isEngine` marks the patterns that capture a Chromium version rather than a
  // webOS one, so the match has to be mapped before it is returned. This used to
  // be inferred with /chrom(e|ium)\//.test(pattern.source), which never matched:
  // a regex source escapes the slash, so the source text reads "chrome\/" and
  // the probe looked for "chrome/". Every webOS TV therefore reported its
  // Chromium version as its platform version — 53 here — and since that is
  // greater than 6, `legacy-webos` was never applied and every legacy-TV budget
  // and layout in the app stayed switched off on the hardware they were for.
  const patterns = [
    { regex: /web0s\.tv[\s\-\/]?(\d{1,2})/i, isEngine: false },
    { regex: /webos\.tv[\s\-\/]?(\d{1,2})/i, isEngine: false },
    { regex: /web0s[\s\-\/]?(\d{1,2})/i, isEngine: false },
    { regex: /webos[\s\-\/]?(\d{1,2})/i, isEngine: false },
    { regex: /chromium\/(\d{2,3})/i, isEngine: true },
    { regex: /chrome\/(\d{2,3})/i, isEngine: true }
  ];

  for (const candidate of candidates) {
    for (const pattern of patterns) {
      const match = candidate.match(pattern.regex);
      if (!match) {
        continue;
      }
      const value = Number(match[1] || 0);
      if (!Number.isFinite(value) || value <= 0) {
        continue;
      }
      if (pattern.isEngine) {
        // Engine-to-platform map per LG's official table: webOS 3.x ships
        // Chromium 38, 4.x ships 53, 5.x ships 68, 6.x ships 79.
        if (value <= 38) return 3;
        if (value <= 53) return 4;
        if (value <= 68) return 5;
        if (value <= 79) return 6;
        if (value <= 87) return 22;
        if (value <= 94) return 23;
        if (value <= 108) return 24;
        if (value <= 120) return 25;
        return 26;
      }
      return value;
    }
  }
  return 0;
}

function detectPlatformName() {
  const override = String(globalThis.__NUVIO_PLATFORM__ || "")
    .trim()
    .toLowerCase();
  if (override && ADAPTERS[override]) {
    return override;
  }
  const searchParams = String(globalThis.location?.search || "").toLowerCase();
  if (searchParams.includes("wrapper=tizen")) {
    return "tizen";
  }
  const userAgent = String(globalThis.navigator?.userAgent || "").toLowerCase();
  if (globalThis.webOS || globalThis.PalmSystem || globalThis.webOSSystem) {
    return "webos";
  }
  if (userAgent.includes("webos") || userAgent.includes("web0s")) {
    return "webos";
  }
  const webapis = globalThis.webapis || {};
  if (
    globalThis.tizen ||
    globalThis.avplay ||
    webapis.avplay ||
    webapis.avPlay ||
    webapis.productinfo ||
    userAgent.includes("tizen")
  ) {
    return "tizen";
  }
  return "browser";
}

function getAdapter() {
  if (!Platform.current) {
    Platform.current = ADAPTERS[detectPlatformName()];
  }
  return Platform.current;
}

export const Platform = {
  current: null,

  init() {
    const adapter = getAdapter();
    adapter.init?.();
    return adapter;
  },

  getName() {
    return getAdapter().name;
  },

  isWebOS() {
    return this.getName() === "webos";
  },

  getWebOsMajorVersion() {
    if (!this.isWebOS()) {
      return 0;
    }
    return parseWebOsMajorVersion();
  },

  isTizen() {
    return this.getName() === "tizen";
  },

  isBrowser() {
    return this.getName() === "browser";
  },

  exitApp() {
    if (globalThis.document && typeof globalThis.CustomEvent === "function") {
      const beforeExitEvent = new CustomEvent("nuvio:beforeExitApp", {
        cancelable: true
      });
      globalThis.document.dispatchEvent(beforeExitEvent);
      if (beforeExitEvent.defaultPrevented) {
        return false;
      }
    }
    return getAdapter().exitApp();
  },

  isBackEvent(event) {
    return getAdapter().isBackEvent(event);
  },

  normalizeKey(event) {
    return getAdapter().normalizeKey(event);
  },

  getDeviceLabel() {
    return getAdapter().getDeviceLabel();
  },

  getCapabilities() {
    return getAdapter().getCapabilities();
  },

  prepareVideoElement(videoElement) {
    return getAdapter().prepareVideoElement?.(videoElement);
  }
};
