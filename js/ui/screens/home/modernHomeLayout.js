import { getHomeRowKind, homeRowEyebrowKind, isRankedHomeRow } from "./homeRowKind.js";

export const MODERN_HOME_CONSTANTS = {
  heroFocusDelayMs: 450,
  heroRapidNavThresholdMs: 130,
  heroRapidSettleMs: 400,
  keyRepeatThrottleMs: 80,
  verticalKeyRepeatThrottleMs: 112,
  trackPaginationIdleMs: 160,
  trackPaginationPrefetchDelayMs: 40,
  trackPaginationLoadAheadItems: 4,
  cameraFollowDelayMs: 140,
  cameraFollowDurationXMs: 440,
  cameraFollowDurationYMs: 440,
  cameraSafetyDurationMs: 180,
  springScrollStiffness: 180,
  springScrollDampingRatio: 0.95,
  rowFocusInset: 40,
  trackEdgePadding: 104,
  verticalFastScrollVelocityPxPerSec: 6400,
  verticalFastScrollEndTimeoutMs: 160,
  verticalFastScrollMaxFrameMs: 48
};

export function renderModernHomeLayout({
  rows = [],
  heroItem = null,
  heroCandidates = [],
  continueWatchingItems = [],
  upcomingItems = [],
  continueWatchingLoading = false,
  continueWatchingLoadingCount = 0,
  continueWatchingRenderLimit = 30,
  useEpisodeThumbnailsInCw = true,
  blurContinueWatchingNextUp = false,
  continueWatchingCardStyle = "card",
  rowItemLimit = 15,
  showHeroSection = false,
  showPosterLabels = true,
  showCatalogTypeSuffix = true,
  preferLandscapePosters = false,
  focusedRowKey = "",
  focusedItemIndex = -1,
  expandFocusedPoster = false,
  buildModernHeroPresentation,
  renderHeroBackdropImage,
  renderContinueWatchingSection,
  createPosterCardMarkup,
  createSeeAllCardMarkup,
  formatCatalogRowTitle,
  shouldDeferRowImages,
  watchedTitleIds = null,
  rowKindLabels = null,
  escapeHtml,
  escapeAttribute
} = {}) {
  const catalogSeeAllMap = new Map();
  const sectionsMarkup = [];
  // Kept alongside the joined markup so render() can seed
  // homeRowMarkupCache; without it the first reconcile after a full render sees
  // no cached markup for any row and replaces every one of them.
  const sections = [];

  rows.forEach((rowData, rowIndex) => {
    const section = renderModernRowSection(rowData, rowIndex, {
      rowItemLimit,
      focusedRowKey,
      focusedItemIndex,
      expandFocusedPoster,
      showPosterLabels,
      showCatalogTypeSuffix,
      preferLandscapePosters,
      shouldDeferRowImages,
      watchedTitleIds,
      createPosterCardMarkup,
      createSeeAllCardMarkup,
      formatCatalogRowTitle,
      rowKindLabels,
      escapeHtml
    });
    if (!section) {
      return;
    }
    if (section.seeAllEntry) {
      catalogSeeAllMap.set(section.seeAllId, section.seeAllEntry);
    }
    sectionsMarkup.push(section.markup);
    sections.push(section);
  });

  return {
    sections,
    catalogSeeAllMap,
    markup: `
      <section class="home-modern-stage">
        ${
          showHeroSection
            ? renderModernHeroMarkup({
                heroItem,
                heroCandidates,
                buildModernHeroPresentation,
                renderHeroBackdropImage,
                escapeHtml,
                escapeAttribute
              })
            : continueWatchingLoading
              ? renderModernHeroSkeletonMarkup()
              : ""
        }
        <div class="home-modern-rows-viewport">
          <div class="home-modern-rows-scroll">
            ${renderContinueWatchingSection(continueWatchingItems, {
              rowKey: "continue_watching",
              loading: continueWatchingLoading,
              loadingCount: continueWatchingLoadingCount,
              itemLimit: continueWatchingRenderLimit,
              useEpisodeThumbnails: useEpisodeThumbnailsInCw,
              blurNextUp: blurContinueWatchingNextUp,
              cardStyle: continueWatchingCardStyle
            })}
            ${renderContinueWatchingSection(upcomingItems, {
              rowKey: "upcoming_section",
              titleKey: "upcoming_section_title",
              title: "Upcoming",
              startIndex: continueWatchingItems.length,
              itemLimit: upcomingItems.length,
              useEpisodeThumbnails: useEpisodeThumbnailsInCw,
              blurNextUp: blurContinueWatchingNextUp,
              cardStyle: continueWatchingCardStyle
            })}
            <div class="home-modern-catalogs">
              ${sectionsMarkup.join("")}
            </div>
          </div>
        </div>
      </section>
    `
  };
}

