// Continue Watching card artwork selection, ported from the Android app.

function normalizeCardStyle(cardStyle) {
  const normalized = String(cardStyle || "card")
    .trim()
    .toLowerCase();
  return ["card", "wide", "poster"].includes(normalized) ? normalized : "card";
}

export function continueWatchingUsesEpisodeThumbnails(cardStyle, useEpisodeThumbnails) {
  return useEpisodeThumbnails !== false && normalizeCardStyle(cardStyle) !== "poster";
}

export function continueWatchingImageSources(art = {}, options = {}) {
  const { poster, backdrop, thumbnail, episodeThumbnail } = art;
  const cardStyle = normalizeCardStyle(options.cardStyle);
  const useEpisodeThumbnails = continueWatchingUsesEpisodeThumbnails(
    cardStyle,
    options.useEpisodeThumbnails
  );
  // The normalized TV item can expose generic artwork in episodeThumbnail as a
  // fallback. Only series items may use that field as episode artwork; movies
  // must keep the Android order of backdrop before poster.
  const useEpisodeArtwork = useEpisodeThumbnails && options.isSeries !== false;
  // Wide cards use a poster-shaped strip on Android, so they share the poster-art
  // resolution path while still honoring the episode-thumbnail preference.
  const preferPosterArtwork = cardStyle !== "card";
  const isNextUp = Boolean(options.isNextUp);
  const hasAired = options.hasAired !== false;

  if (preferPosterArtwork) {
    if (useEpisodeArtwork) {
      return [isNextUp ? thumbnail : episodeThumbnail, poster, backdrop];
    }
    return [poster, backdrop];
  }

  if (isNextUp && !hasAired) {
    return [backdrop, poster, ...(useEpisodeArtwork ? [thumbnail] : [])];
  }
  if (isNextUp && useEpisodeArtwork) {
    return [thumbnail, backdrop, poster];
  }
  if (useEpisodeArtwork) {
    return [episodeThumbnail, backdrop, poster];
  }

  return [backdrop, poster];
}
