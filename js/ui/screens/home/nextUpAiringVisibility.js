// Android applies the "Show Unaired Next Up Episodes" setting to the release
// state a card ends up with, not only to the date used while picking which
// episode comes next. HomeViewModelContinueWatching drops a cached card with
// `if (!freshHasAired && !showUnairedNextUp) return null` once its badge has
// been recalculated, and keeps every other card only while
// `(it.info.hasAired || showUnairedNextUp)`.
//
// The web app checked the setting once, inside the episode search, against the
// addon release date. TMDB release dates replace that date afterwards, so an
// episode TMDB places in the future could still reach Continue Watching with
// the setting turned off. A card restored from the display snapshot was never
// checked again either.

// Missing flags stay visible, which matches how the rest of Continue Watching
// reads `hasAired` and keeps a card whose metadata never carried a date.
export function shouldKeepNextUpForAiringSetting(item = {}, showUnairedNextUp = true) {
  if (!item?.isNextUp) {
    return true;
  }
  return item.hasAired !== false || showUnairedNextUp !== false;
}
