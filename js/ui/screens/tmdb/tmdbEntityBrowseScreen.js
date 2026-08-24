import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { TmdbMetadataService } from "../../../core/tmdb/tmdbMetadataService.js";
import { TmdbSettingsStore } from "../../../data/local/tmdbSettingsStore.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import { watchedItemsRepository } from "../../../data/repository/watchedItemsRepository.js";
import { Environment } from "../../../platform/environment.js";
import { I18n } from "../../../i18n/index.js";
import {
  buildWatchedTitleIdSet,
  isTitleItemWatched,
  renderTitleWatchedBadge
} from "../../components/watchedTitleBadge.js";
import {
  posterItemFromNode,
  PosterOptionsDialogController
} from "../../components/posterOptionsMenu.js";
import { renderLoadingIndicator } from "../../components/loadingIndicator.js";

const POSTER_HOLD_DELAY_MS = 650;

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function escapeHtml(value = "") {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeEntityKind(value) {
  return String(value || "")
    .trim()
    .toLowerCase() === "network"
    ? "network"
    : "company";
}

function normalizeEntityId(value) {
  const normalized = String(value ?? "").trim();
  return /^\d+$/.test(normalized) && Number(normalized) > 0 ? normalized : "";
}

function normalizeSourceType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "movie" ? "movie" : "tv";
}

function isBackEvent(event) {
  return Environment.isBackEvent(event);
}

function releaseYear(item = {}) {
  const raw = item?.releaseInfo || item?.released || item?.releaseDate || "";
  const match = String(raw).match(/\b(?:19|20)\d{2}\b/);
  return match?.[0] || "";
}

function mediaLabel(mediaType) {
  return mediaType === "tv" ? t("type_series", {}, "Series") : t("type_movie", {}, "Movie");
}

function railLabel(railType) {
  if (railType === "top_rated") {
    return t("tmdb_entity_rail_top_rated", {}, "Top Rated");
  }
  if (railType === "recent") {
    return t("tmdb_entity_rail_recent", {}, "Recent");
  }
  return t("tmdb_entity_rail_popular", {}, "Popular");
}

function entityKindLabel(entityKind) {
  return entityKind === "network"
    ? t("tmdb_entity_kind_network", {}, "Network")
    : t("tmdb_entity_kind_company", {}, "Production Company");
}

function getDirection(event) {
  const code = Number(event?.keyCode || 0);
  if (code === 37) return "left";
  if (code === 39) return "right";
  if (code === 38) return "up";
  if (code === 40) return "down";
  return null;
}

function routeStateClone(data) {
  if (!data || typeof data !== "object") {
    return null;
  }
  return {
    header: data.header ? { ...data.header } : null,
    rails: Array.isArray(data.rails)
      ? data.rails.map((rail) => ({
          ...rail,
          items: Array.isArray(rail?.items) ? [...rail.items] : []
        }))
      : []
  };
}

