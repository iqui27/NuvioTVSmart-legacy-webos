/**
 * Whether a series the tracker no longer lists as watching may still offer a next episode.
 *
 * Next Up is seeded from watch history and never consults the list, so a show finished years ago
 * keeps offering whatever the addon lists after the furthest episode watched. That is rarely a
 * continuation: trackers model a franchise as one entry per season, cour or arc, so "finished"
 * means finished that entry, while the addon's list runs to the end of the franchise.
 *
 * The one case worth keeping is news - a season that has just started, or the next episode of a
 * show followed weekly, which a tracker marks completed between airings. Both land inside
 * NEXT_UP_NEW_RELEASE_WINDOW_MS of now and after the seed was watched. Everything else is backlog
 * the viewer has already decided against, and stays out of Continue Watching.
 */

/** Window either side of now in which a next episode still counts as news rather than backlog. */
export const NEXT_UP_NEW_RELEASE_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

function parseReleaseEpochMs(released) {
  if (released == null || released === "") {
    return null;
  }
  if (typeof released === "number") {
    return Number.isFinite(released) ? released : null;
  }
  const parsed = Date.parse(String(released));
  return Number.isNaN(parsed) ? null : parsed;
}

export function shouldSurfaceNextUpForUntrackedSeries({
  seedUpdatedAt = 0,
  released = null,
  nowMs = Date.now(),
  windowMs = NEXT_UP_NEW_RELEASE_WINDOW_MS
} = {}) {
  const releaseEpochMs = parseReleaseEpochMs(released);
  if (releaseEpochMs == null) {
    return false;
  }
  if (releaseEpochMs <= Number(seedUpdatedAt || 0)) {
    return false;
  }
  return Math.abs(releaseEpochMs - Number(nowMs)) <= windowMs;
}
