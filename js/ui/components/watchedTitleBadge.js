import { I18n } from "../../i18n/index.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function watchedBadgeLabel() {
  return I18n.t("episodes_cd_watched", {}, { fallback: "Watched" });
}

function addIdentityValue(set, value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return;
  }
  set.add(normalized);
  set.add(normalized.toLowerCase());
}

function addPrefixedIdentityValue(set, prefix, value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(new RegExp(`^${prefix}:`, "i"), "");
  if (!normalized) {
    return;
  }
  addIdentityValue(set, `${prefix}:${normalized}`);
}

function watchedItemIdentityValues(item = {}) {
  const values = new Set();
  addIdentityValue(values, item.contentId);
  addIdentityValue(values, item.id);

  const imdbId = String(item.imdbId ?? "")
    .trim()
    .replace(/^imdb:/i, "");
  addIdentityValue(values, imdbId);
  addPrefixedIdentityValue(values, "tmdb", item.tmdbId);
  addPrefixedIdentityValue(values, "trakt", item.traktId);
  addIdentityValue(values, item.slug);
  return values;
}

export function buildWatchedTitleIdSet(watchedItems = []) {
  const titleIds = new Set();
  (Array.isArray(watchedItems) ? watchedItems : [])
    .filter((item) => item?.season == null && item?.episode == null)
    .forEach((item) => {
      watchedItemIdentityValues(item).forEach((value) => titleIds.add(value));
    });
  return titleIds;
}

export function isTitleItemWatched(item = {}, watchedTitleIds = null) {
  if (!watchedTitleIds || typeof watchedTitleIds.has !== "function") {
    return false;
  }
  return Array.from(watchedItemIdentityValues(item)).some((id) => watchedTitleIds.has(id));
}

export function renderWatchedBadgeGlyph(className = "title-watched-badge-svg") {
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z" fill="currentColor"/></svg>`;
}

export function renderTitleWatchedBadge({
  className = "title-watched-badge",
  iconClassName = "title-watched-badge-svg"
} = {}) {
  return `<span class="${className}" aria-label="${escapeHtml(watchedBadgeLabel())}">${renderWatchedBadgeGlyph(iconClassName)}</span>`;
}
