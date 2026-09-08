function integerValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }
  const numeric = Number(value);
  return Number.isInteger(numeric) ? numeric : null;
}

function firstNonNegativeInteger(values = []) {
  for (const value of values) {
    const numeric = integerValue(value);
    if (numeric != null && numeric >= 0) {
      return numeric;
    }
  }
  return null;
}

function firstPositiveInteger(values = []) {
  for (const value of values) {
    const numeric = integerValue(value);
    if (numeric != null && numeric > 0) {
      return numeric;
    }
  }
  return null;
}

function parseSeasonEpisodeFromId(rawId) {
  const segments = String(rawId || "")
    .trim()
    .split(":")
    .map((segment) => segment.trim());
  if (segments.length < 2) {
    return null;
  }
  const season = integerValue(segments[segments.length - 2]);
  const episode = integerValue(segments[segments.length - 1]);
  if (season == null || season < 0 || episode == null || episode <= 0) {
    return null;
  }
  // Provider ids with three segments are commonly addon-specific. Only the
  // IMDb-shaped form has the same `id:season:episode` contract used by the
  // detail screen.
  if (segments.length === 3 && !/^tt\d+$/i.test(segments[0])) {
    return null;
  }
  return { season, episode };
}

function resolveEpisodePosition(video = {}, fallbackSeason = null) {
  const fromId = parseSeasonEpisodeFromId(video.id);
  const season = firstNonNegativeInteger([video.season, video.seasonNumber, fromId?.season]);
  const episode = firstPositiveInteger([
    video.episode,
    video.episodeNumber,
    fromId?.episode,
    video.number
  ]);
  if (episode == null) {
    return { season, episode: null };
  }
  if (season != null) {
    return { season, episode };
  }
  const normalizedFallbackSeason = firstNonNegativeInteger([fallbackSeason]);
  return { season: normalizedFallbackSeason, episode };
}

export function normalizePlayerEpisodeMetadata(videos = [], { fallbackSeason = null } = {}) {
  return (Array.isArray(videos) ? videos : [])
    .map((video) => {
      const { season, episode } = resolveEpisodePosition(video, fallbackSeason);
      const id = String(video?.id || "").trim();
      const title = String(video?.title || video?.name || "").trim();
      return {
        ...video,
        id,
        title: title || (season == null ? `E${episode || ""}` : `S${season}E${episode || ""}`),
        season,
        episode,
        thumbnail: video?.thumbnail || null,
        overview: video?.overview || video?.description || "",
        released:
          video?.released ||
          video?.releaseDate ||
          video?.release_date ||
          video?.firstAired ||
          video?.first_aired ||
          video?.airDate ||
          video?.air_date ||
          ""
      };
    })
    .filter((video) => video.id && video.episode != null && video.episode > 0)
    .sort((left, right) => {
      const leftSeason = left.season == null ? Number.MAX_SAFE_INTEGER : left.season;
      const rightSeason = right.season == null ? Number.MAX_SAFE_INTEGER : right.season;
      return (
        leftSeason - rightSeason ||
        left.episode - right.episode ||
        String(left.title || "").localeCompare(String(right.title || ""))
      );
    });
}

export function resolvePostPlayEpisodeMetadataResolved({
  explicitResolution,
  episodes,
  nextEpisodeVideoId
} = {}) {
  if (explicitResolution === true) {
    return true;
  }
  if (explicitResolution === false) {
    return false;
  }
  return (
    (Array.isArray(episodes) && episodes.length > 0) ||
    String(nextEpisodeVideoId || "").trim().length > 0
  );
}