export function buildModernNavigationRows(container) {
  const rows = [];
  const continueTracks = Array.from(
    container?.querySelectorAll(".home-row-continue .home-track") || []
  );
  continueTracks.forEach((continueTrack) => {
    const continueNodes = Array.from(
      continueTrack.querySelectorAll(".home-content-card.focusable")
    );
    if (continueNodes.length) {
      rows.push(continueNodes);
    }
  });

  const rowSections = Array.from(container?.querySelectorAll(".home-modern-row") || []);
  rowSections.forEach((section) => {
    const track = section.querySelector(".home-track");
    if (!track) {
      return;
    }
    const cards = Array.from(track.querySelectorAll(".home-content-card.focusable"));
    if (cards.length) {
      rows.push(cards);
    }
  });

  return rows;
}

export function buildModernRowKey(rowData = {}) {
  return `${rowData.addonId || ""}_${rowData.type || ""}_${rowData.catalogId || ""}`;
}

function buildHeroIndicators(items = [], activeItem = null) {
  if (!Array.isArray(items) || items.length <= 1) {
    return "";
  }
  const activeId = String(activeItem?.id || "");
  const activeIndex = items.findIndex((item) => String(item?.id || "") === activeId);
  return items
    .map(
      (_, index) => `
    <span class="home-hero-indicator${index === activeIndex ? " is-active" : ""}"></span>
  `
    )
    .join("");
}

