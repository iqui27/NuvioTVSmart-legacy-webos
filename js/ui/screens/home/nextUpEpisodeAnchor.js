/**
 * Where a Next Up seed lands when the tracker numbers episodes absolutely.
 *
 * Simkl only rewrites a season/episode pair into the addon's numbering when it holds a TVDB mapping
 * for the show. Without one it reports the anime's own running count - One Piece episode 66 arrives
 * as S1E66 - and no addon list contains that, because there season 1 ends at episode 8. The seed
 * then matches nothing, `resolveNextUpEpisode` gives up, and a show the viewer is actively watching
 * disappears from Continue Watching.
 *
 * The episode list is already ordered and free of specials, so an absolute number is simply a
 * 1-based index into it. Callers must only use this for an explicitly identified unmapped Simkl
 * anime episode; a show whose numbering already agrees with the addon is never reinterpreted.
 */

/**
 * Index of `episode` read as an absolute number, or -1 when that reading does not hold.
 *
 * Absolute numbering always reaches us as season 1, because it is the tracker's own single season
 * that goes unmapped. The caller's explicit source marker is what distinguishes this from a normal
 * season/episode lookup.
 */
export function findAbsoluteEpisodeAnchorIndex(episodes = [], { season = 0, episode = 0 } = {}) {
  const list = Array.isArray(episodes) ? episodes : [];
  const seedSeason = Number(season || 0);
  if (seedSeason !== 1) {
    return -1;
  }
  const index = Number(episode || 0) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= list.length) {
    return -1;
  }
  return index;
}
