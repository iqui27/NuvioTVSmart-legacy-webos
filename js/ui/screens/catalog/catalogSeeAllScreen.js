import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { catalogRepository } from "../../../data/repository/catalogRepository.js";
import { watchedItemsRepository } from "../../../data/repository/watchedItemsRepository.js";
import { Environment } from "../../../platform/environment.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import { I18n } from "../../../i18n/index.js";
import { filterReleasedItems } from "../../../core/util/releaseInfoUtils.js";
import { focusWithoutAutoScroll } from "../../components/sidebarNavigation.js";
import {
  posterItemFromNode,
  PosterOptionsDialogController
} from "../../components/posterOptionsMenu.js";
import {
  buildWatchedTitleIdSet,
  isTitleItemWatched,
  renderTitleWatchedBadge
} from "../../components/watchedTitleBadge.js";
import { renderLoadingIndicator } from "../../components/loadingIndicator.js";
import { getHomeRowKind, isRankedHomeRow } from "../home/homeRowKind.js";

const SEEALL_DESC_MAX = 460;

// A grade tem espaco lateral de sobra, entao o painel mostra bem mais texto que
// a ficha da home (que cabia em 4 linhas). Corte em palavra inteira: cortar
// glifo no meio e o erro classico de app de TV.
function buildSeeAllFacts(item = {}, descriptor = {}) {
  const tipoBruto = String(
    item.type || item.catalogType || descriptor.type || "movie"
  ).toLowerCase();
  const meta = [tipoBruto === "series" ? "Série" : "Filme"];
  const ano = extractReleaseYear(item);
  if (ano) {
    meta.push(String(ano));
  }
  const nota = Number(item.imdbRating);
  const rating = Number.isFinite(nota) && nota > 0 ? `IMDb ${item.imdbRating}` : "";
  const minutos = Number(item.runtimeMinutes ?? item.runtime ?? 0);
  if (Number.isFinite(minutos) && minutos > 0) {
    const h = Math.floor(minutos / 60);
    const m = Math.round(minutos % 60);
    meta.push(h > 0 ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`);
  }
  if (tipoBruto === "series" && item.status) {
    meta.push(String(item.status));
  }
  const generos = Array.isArray(item.genres) ? item.genres.filter(Boolean).slice(0, 4) : [];
  const bruto = String(item.description || item.overview || "").trim();
  let desc = bruto;
  if (bruto.length > SEEALL_DESC_MAX) {
    const fatia = bruto.slice(0, SEEALL_DESC_MAX);
    const ultimo = fatia.lastIndexOf(" ");
    desc = `${(ultimo > 80 ? fatia.slice(0, ultimo) : fatia).trim()}…`;
  }
  return { meta: meta.join(" • "), rating, genres: generos.join(" • "), desc };
}

const POSTER_HOLD_DELAY_MS = 650;

/**
 * The destination inherits the row's identity instead of inventing its own.
 *
 * `getHomeRowKind` reads the taxonomy straight out of the catalog id, and the
 * descriptor the door hands over already carries `addonId` + `catalogId` — so
 * this needs no new plumbing and no API call, and it cannot disagree with the
 * eyebrow the user just saw on the Home row.
 *
 * Measured before writing this: the grid itself is already right (six columns
 * of 291x442 at 1920x1080, flex-wrap fallback for Chromium 53, `skip=`
 * pagination and predictable initial focus all working). So this deliberately
 * does NOT rebuild the layout per kind — it only carries over what the row
 * already told the user: the category label, and chart numbering where the
 * position is real.
 */
function seeAllKindLabels() {
  return {
    streaming: t("home.rowKind.streaming", {}, "Streaming"),
    genre: t("home.rowKind.genre", {}, "Genre"),
    curated: t("home.rowKind.curated", {}, "Curated"),
    themed: t("home.rowKind.themed", {}, "Themed"),
    trending: t("home.rowKind.trending", {}, "Trending"),
    foryou: t("home.rowKind.foryou", {}, "For You"),
    collection: t("home.rowKind.collection", {}, "Collection")
  };
}

function isBackEvent(event) {
  return Environment.isBackEvent(event);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function extractReleaseYear(item = {}) {
  const candidates = [
    item?.released,
    item?.releaseDate,
    item?.release_date,
    item?.releaseInfo,
    item?.year
  ].filter(Boolean);

  for (const value of candidates) {
    const match = String(value).match(/\b(19|20)\d{2}\b/);
    if (match) {
      return match[0];
    }
  }

  return "";
}

function groupNodesByOffsetTop(nodes = []) {
  const grouped = [];
  nodes.forEach((node) => {
    const top = Math.round(node.offsetTop);
    const bucket = grouped.find((entry) => Math.abs(entry.top - top) <= 6);
    if (bucket) {
      bucket.nodes.push(node);
      return;
    }
    grouped.push({ top, nodes: [node] });
  });
  grouped.sort((left, right) => left.top - right.top);
  return grouped.map((entry) => entry.nodes);
}

function setContainerScrollTop(container, top, behavior = "auto") {
  if (!(container instanceof HTMLElement)) {
    return 0;
  }
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const resolvedTop = Math.max(0, Math.min(maxScrollTop, Number(top || 0)));
  if (behavior === "smooth") {
    if (typeof container.scrollTo === "function") {
      container.scrollTo({ top: resolvedTop, behavior: "smooth" });
    } else {
      container.scrollTop = resolvedTop;
    }
    return resolvedTop;
  }

  const previousBehavior = container.style.scrollBehavior;
  container.style.scrollBehavior = "auto";
  container.scrollTop = resolvedTop;
  void container.offsetHeight;
  container.style.scrollBehavior = previousBehavior;
  return resolvedTop;
}

function scrollNodeIntoContainerView(
  node,
  container,
  { center = false, padding = 18, behavior = "smooth" } = {}
) {
  if (!(node instanceof HTMLElement) || !(container instanceof HTMLElement)) {
    return null;
  }
  const itemTop = node.offsetTop;
  const itemBottom = itemTop + node.offsetHeight;
  const currentTop = container.scrollTop;
  const viewTop = currentTop + padding;
  const viewBottom = currentTop + container.clientHeight - padding;
  let nextScrollTop = currentTop;

  if (center) {
    nextScrollTop = itemTop - (container.clientHeight - node.offsetHeight) / 2;
  } else if (itemTop < viewTop) {
    nextScrollTop = itemTop - padding;
  } else if (itemBottom > viewBottom) {
    nextScrollTop = itemBottom - container.clientHeight + padding;
  }
  const resolvedTop = Math.max(0, nextScrollTop);
  if (Math.abs(resolvedTop - currentTop) <= 1) {
    return resolvedTop;
  }
  if (behavior === "smooth") {
    setContainerScrollTop(container, resolvedTop, "smooth");
  } else {
    setContainerScrollTop(container, resolvedTop, "auto");
  }
  return resolvedTop;
}

export const CatalogSeeAllScreen = {
  getRouteStateKey(params = {}) {
    const addonBaseUrl = String(params?.addonBaseUrl || "").trim();
    const catalogId = String(params?.catalogId || "").trim();
    const type = String(params?.type || "movie").trim() || "movie";
    if (!addonBaseUrl || !catalogId) {
      return null;
    }
    return `catalogSeeAll:${addonBaseUrl}:${catalogId}:${type}`;
  },

  captureRouteState() {
    this.captureViewState();
    return {
      params: this.params ? { ...this.params } : {},
      items: Array.isArray(this.items) ? [...this.items] : [],
      nextSkip: Number(this.nextSkip || 0),
      hasMore: Boolean(this.hasMore),
      lastFocusedKey: this.lastFocusedKey ? String(this.lastFocusedKey) : null,
      savedScrollTop: Number(this.savedScrollTop || 0)
    };
  },

  hydrateFromRouteState(restoredState = null, params = {}) {
    const snapshot = restoredState && typeof restoredState === "object" ? restoredState : null;
    if (!snapshot?.params) {
      return false;
    }
    const currentKey = this.getRouteStateKey(params);
    const snapshotKey = this.getRouteStateKey(snapshot.params);
    if (!currentKey || !snapshotKey || currentKey !== snapshotKey) {
      return false;
    }
    this.params = params || {};
    const snapshotItems = Array.isArray(snapshot.items) ? snapshot.items : [];
    this.items = this.layoutPrefs?.hideUnreleasedContent
      ? filterReleasedItems(snapshotItems)
      : [...snapshotItems];
    this.nextSkip = Number(snapshot.nextSkip || 0);
    this.hasMore = Boolean(snapshot.hasMore);
    this.lastFocusedKey = snapshot.lastFocusedKey ? String(snapshot.lastFocusedKey) : null;
    this.savedScrollTop = Number(snapshot.savedScrollTop || 0);
    this.pendingRestoreFocus = true;
    this.preserveViewportOnNextRender = false;
    return true;
  },

  async refreshWatchedTitleIds() {
    const watchedItems = await watchedItemsRepository.getAll(5000).catch(() => []);
    this.watchedTitleIds = buildWatchedTitleIdSet(watchedItems);
  },

  async mount(params = {}, navigationContext = {}) {
    this.container = document.getElementById("catalogSeeAll");
    ScreenUtils.show(this.container);
    this.params = params || {};
    this.layoutPrefs = LayoutPreferences.get();
    const initialItems = Array.isArray(params?.initialItems) ? params.initialItems : [];
    this.items = this.layoutPrefs?.hideUnreleasedContent
      ? filterReleasedItems(initialItems)
      : [...initialItems];
    // Usa o deslocamento que a home ja tinha em maos quando ele veio; senao
    // avanca pelo que REALMENTE veio, nunca por um tamanho de pagina suposto.
    // O `100` do upstream aqui era o bug: ver o comentario em loadMore().
    const initialNextSkip = Number(params?.initialNextSkip);
    this.nextSkip =
      Number.isFinite(initialNextSkip) && initialNextSkip > 0
        ? Math.trunc(initialNextSkip)
        : this.items.length;
    this.loading = false;
    this.hasMore = true;
    this.lastFocusedKey = this.items[0]?.id ? `item:${this.items[0].id}` : null;
    this.pendingRestoreFocus = false;
    this.preserveViewportOnNextRender = false;
    this.savedScrollTop = 0;
    this.loadToken = (this.loadToken || 0) + 1;
    this.posterOptionsController = null;
    this.posterOptionsFocusKey = "";
    this.pendingPosterHoldTarget = null;
    this.pendingPosterHoldTimer = null;
    await this.refreshWatchedTitleIds();

    if (
      navigationContext?.isBackNavigation &&
      this.hydrateFromRouteState(navigationContext?.restoredState || null, params)
    ) {
      this.loading = false;
      this.render();
      return;
    }

    this.render();
    if (!this.items.length) {
      await this.loadNextPage();
    }
  },

  async loadNextPage({ preserveViewport = false } = {}) {
    if (this.loading || !this.hasMore) {
      return;
    }
    const descriptor = this.params || {};
    if (!descriptor.addonBaseUrl || !descriptor.catalogId || !descriptor.type) {
      this.hasMore = false;
      this.render();
      return;
    }
    this.loading = true;
    this.captureViewState();
    this.pendingRestoreFocus = true;
    this.preserveViewportOnNextRender = Boolean(preserveViewport);
    if (!preserveViewport) {
      this.render();
    }
    const token = this.loadToken;
    const skip = Math.max(0, Number(this.nextSkip || 0));
    const result = await catalogRepository.getCatalog({
      addonBaseUrl: descriptor.addonBaseUrl,
      addonId: descriptor.addonId,
      addonName: descriptor.addonName,
      catalogId: descriptor.catalogId,
      catalogName: descriptor.catalogName,
      type: descriptor.type,
      skip,
      supportsSkip: true
    });
    if (token !== this.loadToken) {
      return;
    }
    if (result.status !== "success") {
      this.loading = false;
      this.hasMore = false;
      this.preserveViewportOnNextRender = false;
      this.render();
      return;
    }
    const rawIncoming = Array.isArray(result?.data?.items) ? result.data.items : [];
    const incoming = this.layoutPrefs?.hideUnreleasedContent
      ? filterReleasedItems(rawIncoming)
      : rawIncoming;
    let addedCount = 0;
    if (rawIncoming.length) {
      const seen = new Set(this.items.map((item) => item.id));
      incoming.forEach((item) => {
        if (!item?.id || seen.has(item.id)) {
          return;
        }
        seen.add(item.id);
        this.items.push(item);
        addedCount += 1;
      });
      // `skip + 100` assumia que toda pagina do addon tem 100 itens. Quando ela
      // vem menor — o "IMDb Top 250" devolveu 50 — a proxima requisicao parte de
      // um deslocamento maior do que o que foi lido e os itens do meio somem sem
      // aviso: a lista fica com buraco e ninguem percebe. Manifesto Stremio nao
      // declara tamanho de pagina, entao o unico numero confiavel e quanto veio.
      // A home ja fazia assim (homeScreen.js: `skip + incomingItems.length`).
      // O upstream (d51f350) passou a preferir o nextSkip que o addon reporta,
      // quando ele vem coerente; o calculo por quantidade lida fica de reserva.
      const reportedNextSkip = Number(result?.data?.nextSkip);
      this.nextSkip =
        Number.isFinite(reportedNextSkip) && reportedNextSkip > skip
          ? Math.trunc(reportedNextSkip)
          : skip + rawIncoming.length;
    }
    this.hasMore = rawIncoming.length > 0;
    this.loading = false;
    this.pendingRestoreFocus = true;
    this.preserveViewportOnNextRender = Boolean(preserveViewport && addedCount > 0);
    this.render();
  },

  captureViewState() {
    const shell = this.container?.querySelector(".seeall-shell");
    if (shell) {
      this.savedScrollTop = shell.scrollTop;
    }
    const focused = this.container?.querySelector(".seeall-card.focused");
    if (focused?.dataset?.focusKey) {
      this.lastFocusedKey = focused.dataset.focusKey;
    }
  },

  shouldAutoLoadMore(index) {
    if (this.loading || !this.hasMore) {
      return false;
    }
    const remaining = this.items.length - 1 - Number(index || 0);
    return remaining <= 10;
  },

  shouldAutoLoadMoreFromScroll(shell) {
    if (!(shell instanceof HTMLElement) || this.loading || !this.hasMore) {
      return false;
    }
    const remaining = shell.scrollHeight - (shell.scrollTop + shell.clientHeight);
    return remaining <= 640;
  },

  buildNavigationModel() {
    const cards = Array.from(this.container?.querySelectorAll(".seeall-card.focusable") || []);
    const rows = groupNodesByOffsetTop(cards);
    rows.forEach((rowNodes, rowIndex) => {
      rowNodes.forEach((node, colIndex) => {
        node.dataset.navRow = String(rowIndex);
        node.dataset.navCol = String(colIndex);
      });
    });
    this.navModel = { rows };
  },

  rememberRowFocus(node) {
    if (!node?.dataset) {
      return;
    }
    const row = Number(node.dataset.navRow || -1);
    const col = Number(node.dataset.navCol || 0);
    if (row < 0) {
      return;
    }
    this.rowFocusedIndexByRow = {
      ...(this.rowFocusedIndexByRow || {}),
      [row]: Math.max(0, col)
    };
  },

  resolvePreferredNodeForRow(rowNodes = []) {
    if (!Array.isArray(rowNodes) || !rowNodes.length) {
      return null;
    }
    const rowIndex = Number(rowNodes[0]?.dataset?.navRow || -1);
    const storedIndex = rowIndex >= 0 ? Number(this.rowFocusedIndexByRow?.[rowIndex]) : Number.NaN;
    const preferredIndex = Number.isFinite(storedIndex) ? storedIndex : 0;
    return rowNodes[Math.max(0, Math.min(rowNodes.length - 1, preferredIndex))] || rowNodes[0];
  },

  focusNode(target) {
    if (!target) {
      return false;
    }
    this.container?.querySelectorAll(".focusable.focused").forEach((node) => {
      if (node !== target) {
        node.classList.remove("focused");
      }
    });
    target.classList.add("focused");
    focusWithoutAutoScroll(target);
    this.lastFocusedKey = target.dataset.focusKey || this.lastFocusedKey;
    this.rememberRowFocus(target);
    const shell = this.container?.querySelector(".seeall-shell") || null;
    const isFirstRow = Number(target.dataset.navRow || 0) === 0;
    const shouldLoadMore = this.shouldAutoLoadMore(target.dataset.itemIndex);
    // Instant scroll on per-keypress focus: a smooth scrollTo restarts its easing
    // on every held-down repeat, so the view jittered and only caught up on release.
    const nextScrollTop = isFirstRow
      ? setContainerScrollTop(shell, 0, "auto")
      : scrollNodeIntoContainerView(target, shell, {
          center: false,
          padding: 20,
          behavior: "auto"
        });
    if (Number.isFinite(nextScrollTop)) {
      this.savedScrollTop = nextScrollTop;
    }
    if (shouldLoadMore) {
      this.loadNextPage({ preserveViewport: true });
    }
    return true;
  },

  handleGridDpad(event) {
    const code = Number(event?.keyCode || 0);
    const direction =
      code === 38
        ? "up"
        : code === 40
          ? "down"
          : code === 37
            ? "left"
            : code === 39
              ? "right"
              : null;
    if (!direction) {
      return false;
    }

    const nav = this.navModel;
    const current = this.container?.querySelector(".seeall-card.focused") || null;
    if (!nav?.rows?.length || !current) {
      return false;
    }

    event?.preventDefault?.();

    const row = Number(current.dataset.navRow || 0);
    const col = Number(current.dataset.navCol || 0);
    const rowNodes = nav.rows[row] || [];

    if (direction === "left") {
      return this.focusNode(rowNodes[col - 1] || current) || true;
    }

    if (direction === "right") {
      return this.focusNode(rowNodes[col + 1] || current) || true;
    }

    if (direction === "up" || direction === "down") {
      const delta = direction === "up" ? -1 : 1;
      const targetRowNodes = nav.rows[row + delta] || null;
      if (!targetRowNodes?.length) {
        if (direction === "up" && row === 0) {
          const shell = this.container?.querySelector(".seeall-shell") || null;
          this.savedScrollTop = setContainerScrollTop(shell, 0, "smooth");
        }
        return true;
      }
      return this.focusNode(this.resolvePreferredNodeForRow(targetRowNodes)) || true;
    }

    return false;
  },

  restoreFocusedCard({ scrollMode = "center" } = {}) {
    const shell = this.container?.querySelector(".seeall-shell");
    const target =
      (this.lastFocusedKey
        ? this.container?.querySelector(`.seeall-card[data-focus-key="${this.lastFocusedKey}"]`)
        : null) ||
      this.container?.querySelector(".seeall-card.focusable") ||
      null;

    if (shell) {
      this.savedScrollTop = setContainerScrollTop(shell, this.savedScrollTop, "auto");
    }

    if (!target) {
      return;
    }

    this.container?.querySelectorAll(".focusable.focused").forEach((node) => {
      if (node !== target) node.classList.remove("focused");
    });
    target.classList.add("focused");
    focusWithoutAutoScroll(target);
    this.rememberRowFocus(target);
    if (scrollMode !== "none") {
      scrollNodeIntoContainerView(target, shell, { center: scrollMode === "center", padding: 20 });
    }
    this.lastFocusedKey = target.dataset.focusKey || this.lastFocusedKey;
  },

  isPosterHoldTarget(node) {
    return Boolean(node?.matches?.(".seeall-card.focusable[data-action='openDetail']"));
  },

  cancelPendingPosterHold() {
    if (this.pendingPosterHoldTimer) {
      clearTimeout(this.pendingPosterHoldTimer);
      this.pendingPosterHoldTimer = null;
    }
    this.pendingPosterHoldTarget = null;
  },

  hasPendingPosterHold(node) {
    const pending = this.pendingPosterHoldTarget;
    if (!pending || !node) {
      return false;
    }
    return String(node.dataset.focusKey || "") === String(pending.focusKey || "");
  },

  startPendingPosterHold(node) {
    if (!this.isPosterHoldTarget(node)) {
      return false;
    }
    this.cancelPendingPosterHold();
    this.pendingPosterHoldTarget = {
      focusKey: String(node.dataset.focusKey || "")
    };
    this.pendingPosterHoldTimer = setTimeout(() => {
      this.pendingPosterHoldTimer = null;
      const current =
        this.container?.querySelector(".seeall-card.focusable.focused[data-action='openDetail']") ||
        null;
      if (!this.hasPendingPosterHold(current)) {
        return;
      }
      this.pendingPosterHoldTarget.holdTriggered = true;
      void this.openPosterOptionsMenu(current);
    }, POSTER_HOLD_DELAY_MS);
    return true;
  },

  completePendingPosterHold(node, event = null) {
    const pending = this.pendingPosterHoldTarget;
    if (!pending) {
      return false;
    }
    const holdTriggered = Boolean(pending.holdTriggered);
    const heldLongEnough = Number(event?.keyDownDurationMs || 0) >= POSTER_HOLD_DELAY_MS;
    const shouldOpenHoldMenu = !holdTriggered && heldLongEnough && this.hasPendingPosterHold(node);
    this.cancelPendingPosterHold();
    if (holdTriggered || shouldOpenHoldMenu) {
      if (shouldOpenHoldMenu) {
        void this.openPosterOptionsMenu(node);
      }
      return true;
    }
    if (!this.isPosterHoldTarget(node)) {
      return false;
    }
    this.openDetailFromNode(node);
    return true;
  },

  async openPosterOptionsMenu(node) {
    const item = posterItemFromNode(node, this.params?.type || "movie");
    if (!item?.id) {
      return false;
    }
    this.captureViewState();
    this.posterOptionsFocusKey = String(node.dataset.focusKey || this.lastFocusedKey || "");
    if (!this.posterOptionsController) {
      this.posterOptionsController = new PosterOptionsDialogController({
        onDetails: (target) => {
          Router.navigate("detail", {
            itemId: target.id,
            itemType: target.type || "movie",
            fallbackTitle: target.title || "Untitled",
            fallbackPoster: target.poster || "",
            fallbackBackground: target.background || "",
            fallbackLogo: target.logo || "",
            addonBaseUrl: target.addonBaseUrl || "",
            addonId: target.addonId || "",
            addonName: target.addonName || "",
            catalogType: target.catalogType || target.type || "movie"
          });
        },
        onDismiss: () => {
          this.lastFocusedKey = this.posterOptionsFocusKey || this.lastFocusedKey;
          this.posterOptionsFocusKey = "";
          this.pendingRestoreFocus = true;
          this.preserveViewportOnNextRender = true;
          this.render();
        },
        onChanged: (state) => {
          const itemId = String(state?.item?.id || "").trim();
          if (!itemId) {
            return;
          }
          const watchedTitleIds = new Set(this.watchedTitleIds || []);
          if (state.isWatched) {
            watchedTitleIds.add(itemId);
          } else {
            watchedTitleIds.delete(itemId);
          }
          this.watchedTitleIds = watchedTitleIds;
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
    if (!node) {
      return false;
    }
    Router.navigate("detail", {
      itemId: node.dataset.itemId,
      itemType: node.dataset.itemType || "movie",
      fallbackTitle: node.dataset.itemTitle || "Untitled",
      fallbackPoster: node.dataset.posterSrc || "",
      fallbackBackground: node.dataset.backdropSrc || "",
      fallbackLogo: node.dataset.logoSrc || "",
      addonBaseUrl: node.dataset.addonBaseUrl || "",
      addonId: node.dataset.addonId || "",
      addonName: node.dataset.addonName || "",
      catalogType: node.dataset.catalogType || node.dataset.itemType || "movie"
    });
    return true;
  },

  render() {
    const descriptor = this.params || {};
    const title = descriptor.catalogName || "Catalog";
    const cards = this.items.length
      ? this.items
          .map((item, index) => {
            // Uma vez por card. Estava sendo chamado quatro vezes — uma por
            // atributo — o que da 200 execucoes numa lista de 50 itens, toda
            // vez que a grade e remontada.
            const fatos = buildSeeAllFacts(item, descriptor);
            return `
          <article class="seeall-card focusable"
                   data-action="openDetail"
                   data-item-id="${item.id || ""}"
                    data-item-type="${item.type || item.catalogType || descriptor.type || "movie"}"
                   data-item-title="${escapeHtml(item.name || "Untitled")}"
                    data-poster-src="${escapeHtml(item.poster || "")}"
                    data-backdrop-src="${escapeHtml(item.background || item.backdrop || "")}"
                    data-logo-src="${escapeHtml(item.logo || "")}"
                    data-addon-base-url="${escapeHtml(descriptor.addonBaseUrl || item.addonBaseUrl || "")}"
                    data-addon-id="${escapeHtml(descriptor.addonId || item.addonId || "")}"
                    data-addon-name="${escapeHtml(descriptor.addonName || item.addonName || "")}"
                    data-catalog-type="${escapeHtml(descriptor.type || item.catalogType || "")}"
                    data-facts-meta="${escapeHtml(fatos.meta)}"
                    data-facts-rating="${escapeHtml(fatos.rating)}"
                    data-facts-genres="${escapeHtml(fatos.genres)}"
                    data-facts-desc="${escapeHtml(fatos.desc)}"
                    data-focus-key="item:${item.id || index}"
                    data-item-index="${index}">
            <div class="seeall-card-poster-wrap">
              ${
                item.poster
                  ? `<img class="seeall-card-poster-image" src="${escapeHtml(item.poster)}" alt="${escapeHtml(item.name || "content")}" loading="lazy" decoding="async" />`
                  : `<div class="seeall-card-poster placeholder"></div>`
              }
              ${isTitleItemWatched(item, this.watchedTitleIds) ? renderTitleWatchedBadge() : ""}
            </div>
            ${
              this.layoutPrefs?.posterLabelsEnabled !== false
                ? `
              <div class="seeall-card-title">${escapeHtml(item.name || "Untitled")}</div>
              <div class="seeall-card-year">${escapeHtml(extractReleaseYear(item))}</div>
            `
                : ""
            }
          </article>
        `;
          })
          .join("")
      : `<div class="seeall-empty">${escapeHtml(t("catalog_see_all_empty_title", {}, "No items available"))}</div>`;

    const catalogKind = getHomeRowKind({
      addonId: descriptor.addonId || "",
      catalogId: descriptor.catalogId || ""
    });
    const catalogRanked = isRankedHomeRow({
      addonId: descriptor.addonId || "",
      catalogId: descriptor.catalogId || ""
    });
    const kindLabel = catalogKind ? String(seeAllKindLabels()[catalogKind] || "").trim() : "";

    this.container.innerHTML = `
      <div class="seeall-shell"${catalogKind ? ` data-catalog-kind="${escapeHtml(catalogKind)}"` : ""}${catalogRanked ? ` data-catalog-ranked="true"` : ""}>
        <header class="seeall-header">
          ${kindLabel ? `<div class="seeall-eyebrow" aria-hidden="true">${escapeHtml(kindLabel)}</div>` : ""}
          <h2 class="seeall-title">${escapeHtml(title)}</h2>
          ${
            this.layoutPrefs?.catalogAddonNameEnabled !== false && descriptor.addonName
              ? `<div class="seeall-subtitle">${escapeHtml(t("catalog_see_all_from", [descriptor.addonName], "from %1$s"))}</div>`
              : ""
          }
        </header>
        <div class="seeall-body">
          <section class="seeall-grid">
            ${cards}
          </section>
          <aside class="seeall-detail" aria-hidden="true">
            <div class="seeall-detail-art">
              <img class="seeall-detail-backdrop" alt="" aria-hidden="true" decoding="async" />
              <div class="seeall-detail-art-scrim" aria-hidden="true"></div>
            </div>
            <img class="seeall-detail-logo" alt="" aria-hidden="true" decoding="async" />
            <div class="seeall-detail-title"></div>
            <div class="seeall-detail-rating"></div>
            <div class="seeall-detail-meta"></div>
            <div class="seeall-detail-genres"></div>
            <div class="seeall-detail-desc"></div>
            <div class="seeall-detail-source"></div>
          </aside>
        </div>
        ${
          this.loading
            ? `
          <div class="seeall-loading">
            ${renderLoadingIndicator()}
            <span>${escapeHtml(t("discover_loading", {}, "Loading..."))}</span>
          </div>
        `
            : ""
        }
      </div>
    `;

    ScreenUtils.indexFocusables(this.container);
    this.buildNavigationModel();
    this.bindCardEvents();
    this.bindShellEvents();
    if (this.pendingRestoreFocus) {
      const scrollMode = this.preserveViewportOnNextRender ? "none" : "center";
      this.pendingRestoreFocus = false;
      this.preserveViewportOnNextRender = false;
      this.restoreFocusedCard({ scrollMode });
      return;
    }
    ScreenUtils.setInitialFocus(this.container);
  },

  bindCardEvents() {
    this.container?.querySelectorAll(".seeall-card.focusable").forEach((node) => {
      if (node.__boundFocusHandlers) return;
      node.__boundFocusHandlers = true;
      node.addEventListener("focus", () => {
        this.lastFocusedKey = node.dataset.focusKey || this.lastFocusedKey;
        this.savedScrollTop = this.container?.querySelector(".seeall-shell")?.scrollTop || 0;
        this.updateDetailPanel(node);
      });
      node.addEventListener("mouseenter", () => {
        this.lastFocusedKey = node.dataset.focusKey || this.lastFocusedKey;
        this.updateDetailPanel(node);
      });
    });
  },

  // Painel lateral em vez de expandir a celula: numa GRADE, crescer um card
  // reflui as linhas de baixo a cada movimento do D-pad — layout completo e
  // caro nesta TV. O painel e um bloco fixo que so troca de texto, entao a
  // grade nunca se mexe e o modelo de foco fica intacto.
  updateDetailPanel(node) {
    const painel = this.container?.querySelector(".seeall-detail");
    if (!painel || !(node instanceof HTMLElement)) {
      return;
    }
    // A arte de fundo e o logo saem do proprio card (data-backdrop-src /
    // data-logo-src): nenhuma requisicao nova, e e o que preenche a coluna, que
    // antes ficava com um bloco de texto pequeno perdido no meio do vazio.
    // O catalogo NAO traz imdbRating, entao a nota fica vazia na maioria dos
    // itens — buscar meta a cada movimento do D-pad custaria rede e travaria a
    // navegacao, que ja esta lenta.
    const arte = painel.querySelector(".seeall-detail-backdrop");
    const backdrop = node.dataset.backdropSrc || "";
    if (arte) {
      if (arte.getAttribute("src") !== backdrop) {
        arte.setAttribute("src", backdrop);
      }
      arte.style.display = backdrop ? "" : "none";
    }
    const logo = painel.querySelector(".seeall-detail-logo");
    const logoSrc = node.dataset.logoSrc || "";
    if (logo) {
      if (logo.getAttribute("src") !== logoSrc) {
        logo.setAttribute("src", logoSrc);
      }
      logo.style.display = logoSrc ? "" : "none";
    }
    const campos = [
      // Com logo, o titulo em texto vira repeticao.
      [".seeall-detail-title", logoSrc ? "" : node.dataset.itemTitle || ""],
      [".seeall-detail-rating", node.dataset.factsRating || ""],
      [".seeall-detail-meta", node.dataset.factsMeta || ""],
      [".seeall-detail-genres", node.dataset.factsGenres || ""],
      [".seeall-detail-desc", node.dataset.factsDesc || ""],
      [".seeall-detail-source", node.dataset.addonName || ""]
    ];
    let algum = false;
    campos.forEach(([sel, texto]) => {
      const el = painel.querySelector(sel);
      if (!el) {
        return;
      }
      el.textContent = texto;
      el.style.display = texto ? "" : "none";
      if (texto) {
        algum = true;
      }
    });
    painel.classList.toggle("is-visible", algum || Boolean(backdrop) || Boolean(logoSrc));
  },

  bindShellEvents() {
    const shell = this.container?.querySelector(".seeall-shell") || null;
    if (!shell || shell.__catalogSeeAllShellBound) {
      return;
    }
    shell.__catalogSeeAllShellBound = true;
    shell.addEventListener(
      "scroll",
      () => {
        this.savedScrollTop = Number(shell.scrollTop || 0);
        if (this.shouldAutoLoadMoreFromScroll(shell)) {
          this.loadNextPage({ preserveViewport: true });
        }
      },
      { passive: true }
    );
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
    const focusedBeforeDpad = this.container?.querySelector(".focusable.focused") || null;
    if (code === 13 && this.isPosterHoldTarget(focusedBeforeDpad)) {
      event?.preventDefault?.();
      if (!event?.repeat && !this.hasPendingPosterHold(focusedBeforeDpad)) {
        this.startPendingPosterHold(focusedBeforeDpad);
      }
      return;
    }
    if (this.handleGridDpad(event)) {
      return;
    }
    if (code !== 13) {
      return;
    }
    const current = this.container.querySelector(".focusable.focused");
    if (!current) {
      return;
    }
    const action = String(current.dataset.action || "");
    if (action === "openDetail") {
      this.openDetailFromNode(current);
    }
  },

  onKeyUp(event) {
    if (Number(event?.keyCode || 0) !== 13) {
      return;
    }
    const current =
      this.container?.querySelector(".seeall-card.focusable.focused[data-action='openDetail']") ||
      null;
    if (this.completePendingPosterHold(current, event)) {
      event?.preventDefault?.();
    }
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
    ScreenUtils.hide(this.container);
  }
};