function renderModernHeroMarkup({
  heroItem,
  heroCandidates,
  buildModernHeroPresentation,
  renderHeroBackdropImage,
  escapeHtml,
  escapeAttribute
}) {
  const display = buildModernHeroPresentation(heroItem);
  if (!display) {
    return "";
  }
  const primaryLeft = display.leadingMeta
    .map((token) => `<span>${escapeHtml(token)}</span>`)
    .join('<span class="home-hero-dot">•</span>');
  const primaryRightParts = display.trailingMeta.map(
    (token) => `<span>${escapeHtml(token)}</span>`
  );
  if (display.showImdbPrimary) {
    primaryRightParts.push(`
      <span class="home-hero-imdb">
        <img src="assets/icons/imdb_logo_2016.svg" alt="IMDb" />
        <span>${escapeHtml(display.imdbText)}</span>
      </span>
    `);
  }
  const hasPrimaryRight = primaryRightParts.length > 0;
  const secondaryParts = [];
  if (display.secondaryHighlightText) {
    secondaryParts.push(
      `<span class="home-modern-hero-highlight">${escapeHtml(display.secondaryHighlightText)}</span>`
    );
  }
  display.badges.forEach((badge) => {
    secondaryParts.push(`<span class="home-modern-hero-badge">${escapeHtml(badge)}</span>`);
  });
  if (display.showImdbSecondary) {
    secondaryParts.push(`
      <span class="home-hero-imdb">
        <img src="assets/icons/imdb_logo_2016.svg" alt="IMDb" />
        <span>${escapeHtml(display.imdbText)}</span>
      </span>
    `);
  }
  if (display.languageText) {
    secondaryParts.push(
      `<span class="home-modern-hero-secondary-detail">${escapeHtml(display.languageText)}</span>`
    );
  }
  return `
    <section class="home-hero home-hero-modern">
      <article class="home-hero-card home-modern-hero-card${heroItem?.heroMetaEnriching ? " is-hero-meta-enriching" : ""}"
               data-item-id="${escapeAttribute(heroItem?.id || "")}"
               data-item-type="${escapeAttribute(heroItem?.type || "movie")}"
               data-item-title="${escapeAttribute(heroItem?.name || "Untitled")}">
        <div class="home-modern-hero-media">
          <div class="home-hero-backdrop-wrap">
          ${
            typeof renderHeroBackdropImage === "function"
              ? renderHeroBackdropImage(display)
              : display.backdrop
                ? `<img class="home-hero-backdrop" src="${escapeAttribute(display.backdrop)}" alt="${escapeAttribute(display.title)}" decoding="async" fetchpriority="high" />`
                : '<div class="home-hero-backdrop placeholder"></div>'
          }
          </div>
          <div class="home-hero-trailer-layer"></div>
        </div>
        <div class="home-hero-copy home-modern-hero-copy">
          <div class="home-hero-brand">
            ${display.logo ? `<img class="home-hero-logo" src="${escapeAttribute(display.logo)}" alt="${escapeAttribute(display.title)}" decoding="async" fetchpriority="high" />` : ""}
            <h1 class="home-hero-title-text${display.logo ? " is-hidden" : ""}">${escapeHtml(display.title)}</h1>
          </div>
          <div class="home-modern-hero-meta-line${display.leadingMeta.length || display.trailingMeta.length || display.showImdbPrimary ? "" : " is-empty"}">
            <div class="home-modern-hero-meta-group home-modern-hero-meta-group-leading">
              ${primaryLeft}
            </div>
            ${primaryLeft && hasPrimaryRight ? '<span class="home-hero-dot">•</span>' : ""}
            <div class="home-modern-hero-meta-group home-modern-hero-meta-group-trailing">
              ${primaryRightParts.join('<span class="home-hero-dot">•</span>')}
            </div>
          </div>
          <div class="home-modern-hero-secondary${display.secondaryHighlightText || display.badges.length || display.showImdbSecondary || display.languageText ? "" : " is-empty"}">
            ${secondaryParts.join('<span class="home-hero-dot">•</span>')}
          </div>
          <p class="home-hero-description${display.description ? "" : " is-empty"}">${escapeHtml(display.description)}</p>
        </div>
        <div class="home-hero-indicators">${buildHeroIndicators(heroCandidates, heroItem)}</div>
      </article>
    </section>
  `;
}

function renderModernHeroSkeletonMarkup() {
  return `
    <section class="home-hero home-hero-modern home-hero-modern-loading" aria-hidden="true">
      <article class="home-hero-card home-modern-hero-card home-modern-hero-card-loading">
        <div class="home-modern-hero-media home-modern-hero-media-loading">
          <div class="home-hero-backdrop-wrap">
            <div class="home-hero-backdrop placeholder home-hero-backdrop-loading"></div>
          </div>
        </div>
      </article>
    </section>
  `;
}

/**
 * Builds one catalog row's markup.
 *
 * Extracted verbatim from the rows.forEach above so that rendering a single row
 * on its own produces byte-identical markup to what a full render would have
 * produced for it. That equivalence is what makes keyed row reconciliation safe:
 * the reconciler compares generated markup per row to decide whether a live
 * section can be left untouched, and any drift between the two paths would show
 * up as rows being needlessly replaced — or worse, not replaced when they should.
 *
 * Returns null for a row the layout skips (no items and no loading placeholders).
 */
