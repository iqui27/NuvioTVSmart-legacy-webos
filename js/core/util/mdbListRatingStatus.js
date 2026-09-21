export const MDBLIST_RATING_STATUS = Object.freeze({
  CERTIFIED_FRESH: "certified-fresh",
  FRESH: "fresh",
  ROTTEN: "rotten",
  VERIFIED_HOT: "verified-hot",
  HOT: "hot",
  STALE: "stale"
});

function normalizeKeywordName(keyword) {
  const rawName =
    typeof keyword === "string"
      ? keyword
      : keyword && typeof keyword === "object"
        ? keyword.name
        : "";
  return String(rawName || "")
    .trim()
    .toLowerCase()
    .split(".")
    .pop();
}

function validRatingValue(value) {
  if (value == null || String(value).trim() === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100 ? numeric : null;
}

/** Map the MDBList metadata response used by Android to the Smart model. */
export function parseMdbListRottenTomatoesPayload(payload = {}) {
  const keywordNames = new Set(
    (Array.isArray(payload?.keywords) ? payload.keywords : [])
      .map(normalizeKeywordName)
      .filter(Boolean)
  );
  const validRatings = Array.isArray(payload?.ratings)
    ? payload.ratings
        .map((rating) => ({
          source: String(rating?.source || "")
            .trim()
            .toLowerCase(),
          value: validRatingValue(rating?.value)
        }))
        .filter((rating) => rating.value != null)
    : [];
  const findRating = (sources) =>
    validRatings.find((rating) => sources.includes(rating.source))?.value ?? null;

  return {
    tomatoes: findRating(["tomatoes"]),
    audience: findRating(["popcorn", "audience", "tomatoesaudience"]),
    tomatoesCertified: keywordNames.has("certified-fresh"),
    audienceCertified: keywordNames.has("certified-hot")
  };
}

export function getMdbListRatingStatus(provider, rating, certified = false) {
  const value = validRatingValue(rating);
  if (value == null) {
    return null;
  }
  const normalizedProvider = String(provider || "")
    .trim()
    .toLowerCase();
  if (normalizedProvider === "tomatoes") {
    if (certified && value >= 70) {
      return MDBLIST_RATING_STATUS.CERTIFIED_FRESH;
    }
    return value >= 60 ? MDBLIST_RATING_STATUS.FRESH : MDBLIST_RATING_STATUS.ROTTEN;
  }
  if (normalizedProvider === "audience") {
    if (certified && value >= 80) {
      return MDBLIST_RATING_STATUS.VERIFIED_HOT;
    }
    return value >= 60 ? MDBLIST_RATING_STATUS.HOT : MDBLIST_RATING_STATUS.STALE;
  }
  return null;
}

export function mdbListRatingIcon(provider, rating, ratings = {}) {
  const normalizedProvider = String(provider || "")
    .trim()
    .toLowerCase();
  const certified =
    normalizedProvider === "tomatoes"
      ? ratings?.tomatoesCertified === true
      : normalizedProvider === "audience"
        ? ratings?.audienceCertified === true
        : false;
  const status = getMdbListRatingStatus(normalizedProvider, rating, certified);

  if (normalizedProvider === "tomatoes") {
    if (status === MDBLIST_RATING_STATUS.CERTIFIED_FRESH) {
      return "assets/icons/mdblist_tomatoes_certified.svg";
    }
    if (status === MDBLIST_RATING_STATUS.ROTTEN) {
      return "assets/icons/mdblist_tomatoes_rotten.svg";
    }
    return "assets/icons/mdblist_tomatoes.svg";
  }
  if (normalizedProvider === "audience") {
    if (status === MDBLIST_RATING_STATUS.VERIFIED_HOT) {
      return "assets/icons/mdblist_audience_verified_hot.svg";
    }
    if (status === MDBLIST_RATING_STATUS.STALE) {
      return "assets/icons/mdblist_audience_stale.svg";
    }
    return "assets/icons/mdblist_audience.png";
  }
  return "";
}
