import { ProfileManager } from "../../core/profile/profileManager.js";
import { LocalStore } from "../../core/storage/localStore.js";
import {
  SUBTITLE_DELAY_MAX_MS,
  SUBTITLE_DELAY_MIN_MS
} from "../../core/player/subtitleAutoSync.js";

const KEY = "subtitleDelayPreferences";
const MAX_ENTRIES = 500;

function activeProfileId() {
  return String(ProfileManager.getActiveProfileId() || "1");
}

function normalizeVideoId(value) {
  return String(value ?? "").trim();
}

function normalizeDelayMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(SUBTITLE_DELAY_MIN_MS, Math.min(SUBTITLE_DELAY_MAX_MS, Math.trunc(parsed)));
}

function readAll() {
  const raw = LocalStore.get(KEY, {});
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

function readEntries(profileId = activeProfileId()) {
  const entries = readAll()[String(profileId || "1")];
  return Array.isArray(entries)
    ? entries.filter((entry) => entry && typeof entry === "object" && entry.videoId)
    : [];
}

function writeEntries(profileId, entries) {
  const all = readAll();
  all[String(profileId || "1")] = entries;
  LocalStore.set(KEY, all);
}

export const SubtitleDelayPreferencesStore = {
  get(videoId, profileId = activeProfileId()) {
    const normalizedVideoId = normalizeVideoId(videoId);
    if (!normalizedVideoId) {
      return 0;
    }
    const entry = readEntries(profileId).find(
      (candidate) => candidate.videoId === normalizedVideoId
    );
    return normalizeDelayMs(entry?.delayMs) ?? 0;
  },

  set(videoId, delayMs, profileId = activeProfileId()) {
    const normalizedVideoId = normalizeVideoId(videoId);
    const normalizedDelay = normalizeDelayMs(delayMs);
    if (!normalizedVideoId || normalizedDelay == null) {
      return;
    }

    const entries = readEntries(profileId).filter((entry) => entry.videoId !== normalizedVideoId);
    if (normalizedDelay !== 0) {
      entries.unshift({
        videoId: normalizedVideoId,
        delayMs: normalizedDelay,
        updatedAtMs: Date.now()
      });
    }
    if (entries.length > MAX_ENTRIES) {
      entries.length = MAX_ENTRIES;
    }
    writeEntries(profileId, entries);
  }
};