export function renderModernRowSection(rowData, rowIndex, options = {}) {
  const {
    rowItemLimit,
    focusedRowKey = "",
    focusedItemIndex = -1,
    expandFocusedPoster = false,
    showPosterLabels = true,
    showCatalogTypeSuffix = true,
    preferLandscapePosters = false,
    shouldDeferRowImages = null,
    watchedTitleIds = null,
    createPosterCardMarkup,
    createSeeAllCardMarkup = null,
    formatCatalogRowTitle,
    rowKindLabels = null,
    escapeHtml
  } = options;

  const isCollectionRow = rowData?.rowKind === "collection";
  const items = Array.isArray(rowData?.result?.data?.items) ? rowData.result.data.items : [];
  const isLoading = rowData?.result?.status === "loading";
  const rowItems = items.length ? items : rowData.loadingItems || [];
  if (!rowItems.length) {
    return null;
  }

  const rowKey = getHomeRowKey(rowData);
  const seeAllId = `${rowData.addonId || "addon"}_${rowData.catalogId || "catalog"}_${rowData.type || "movie"}`;
  const catalogResultData = rowData?.result?.data || {};
  const seeAllEntry =
    !isLoading && !isCollectionRow
      ? {
          addonBaseUrl: rowData.addonBaseUrl || "",
          addonId: rowData.addonId || "",
          addonName: rowData.addonName || "",
          catalogId: rowData.catalogId || "",
          catalogName: rowData.catalogName || "",
          type: rowData.type || "movie",
          initialItems: items,
          // Sem isto o "ver todos" recomecava a paginacao do zero e repetia a
          // primeira pagina. Veio do upstream (d51f350) e faltava no nosso
          // seeAllEntry, que extraiu este objeto para ca.
          initialNextSkip: Number(catalogResultData.nextSkip || 0),
          // Contrato de paginacao por skip, novo no 1.0.2. catalogSeeAllScreen
          // le os tres para decidir se pede mais paginas e de quanto em quanto;
          // sem eles a tela "ver todos" para na primeira pagina.
          initialHasMore: Boolean(catalogResultData.hasMore),
          supportsSkip: rowData.supportsSkip !== false && catalogResultData.supportsSkip !== false,
          skipStep: Number(rowData.skipStep || catalogResultData.skipStep || 100)
        }
      : null;

  const maxItems = Math.max(1, Number(rowItemLimit || 15));
  const focusedItemLimit =
    focusedRowKey === rowKey && Number.isFinite(focusedItemIndex)
      ? Math.max(0, Number(focusedItemIndex)) + 1
      : 0;
  const visibleItems = isCollectionRow
    ? rowItems
    : rowItems.slice(0, Math.max(maxItems, focusedItemLimit));
  const rowTitle = isCollectionRow
    ? String(rowData.collectionTitle || rowData.collection?.title || "Collection")
    : formatCatalogRowTitle(rowData.catalogName, rowData.type, showCatalogTypeSuffix);
  const deferRowImages =
    typeof shouldDeferRowImages === "function"
      ? shouldDeferRowImages(rowIndex, rowKey, focusedRowKey)
      : false;
  const cardMarkups = visibleItems.map((item, itemIndex) =>
    createPosterCardMarkup(
      item,
      rowIndex,
      itemIndex,
      rowData.type,
      rowData,
      showPosterLabels,
      "modern",
      expandFocusedPoster && focusedRowKey === rowKey && focusedItemIndex === itemIndex,
      preferLandscapePosters,
      deferRowImages,
      watchedTitleIds
    )
  );
  const cardsMarkup = cardMarkups.join("");

  // Presentational row identity: kind accents + chart numbering. Derived from
  // rowData only, so the full render and the keyed reconciler produce the same
  // bytes (see the byte-identical contract in this function's doc comment).
  const rowKind = getHomeRowKind(rowData);
  const rowRanked = !isLoading && isRankedHomeRow(rowData);
  const eyebrowKind = homeRowEyebrowKind(rowData);
  const eyebrowLabel =
    eyebrowKind && rowKindLabels ? String(rowKindLabels[eyebrowKind] || "").trim() : "";

  // The row's way out. Derived from rowData only (never from the DOM or from
  // focus), so the full render and the keyed reconciler emit the same bytes.
  const seeAllMarkup =
    typeof createSeeAllCardMarkup === "function" && rowHasSeeAllDoor(rowData, maxItems)
      ? createSeeAllCardMarkup(seeAllId, rowData, visibleItems.length, rowIndex)
      : "";

  // Split into shell + cards so the reconciler can tell "this row's chrome is
  // identical, only its cards moved" from "this is a different row". `markup` is
  // still the exact concatenation the full render used to emit as one template
  // literal - the byte-identical contract above depends on it staying so.
  const shellPrefix = `
      <section class="home-row home-modern-row home-row-enter" data-row-key="${escapeHtml(rowKey)}" data-row-index="${rowIndex}"${rowKind ? ` data-row-kind="${escapeHtml(rowKind)}"` : ""}${rowRanked ? ` data-row-ranked="true"` : ""}>
        <div class="home-row-head">
          <h2 class="home-row-title">${escapeHtml(rowTitle)}</h2>
          ${eyebrowLabel ? `<div class="home-row-eyebrow" aria-hidden="true">${escapeHtml(eyebrowLabel)}</div>` : ""}
        </div>
        <div class="home-track" data-track-row-key="${escapeHtml(rowKey)}">
          `;
  const shellSuffix = `
        </div>
      </section>
    `;

  return {
    rowKey,
    seeAllId,
    seeAllEntry,
    shell: `${shellPrefix}\u0000${shellSuffix}`,
    cards: buildKeyedCards(cardMarkups, seeAllMarkup),
    markup: `${shellPrefix}${cardsMarkup}${seeAllMarkup}${shellSuffix}`
  };
}

