/**
 * Derives a coarse "kind" for a Home row from data the row already carries.
 *
 * The taxonomy lives inside the catalog identifier (Xperience ids look like
 * `streaming_netflix_movies`, `genre_action_movies`, `snoak_top100_movies`),
 * so no API call and no manifest re-read is needed: the first id token maps to
 * a bucket. The kind feeds two purely presentational things — the eyebrow
 * label above the row title and the `data-row-kind` attribute the CSS keys
 * accents on. It never changes ordering, filtering or fetching, so a wrong or
 * missing mapping degrades to "row looks like today", nothing worse.
 *
 * Measured against the live manifest (2026-08-27, 605 catalogs): every id
 * bucket present in the manifest is covered by the table below.
 */

const XPERIENCE_BUCKET_KINDS = {
  // personalized
  recs: "foryou",
  ai: "foryou",
  // temporal / popularity
  trending: "trending",
  now: "trending", // now_playing
  on: "trending", // on_the_air
  new: "trending",
  upcoming: "trending",
  airing: "trending",
  // provider
  streaming: "streaming",
  network: "streaming",
  // genre-shaped
  genre: "genre",
  anime: "genre",
  // editorial / charts
  snoak: "curated",
  trakt: "curated",
  awards: "curated",
  fp: "curated",
  kb: "curated",
  // themed shelves
  themed: "themed",
  decade: "themed",
  studio: "themed",
  franchise: "themed",
  world: "themed",
  actor: "themed",
  director: "themed",
  kids: "themed",
  tv: "themed",
  runtime: "themed",
  uk: "themed",
  reality: "themed",
  collection: "themed"
};

const CINEMETA_CATALOG_KINDS = {
  top: "trending",
  imdbRating: "curated"
};

export function getHomeRowKind(rowData) {
  if (!rowData) {
    return "";
  }
  if (rowData.rowKind === "collection" || rowData.isCollection) {
    return "collection";
  }
  const catalogId = String(rowData.catalogId || "").trim();
  if (!catalogId) {
    return "";
  }
  const addonId = String(rowData.addonId || "");
  if (addonId.indexOf("com.linvo.cinemeta") === 0) {
    return CINEMETA_CATALOG_KINDS[catalogId] || "";
  }
  const bucket = catalogId.split("_", 1)[0];
  return XPERIENCE_BUCKET_KINDS[bucket] || "";
}

/**
 * Rows that are an explicit ranking (a chart with meaningful positions) get
 * position numbers on the cards. Deliberately conservative: only catalogs
 * whose id says "this is a chart" qualify — popularity feeds ("trending",
 * cinemeta `top`) are ordered but their exact position is noise.
 */
export function isRankedHomeRow(rowData) {
  const catalogId = String(rowData?.catalogId || "").trim();
  if (!catalogId) {
    return false;
  }
  if (catalogId.indexOf("snoak_top100") === 0) {
    return true;
  }
  const addonId = String(rowData?.addonId || "");
  return addonId.indexOf("com.linvo.cinemeta") === 0 && catalogId === "imdbRating";
}

/**
 * Kinds that earn an eyebrow. "foryou" and "trending" don't: their titles
 * already say what they are ("For You", "Trending") and stamping every row
 * would recreate the sameness the eyebrow exists to break.
 */
const EYEBROW_KINDS = {
  streaming: true,
  genre: true,
  curated: true,
  themed: true,
  collection: true
};

export function homeRowEyebrowKind(rowData) {
  const kind = getHomeRowKind(rowData);
  return EYEBROW_KINDS[kind] ? kind : "";
}
