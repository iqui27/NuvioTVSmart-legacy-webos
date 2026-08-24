import { LocalStore } from "../../core/storage/localStore.js";
import { DEFAULT_ASPECT_MODE, normalizeAspectMode } from "../../core/player/playerAspect.js";

const KEY = "deviceLocalPlayerPreferences";

function readPreferences() {
  const value = LocalStore.get(KEY, {});
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export const DeviceLocalPlayerPreferences = {
  getAspectMode() {
    return normalizeAspectMode(readPreferences().aspectMode || DEFAULT_ASPECT_MODE);
  },

  setAspectMode(mode) {
    const next = {
      ...readPreferences(),
      aspectMode: normalizeAspectMode(mode)
    };
    LocalStore.set(KEY, next);
    return next.aspectMode;
  }
};