export const TmdbEntityBrowseScreen = {
  getRouteStateKey(params = {}) {
    const entityId = normalizeEntityId(params?.entityId);
    if (!entityId) {
      return null;
    }
    return `tmdbEntityBrowse:${normalizeEntityKind(params?.entityKind)}:${entityId}:${normalizeSourceType(params?.sourceType)}`;
  },

  captureRouteState() {
    this.captureViewState();
    return {
      params: this.params ? { ...this.params } : {},
      data: routeStateClone(this.data),
      watchedTitleIds: Array.from(this.watchedTitleIds || []),
      savedScrollTop: Number(this.savedScrollTop || 0),
      trackScrollLeftByKey: { ...(this.trackScrollLeftByKey || {}) },
      railFocusIndexByKey: { ...(this.railFocusIndexByKey || {}) },
      lastFocusedRailKey: this.lastFocusedRailKey || "",
      lastFocusedItemId: this.lastFocusedItemId || ""
    };
  },

  hydrateFromRouteState(restoredState = null, params = {}) {
    const snapshot = restoredState && typeof restoredState === "object" ? restoredState : null;
    if (!snapshot?.params || !snapshot?.data) {
      return false;
    }
    const currentKey = this.getRouteStateKey(params);
    const snapshotKey = this.getRouteStateKey(snapshot.params);
    if (!currentKey || currentKey !== snapshotKey) {
      return false;
    }
    const data = routeStateClone(snapshot.data);
    if (!data?.header || !Array.isArray(data.rails)) {
      return false;
    }
    this.params = params || {};
    this.data = data;
    this.watchedTitleIds = new Set(
      Array.isArray(snapshot.watchedTitleIds) ? snapshot.watchedTitleIds.map(String) : []
    );
    this.savedScrollTop = Number(snapshot.savedScrollTop || 0);
    this.trackScrollLeftByKey = { ...(snapshot.trackScrollLeftByKey || {}) };
    this.railFocusIndexByKey = { ...(snapshot.railFocusIndexByKey || {}) };
    this.lastFocusedRailKey = String(snapshot.lastFocusedRailKey || "");
    this.lastFocusedItemId = String(snapshot.lastFocusedItemId || "");
    this.pendingRestoreFocus = true;
    return true;
  },

  async refreshWatchedTitleIds() {
    const watchedItems = await watchedItemsRepository.getAll(5000).catch(() => []);
    this.watchedTitleIds = buildWatchedTitleIdSet(watchedItems);
  },

  async mount(params = {}, navigationContext = {}) {
    this.container = document.getElementById("tmdbEntityBrowse");
    ScreenUtils.show(this.container);
    this.params = params || {};
    this.layoutPrefs = LayoutPreferences.get();
    this.loadToken = (this.loadToken || 0) + 1;
    this.data = null;
    this.error = "";
    this.loading = false;
    this.savedScrollTop = 0;
    this.trackScrollLeftByKey = {};
    this.railFocusIndexByKey = {};
    this.lastFocusedRailKey = "";
    this.lastFocusedItemId = "";
    this.pendingRestoreFocus = false;
    this.loadingRails = new Set();
    this.posterOptionsController = null;
    this.posterOptionsFocusKey = "";
    this.pendingPosterHoldTarget = null;
    this.pendingPosterHoldTimer = null;
    await this.refreshWatchedTitleIds();

    if (
      navigationContext?.isBackNavigation &&
      this.hydrateFromRouteState(navigationContext?.restoredState || null, params)
    ) {
      this.render();
      return;
    }

    this.renderLoading();
    await this.load();
  },

  async load() {
    const token = this.loadToken;
    const settings = TmdbSettingsStore.get();
    const entityKind = normalizeEntityKind(this.params?.entityKind);
    const entityId = normalizeEntityId(this.params?.entityId);
    const sourceType = normalizeSourceType(this.params?.sourceType);
    const fallbackName = String(this.params?.entityName || this.params?.fallbackTitle || "").trim();
    if (!entityId) {
      this.renderError(
        t(
          "tmdb_entity_error_load_named",
          [fallbackName || entityKindLabel(entityKind)],
          "Could not load %1$s"
        )
      );
      return;
    }

    this.loading = true;
    this.error = "";
    try {
      const data = await TmdbMetadataService.fetchEntityBrowse({
        entityKind,
        entityId,
        sourceType,
        fallbackName,
        language: settings.language
      });
      if (token !== this.loadToken) {
        return;
      }
      this.loading = false;
      if (!data) {
        this.renderError(
          t(
            "tmdb_entity_error_load_named",
            [fallbackName || entityKindLabel(entityKind)],
            "Could not load %1$s"
          )
        );
        return;
      }
      this.data = data;
      this.pendingRestoreFocus = false;
      this.render();
    } catch (error) {
      if (token !== this.loadToken) {
        return;
      }
      console.warn("TMDB entity browse load failed", error);
      this.loading = false;
      this.renderError(
        t(
          "tmdb_entity_error_load_named",
          [fallbackName || entityKindLabel(entityKind)],
          "Could not load %1$s"
        )
      );
    }
  },

  renderLoading() {
    this.container.innerHTML = `
      <div class="tmdb-entity-shell tmdb-entity-shell-state">
        <div class="tmdb-entity-state">
          ${renderLoadingIndicator()}
          <span>${escapeHtml(t("discover_loading", {}, "Loading..."))}</span>
        </div>
      </div>
    `;
  },

  renderError(message) {
    this.error = String(message || "");
    this.container.innerHTML = `
      <div class="tmdb-entity-shell tmdb-entity-shell-state">
        <div class="tmdb-entity-state">
          <div class="tmdb-entity-state-title">${escapeHtml(message)}</div>
          <button class="tmdb-entity-retry focusable" data-action="retry">
            ${escapeHtml(t("action_retry", {}, "Retry"))}
          </button>
        </div>
      </div>
    `;
    ScreenUtils.indexFocusables(this.container);
    ScreenUtils.setInitialFocus(this.container, ".tmdb-entity-retry.focusable");
  },

  getHeroBackdrop() {
    const rails = Array.isArray(this.data?.rails) ? this.data.rails : [];
    for (const rail of rails) {
      const item = Array.isArray(rail?.items)
        ? rail.items.find((entry) => entry?.background)
        : null;
      if (item?.background) {
        return item.background;
      }
    }
    return "";
  },

  renderHero() {
    const header = this.data?.header || {};
    const meta = [header.originCountry, header.secondaryLabel].filter(Boolean).join(" • ");
    const backdrop = this.getHeroBackdrop();
    const description = String(header.description || "").trim();
    const heroClass = header.logo
      ? "tmdb-entity-hero tmdb-entity-hero-has-logo"
      : "tmdb-entity-hero";
    return `
      <section class="${heroClass}">
        ${
          backdrop
            ? `<img class="tmdb-entity-hero-backdrop" src="${escapeHtml(backdrop)}" alt="" aria-hidden="true" onerror="this.hidden=true" />`
            : ""
        }
        <div class="tmdb-entity-hero-scrim" aria-hidden="true"></div>
        <div class="tmdb-entity-hero-copy">
          <div class="tmdb-entity-eyebrow">${escapeHtml(entityKindLabel(header.kind))}</div>
          ${
            header.logo
              ? `<img class="tmdb-entity-logo" src="${escapeHtml(header.logo)}" alt="${escapeHtml(header.name || "")}" loading="eager" decoding="async" onerror="this.hidden=true" />`
              : ""
          }
          <h1 class="tmdb-entity-title">${escapeHtml(header.name || "Unknown")}</h1>
          ${meta ? `<div class="tmdb-entity-meta">${escapeHtml(meta)}</div>` : ""}
          ${description ? `<p class="tmdb-entity-description">${escapeHtml(description)}</p>` : ""}
        </div>
      </section>
    `;
  },

  renderRail(rail) {
    const railKey = String(
      rail?.key || `${rail?.mediaType || "movie"}:${rail?.railType || "popular"}`
    );
    const items = Array.isArray(rail?.items) ? rail.items : [];
    const cards = items
      .map((item, index) => {
        const poster = String(item?.poster || "").trim();
        const background = String(item?.background || item?.backdrop || "").trim();
        const title = item?.name || "Untitled";
        const itemId = String(item?.id || "").trim();
        return `
          <article class="tmdb-entity-card focusable"
                   data-action="openDetail"
                   data-item-id="${escapeHtml(itemId)}"
                   data-item-type="${escapeHtml(item?.type || (rail?.mediaType === "tv" ? "series" : "movie"))}"
                   data-item-title="${escapeHtml(title)}"
                   data-poster-src="${escapeHtml(poster)}"
                   data-backdrop-src="${escapeHtml(background)}"
                   data-focus-key="${escapeHtml(`${railKey}:${itemId || index}`)}"
                   data-rail-key="${escapeHtml(railKey)}"
                   data-item-index="${index}"
                   aria-label="${escapeHtml(title)}">
            <div class="tmdb-entity-card-poster-wrap">
              ${
                poster
                  ? `<img class="tmdb-entity-card-poster" src="${escapeHtml(poster)}" alt="${escapeHtml(title)}" loading="lazy" decoding="async" onerror="this.hidden=true; this.nextElementSibling.hidden=false" />`
                  : ""
              }
              <div class="tmdb-entity-card-placeholder"${poster ? " hidden" : ""}></div>
              ${isTitleItemWatched(item, this.watchedTitleIds) ? renderTitleWatchedBadge() : ""}
            </div>
            ${
              this.layoutPrefs?.posterLabelsEnabled !== false
                ? `
              <div class="tmdb-entity-card-title">${escapeHtml(title)}</div>
              <div class="tmdb-entity-card-year">${escapeHtml(releaseYear(item))}</div>
            `
                : ""
            }
          </article>
        `;
      })
      .join("");

    return `
      <section class="tmdb-entity-rail" data-rail-key="${escapeHtml(railKey)}">
        <h2 class="tmdb-entity-rail-title">${escapeHtml(`${mediaLabel(rail?.mediaType)} • ${railLabel(rail?.railType)}`)}</h2>
        <div class="tmdb-entity-track" data-scroll-key="${escapeHtml(railKey)}">
          ${cards}
          ${rail?.isLoading ? `<div class="tmdb-entity-rail-loading">${renderLoadingIndicator()}</div>` : ""}
        </div>
      </section>
    `;
  },

  render() {
    if (!this.data) {
      this.renderLoading();
      return;
    }
    const rails = Array.isArray(this.data.rails) ? this.data.rails : [];
    const shellContent = rails.length
      ? `${this.renderHero()}<div class="tmdb-entity-rails">${rails.map((rail) => this.renderRail(rail)).join("")}</div>`
      : `
        <div class="tmdb-entity-empty">
          <div class="tmdb-entity-state-title">${escapeHtml(t("tmdb_entity_empty_title", {}, "No titles found"))}</div>
          <div class="tmdb-entity-state-subtitle">${escapeHtml(t("tmdb_entity_empty_subtitle", {}, "TMDB does not currently have browseable titles for this selection."))}</div>
        </div>
      `;
    this.container.innerHTML = `<div class="tmdb-entity-shell">${shellContent}</div>`;
    ScreenUtils.indexFocusables(this.container, ".tmdb-entity-card.focusable");
    this.bindShellEvents();

    if (this.pendingRestoreFocus) {
      this.pendingRestoreFocus = false;
      this.restoreFocusedCard();
      return;
    }
    ScreenUtils.setInitialFocus(this.container, ".tmdb-entity-card.focusable");
    const initial = this.container.querySelector(".tmdb-entity-card.focusable.focused");
    if (initial) {
      this.rememberFocusedCard(initial);
      this.syncFocusedCardScroll(initial, { instant: true });
    }
  },

  bindShellEvents() {
    const shell = this.container?.querySelector(".tmdb-entity-shell");
    if (!(shell instanceof HTMLElement) || shell.__tmdbEntityShellBound) {
      return;
    }
    shell.__tmdbEntityShellBound = true;
    shell.addEventListener(
      "scroll",
      () => {
        this.savedScrollTop = Number(shell.scrollTop || 0);
      },
      { passive: true }
    );
  },

  getCardNodes(railKey = "") {
    const escapedRailKey =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(railKey)
        : railKey.replace(/(["\\])/g, "\\$1");
    const selector = railKey
      ? `.tmdb-entity-rail[data-rail-key="${escapedRailKey}"] .tmdb-entity-card.focusable`
      : ".tmdb-entity-card.focusable";
    try {
      return Array.from(this.container?.querySelectorAll(selector) || []);
    } catch (_) {
      return Array.from(
        this.container?.querySelectorAll(".tmdb-entity-card.focusable") || []
      ).filter((node) => !railKey || String(node.dataset.railKey || "") === railKey);
    }
  },

  rememberFocusedCard(node) {
    if (!(node instanceof HTMLElement)) {
      return;
    }
    this.lastFocusedRailKey = String(node.dataset.railKey || "");
    this.lastFocusedItemId = String(node.dataset.itemId || "");
    const index = Number(node.dataset.itemIndex || 0);
    if (this.lastFocusedRailKey) {
      this.railFocusIndexByKey[this.lastFocusedRailKey] = Number.isFinite(index) ? index : 0;
    }
  },

  captureViewState() {
    const shell = this.container?.querySelector(".tmdb-entity-shell");
    if (shell instanceof HTMLElement) {
      this.savedScrollTop = Number(shell.scrollTop || 0);
    }
    this.trackScrollLeftByKey = { ...(this.trackScrollLeftByKey || {}) };
    this.container?.querySelectorAll(".tmdb-entity-track[data-scroll-key]").forEach((track) => {
      const key = String(track.dataset.scrollKey || "").trim();
      if (key) {
        this.trackScrollLeftByKey[key] = Number(track.scrollLeft || 0);
      }
    });
    const focused = this.container?.querySelector(".tmdb-entity-card.focusable.focused");
    if (focused) {
      this.rememberFocusedCard(focused);
    }
  },

  syncFocusedCardScroll(node, { instant = false } = {}) {
    if (!(node instanceof HTMLElement)) {
      return;
    }
    const track = node.closest(".tmdb-entity-track");
    if (track instanceof HTMLElement) {
      const trackRect = track.getBoundingClientRect();
      const cardRect = node.getBoundingClientRect();
      const padding = 26;
      let nextLeft = track.scrollLeft;
      if (cardRect.left < trackRect.left + padding) {
        nextLeft -= trackRect.left + padding - cardRect.left;
      } else if (cardRect.right > trackRect.right - padding) {
        nextLeft += cardRect.right - (trackRect.right - padding);
      }
      const maxLeft = Math.max(0, track.scrollWidth - track.clientWidth);
      nextLeft = Math.max(0, Math.min(maxLeft, nextLeft));
      if (Math.abs(nextLeft - track.scrollLeft) > 1) {
        if (!instant && typeof track.scrollTo === "function") {
          track.scrollTo({ left: nextLeft, behavior: "smooth" });
        } else {
          track.scrollLeft = nextLeft;
        }
      }
      const key = String(track.dataset.scrollKey || "").trim();
      if (key) {
        this.trackScrollLeftByKey[key] = nextLeft;
      }
    }

    const shell = this.container?.querySelector(".tmdb-entity-shell");
    if (!(shell instanceof HTMLElement)) {
      return;
    }
    const shellRect = shell.getBoundingClientRect();
    const cardRect = node.getBoundingClientRect();
    const topPadding = 36;
    const bottomPadding = 56;
    let nextTop = shell.scrollTop;
    if (cardRect.top < shellRect.top + topPadding) {
      nextTop -= shellRect.top + topPadding - cardRect.top;
    } else if (cardRect.bottom > shellRect.bottom - bottomPadding) {
      nextTop += cardRect.bottom - (shellRect.bottom - bottomPadding);
    }
    const maxTop = Math.max(0, shell.scrollHeight - shell.clientHeight);
    nextTop = Math.max(0, Math.min(maxTop, nextTop));
    if (Math.abs(nextTop - shell.scrollTop) > 1) {
      if (!instant && typeof shell.scrollTo === "function") {
        shell.scrollTo({ top: nextTop, behavior: "smooth" });
      } else {
        shell.scrollTop = nextTop;
      }
    }
    this.savedScrollTop = nextTop;
  },

  focusNode(node, { instant = false } = {}) {
    if (!(node instanceof HTMLElement)) {
      return false;
    }
    this.container?.querySelectorAll(".focusable.focused").forEach((current) => {
      if (current !== node) {
        current.classList.remove("focused");
      }
    });
    node.classList.add("focused");
    try {
      node.focus({ preventScroll: true });
    } catch (_) {
      node.focus();
    }
    this.rememberFocusedCard(node);
    this.syncFocusedCardScroll(node, { instant });
    const rail = (this.data?.rails || []).find(
      (entry) => String(entry?.key || "") === String(node.dataset.railKey || "")
    );
    const index = Number(node.dataset.itemIndex || 0);
    if (rail?.hasMore && !rail?.isLoading && index >= (rail.items?.length || 0) - 4) {
      void this.loadMoreRail(String(node.dataset.railKey || ""));
    }
    return true;
  },

  restoreFocusedCard() {
    const shell = this.container?.querySelector(".tmdb-entity-shell");
    if (shell instanceof HTMLElement) {
      shell.scrollTop = Math.max(
        0,
        Math.min(shell.scrollHeight - shell.clientHeight, Number(this.savedScrollTop || 0))
      );
    }
    Object.entries(this.trackScrollLeftByKey || {}).forEach(([key, value]) => {
      const track = Array.from(this.container?.querySelectorAll(".tmdb-entity-track") || []).find(
        (node) => String(node.dataset.scrollKey || "") === key
      );
      if (track instanceof HTMLElement) {
        track.scrollLeft = Math.max(0, Number(value || 0));
      }
    });

    const cards = this.getCardNodes();
    const target =
      cards.find(
        (node) =>
          String(node.dataset.railKey || "") === this.lastFocusedRailKey &&
          String(node.dataset.itemId || "") === this.lastFocusedItemId
      ) || cards[0];
    if (!target) {
      return;
    }
    this.focusNode(target, { instant: true });
  },

  handleDpad(event) {
    const direction = getDirection(event);
    if (!direction) {
      return false;
    }
    const current = this.container?.querySelector(".tmdb-entity-card.focusable.focused");
    if (!(current instanceof HTMLElement)) {
      return false;
    }
    event?.preventDefault?.();
    const railKey = String(current.dataset.railKey || "");
    const cards = this.getCardNodes(railKey);
    const currentIndex = cards.indexOf(current);
    const railIndex = (this.data?.rails || []).findIndex(
      (rail) => String(rail?.key || "") === railKey
    );
    if (currentIndex < 0 || railIndex < 0) {
      return true;
    }

    if (direction === "left" || direction === "right") {
      const nextIndex = currentIndex + (direction === "left" ? -1 : 1);
      if (cards[nextIndex]) {
        this.focusNode(cards[nextIndex]);
      } else if (direction === "right") {
        void this.loadMoreRail(railKey);
      }
      return true;
    }

    const targetRail = this.data?.rails?.[railIndex + (direction === "up" ? -1 : 1)];
    if (!targetRail) {
      return true;
    }
    const targetCards = this.getCardNodes(String(targetRail.key || ""));
    if (targetCards.length) {
      const preferred = Math.min(currentIndex, targetCards.length - 1);
      this.focusNode(targetCards[preferred]);
    }
    return true;
  },

  async loadMoreRail(railKey) {
    const key = String(railKey || "").trim();
    if (!key || this.loadingRails.has(key)) {
      return;
    }
    const rail = (this.data?.rails || []).find((entry) => String(entry?.key || "") === key);
    if (!rail?.hasMore) {
      return;
    }
    const [mediaType, railType] = key.split(":");
    if (!mediaType || !railType) {
      return;
    }
    this.captureViewState();
    this.pendingRestoreFocus = true;
    this.loadingRails.add(key);
    rail.isLoading = true;
    const token = this.loadToken;
    try {
      const settings = TmdbSettingsStore.get();
      const result = await TmdbMetadataService.fetchEntityRailPage({
        entityKind: normalizeEntityKind(this.params?.entityKind),
        entityId: normalizeEntityId(this.params?.entityId),
        mediaType,
        railType,
        language: settings.language,
        page: Number(rail.currentPage || 1) + 1
      });
      if (token !== this.loadToken) {
        return;
      }
      const seen = new Set((rail.items || []).map((item) => String(item?.id || "")));
      (result.items || []).forEach((item) => {
        if (item?.id && !seen.has(String(item.id))) {
          seen.add(String(item.id));
          rail.items.push(item);
        }
      });
      rail.currentPage = Number(rail.currentPage || 1) + 1;
      rail.hasMore = Boolean(result.hasMore);
    } catch (error) {
      console.warn("TMDB entity rail pagination failed", error);
      rail.hasMore = false;
    } finally {
      this.loadingRails.delete(key);
      rail.isLoading = false;
      if (token === this.loadToken) {
        this.render();
      }
    }
  },

  isPosterHoldTarget(node) {
    return Boolean(node?.matches?.(".tmdb-entity-card.focusable[data-action='openDetail']"));
  },

  cancelPendingPosterHold() {
    if (this.pendingPosterHoldTimer) {
      clearTimeout(this.pendingPosterHoldTimer);
      this.pendingPosterHoldTimer = null;
    }
    this.pendingPosterHoldTarget = null;
  },

  hasPendingPosterHold(node) {
    return this.pendingPosterHoldTarget === node && Boolean(this.pendingPosterHoldTimer);
  },

  startPendingPosterHold(node) {
    this.cancelPendingPosterHold();
    if (!this.isPosterHoldTarget(node)) {
      return;
    }
    this.pendingPosterHoldTarget = node;
    this.pendingPosterHoldTimer = setTimeout(() => {
      this.pendingPosterHoldTimer = null;
      const target = this.pendingPosterHoldTarget;
      this.pendingPosterHoldTarget = null;
      if (target?.isConnected && target.classList.contains("focused")) {
        void this.openPosterOptionsMenu(target);
      }
    }, POSTER_HOLD_DELAY_MS);
  },

  completePendingPosterHold(node, event = null) {
    if (!this.pendingPosterHoldTarget) {
      return false;
    }
    const target = this.pendingPosterHoldTarget;
    const hadTimer = Boolean(this.pendingPosterHoldTimer);
    const heldLongEnough = Number(event?.keyDownDurationMs || 0) >= POSTER_HOLD_DELAY_MS;
    this.cancelPendingPosterHold();
    if (hadTimer && target === node) {
      if (heldLongEnough) {
        void this.openPosterOptionsMenu(target);
      } else {
        this.openDetailFromNode(target);
      }
    }
    return true;
  },

  async openPosterOptionsMenu(node) {
    const item = posterItemFromNode(node, node?.dataset?.itemType || "movie");
    if (!item?.id) {
      return false;
    }
    this.posterOptionsFocusKey = String(node.dataset.focusKey || "");
    if (!this.posterOptionsController) {
      this.posterOptionsController = new PosterOptionsDialogController({
        onDetails: (target) => {
          Router.navigate("detail", {
            itemId: target.id,
            itemType: target.type || "movie",
            fallbackTitle: target.title || "Untitled",
            fallbackPoster: target.poster || "",
            fallbackBackground: target.background || "",
            catalogType: target.catalogType || target.type || "movie"
          });
        },
        onDismiss: () => {
          this.pendingRestoreFocus = true;
          this.render();
        },
        onChanged: (state) => {
          const itemId = String(state?.item?.id || "").trim();
          if (!itemId) {
            return;
          }
          const watched = new Set(this.watchedTitleIds || []);
          if (state.isWatched) {
            watched.add(itemId);
          } else {
            watched.delete(itemId);
          }
          this.watchedTitleIds = watched;
        }
      });
    }
    return this.posterOptionsController.open(item, {
      focusKey: this.posterOptionsFocusKey,
      itemIndex: Number(node.dataset.itemIndex || -1)
    });
  },

  closePosterOptionsMenu() {
    if (!this.posterOptionsController?.dialog) {
      return false;
    }
    this.posterOptionsController.destroy();
    this.posterOptionsFocusKey = "";
    return true;
  },

  openDetailFromNode(node) {
    if (!(node instanceof HTMLElement) || !node.dataset.itemId) {
      return false;
    }
    Router.navigate("detail", {
      itemId: node.dataset.itemId,
      itemType: node.dataset.itemType || "movie",
      fallbackTitle: node.dataset.itemTitle || "Untitled",
      fallbackPoster: node.dataset.posterSrc || "",
      fallbackBackground: node.dataset.backdropSrc || "",
      catalogType: node.dataset.itemType || "movie"
    });
    return true;
  },

  async onKeyDown(event) {
    if (isBackEvent(event)) {
      event?.preventDefault?.();
      if (this.closePosterOptionsMenu()) {
        return;
      }
      Router.back();
      return;
    }

    const code = Number(event?.keyCode || 0);
    const current = this.container?.querySelector(".focusable.focused") || null;
    const posterHold = this.isPosterHoldTarget(current);
    if (code === 13 && posterHold) {
      event?.preventDefault?.();
      if (!event?.repeat && !this.hasPendingPosterHold(current)) {
        this.startPendingPosterHold(current);
      }
      return;
    }
    if (!posterHold || code !== 13) {
      this.cancelPendingPosterHold();
    }
    if (this.handleDpad(event)) {
      return;
    }
    if (code !== 13 || !current) {
      return;
    }
    const action = String(current.dataset.action || "");
    if (action === "retry") {
      await this.load();
    } else if (action === "openDetail") {
      this.openDetailFromNode(current);
    }
  },

  onKeyUp(event) {
    if (Number(event?.keyCode || 0) !== 13) {
      return;
    }
    const current = this.container?.querySelector(".tmdb-entity-card.focusable.focused") || null;
    if (this.completePendingPosterHold(current, event)) {
      event?.preventDefault?.();
    }
  },

  onPointerFocus(target) {
    if (this.isPosterHoldTarget(target)) {
      this.rememberFocusedCard(target);
    }
  },

  onPointerActivate(target) {
    const actionTarget = target?.closest?.("[data-action]");
    const action = String(actionTarget?.dataset?.action || "");
    if (action === "openDetail") {
      return this.openDetailFromNode(actionTarget);
    }
    if (action === "retry") {
      void this.load();
      return true;
    }
    return false;
  },

  consumeBackRequest() {
    return this.closePosterOptionsMenu();
  },

  cleanup() {
    this.loadToken = (this.loadToken || 0) + 1;
    this.cancelPendingPosterHold();
    this.posterOptionsController?.destroy?.({ restoreFocus: false });
    this.posterOptionsController = null;
    this.posterOptionsFocusKey = "";
    this.loadingRails?.clear?.();
    ScreenUtils.hide(this.container);
  }
};