const CARD_ITEM_ID_PATTERN = /\sdata-item-id="([^"]*)"/;

/**
 * One entry per card in track order, each with a key stable across renders.
 *
 * The key is read back out of the generated markup rather than derived from the
 * item: the card's identity as the DOM knows it IS `data-item-id`, and
 * recomputing it here would mean duplicating normalizeCatalogItem's fallbacks
 * and drifting from them later. Items with no id, and repeats of an id already
 * used in this row, fall back to their position - two cards sharing one key
 * would make the diff match the wrong node and swap two posters.
 */
function buildKeyedCards(cardMarkups = [], seeAllMarkup = "") {
  const seen = new Set();
  const cards = cardMarkups.map((markup, index) => {
    const matched = CARD_ITEM_ID_PATTERN.exec(markup);
    const itemId = matched ? String(matched[1] || "").trim() : "";
    const key = itemId && !seen.has(itemId) ? itemId : `@${index}`;
    seen.add(key);
    return { key, markup };
  });
  if (seeAllMarkup) {
    // The door is not an item and has no id, but it is always last, so a fixed
    // key keeps it out of the item keyspace and lets it be reused in place.
    cards.push({ key: "@seeAll", markup: seeAllMarkup });
  }
  return cards;
}

/**
 * Should this row end with a "see all" door?
 *
 * The honest signal we have is thin. `catalogRepository` reports
 * `hasMore: supportsSkip && items.length > 0`, i.e. "the addon takes `skip=` and
 * this page was not empty" — it is NOT a real total, and no Stremio-shaped
 * manifest gives us one. So a full first page is the only evidence available
 * that more content exists behind the row.
 *
 * ASSUMPTION, deliberately conservative: a row whose fetched page filled the
 * rail (`items.length >= maxItems`) probably has more. A short row (5 of 5
 * items) gets no door, because opening a "full list" that is identical to the
 * rail is a lie. The cost of being wrong is one extra card leading to a screen
 * that shows the same 8 items — never a crash and never a wrong destination.
 *
 * Loading rows and collection rows are excluded, matching the classic layout:
 * a skeleton has no catalog to open, and a collection is already its own list.
 */
export function rowHasSeeAllDoor(rowData, maxItems) {
  if (!rowData || rowData.rowKind === "collection" || rowData.isCollection) {
    return false;
  }
  if (rowData?.result?.status !== "success") {
    return false;
  }
  const payload = rowData?.result?.data;
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const limit = Math.max(1, Number(maxItems) || 1);
  if (items.length > limit) {
    return true;
  }
  return items.length >= limit && Boolean(payload?.hasMore);
}

/**
 * The single source of truth for a row's identity.
 *
 * setupModernTrackScrollPagination used to look rows up with
 * `buildModernRowKey(row) === rowKey`, which silently missed every row whose DOM
 * key came from `homeCatalogKey` — pagination was simply dead on those rows. The
 * reconciler re-runs that setup far more often, so the two had to agree.
 */
export function getHomeRowKey(rowData) {
  return String(rowData?.homeCatalogKey || buildModernRowKey(rowData));
}
