/**
 * Decides whether a Simkl series entry needs a show level watched marker.
 *
 * Simkl can report a whole series as completed while returning no per-episode
 * watched timestamps, for example a bulk mark or a completion imported from
 * another service. The Android app emits a show level watched item in that case
 * so the series still counts as watched. The web app only recorded per-episode
 * items, so such a completed series never showed as watched and could not be
 * fixed later by episode reconciliation because there were no watched episodes
 * to count. This restores the Android behavior. When per-episode history does
 * exist the per-episode items are enough, so no extra marker is added.
 */

export function shouldMarkCompletedSeriesWatched(status, hasEpisodeHistory) {
  return status === "completed" && !hasEpisodeHistory;
}
