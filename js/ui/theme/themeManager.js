import { MemberAccessRepository } from "../../data/remote/supabase/memberAccessRepository.js";
import { accentColorForTheme, ThemeStore } from "../../data/local/themeStore.js";
import { syncBrandWordmarks } from "../components/brandWordmark.js";
import { resolveThemeName } from "./themeAccess.js";
import { ThemeColors } from "./themeColors.js";
import { applyAppFontFamily } from "./appFontLoader.js";
import { resolveThemeVariables, toRgbChannels, toLegacyRgbChannels } from "./themeDerivations.js";

// Cached once at module load so the theme can retain its capability fallback.
const SUPPORTS_CSS_VARS =
  typeof window !== "undefined" &&
  !!window.CSS &&
  typeof window.CSS.supports === "function" &&
  window.CSS.supports("--probe", "0");

/**
 * Pure function — no DOM access. Returns a CSS string for legacy engines that
 * do not support CSS custom properties (e.g. Chromium 38 / webOS 3.x).
 *
 * colorMap keys:
 *   bg, bgElevated, cardBg, secondary, onSecondary,
 *   focusColor, focusBg, text, textSecondary, textTertiary, border
 *
 * @param {{ bg:string, bgElevated:string, cardBg:string, secondary:string,
 *           onSecondary:string, focusColor:string, focusBg:string,
 *           text:string, textSecondary:string, textTertiary:string,
 *           border:string }} colorMap
 * @returns {string}
 */
export function buildLegacyThemeCss(colorMap) {
  const { bg, bgElevated, cardBg, secondary, onSecondary, focusColor, focusBg, text, border } =
    colorMap;

  return [
    // 1. Base document surfaces
    `html, body { background: ${bg}; color: ${text}; }`,

    // 2. Full-screen shells (AMOLED: bg → true black)
    `.home-shell, .home-sidebar, .home-main, .profile-screen, .search-screen-shell,` +
      ` .discover-shell, .library-shell { background: ${bg}; }`,

    // 3. Elevated surfaces (cards, dialogs, panels)
    `.account-info, .sync-card, .status-card, .profile-editor-panel,` +
      ` .nuvio-dialog-panel { background: ${bgElevated}; }`,

    // 4. Card/input surfaces
    `.card, .account-settings-card, .search-input-field,` +
      ` .library-action-button { background: ${cardBg}; }`,

    // 5. Sidebar surfaces must use the same palette as the route background.
    `.modern-sidebar-panel, .modern-sidebar-pill-chip,` +
      ` .modern-sidebar-shell.blur-enabled .modern-sidebar-panel,` +
      ` .modern-sidebar-shell.blur-enabled .modern-sidebar-pill-chip,` +
      ` .no-backdrop-filter .modern-sidebar-shell.blur-enabled .modern-sidebar-panel,` +
      ` .no-backdrop-filter .modern-sidebar-shell.blur-enabled .modern-sidebar-pill-chip {` +
      ` background: ${bgElevated}; border-color: ${border}; }`,

    // 6. Accent-fill surfaces (secondary color)
    `.profile-overlay-button-primary,` +
      ` .home-sidebar.content-expanded .home-nav-item.selected,` +
      ` .modern-sidebar-nav-item.selected,` +
      ` .modern-sidebar-nav-item.selected.focused,` +
      ` .library-picker-option.focused,` +
      ` .library-watched-badge { background: ${secondary}; color: ${onSecondary}; }`,

    `.modern-sidebar-nav-icon-circle, .modern-sidebar-pill-icon-wrap {` +
      ` background: ${focusBg}; }`,
    `.modern-sidebar-nav-item.selected .modern-sidebar-nav-icon-circle,` +
      ` .modern-sidebar-nav-item.selected.focused .modern-sidebar-nav-icon-circle {` +
      ` background: ${secondary}; color: ${onSecondary}; }`,

    // 7. Focus rings — structures copied verbatim from components.css,
    //    only the color token values are substituted.

    // .auth-simple-card.focused / .account-settings-card.focused
    // Source: components.css line 290-294 → box-shadow: 0 0 0 2px var(--focus-color)
    `.auth-simple-card.focused,` +
      ` .account-settings-card.focused {` +
      ` background: ${focusBg}; box-shadow: 0 0 0 2px ${focusColor}; }`,

    // .profile-avatar-tile.focused
    // Source: components.css line 1278-1279 → box-shadow: inset 0 0 0 0.3125vw var(--focus-color)
    `.profile-avatar-tile.is-selected,` +
      ` .profile-avatar-tile.focused { box-shadow: inset 0 0 0 0.3125vw ${focusColor}; }`,

    // .library-grid-card.focused .library-grid-poster
    // Source: components.css line 3590-3593 → box-shadow: 0 0 0 4px var(--focus-color)
    `.library-grid-card.focused .library-grid-poster {` +
      ` box-shadow: 0 0 0 4px ${focusColor}; background-color: ${focusBg}; border-color: ${focusColor}; }`,

    // .library-action-button.focused (standalone, not in .library-actions-row context)
    // Source: components.css line 3520-3528 → box-shadow: 0 0 0 2px var(--focus-color)
    `.library-action-button.focused {` +
      ` border-color: ${focusColor}; box-shadow: 0 0 0 2px ${focusColor}; background: ${focusBg}; }`
  ].join("\n");
}

const LEGACY_STYLE_ID = "nuvio-legacy-theme";
let memberAccessSubscriptionReady = false;
let initialMemberAccessObserved = false;

function ensureMemberAccessSubscription() {
  if (memberAccessSubscriptionReady) return;
  memberAccessSubscriptionReady = true;
  MemberAccessRepository.subscribe((access) => {
    if (!initialMemberAccessObserved) {
      initialMemberAccessObserved = true;
      return;
    }
    if (typeof document !== "undefined") {
      ThemeManager.apply({ enforceAccess: true, access });
    }
  });
}

function injectLegacyTheme(css) {
  let el = document.getElementById(LEGACY_STYLE_ID);
  if (!el) {
    el = document.createElement("style");
    el.id = LEGACY_STYLE_ID;
  }
  el.textContent = css;
  // Re-append keeps it LAST in <head> so equal-specificity rules win
  // over the baked static fallback.
  document.head.appendChild(el);
}

export const ThemeManager = {
  apply({ enforceAccess = false, access = null } = {}) {
    ensureMemberAccessSubscription();
    const storedTheme = ThemeStore.get();
    const themeName = enforceAccess
      ? resolveThemeName(storedTheme.themeName, access || MemberAccessRepository.getCurrentAccess())
      : String(storedTheme.themeName || "WHITE").toUpperCase();
    const theme =
      themeName === storedTheme.themeName
        ? storedTheme
        : {
            ...storedTheme,
            themeName,
            accentColor: accentColorForTheme(themeName)
          };
    // AMOLED e as derivadas moram em themeDerivations.js porque o build precisa
    // das MESMAS regras para gerar as folhas de tema da variante webOS 3, onde
    // custom properties nao existem.
    const themeVariables = resolveThemeVariables(ThemeColors.getPalette(theme.themeName), {
      amoledMode: theme.amoledMode,
      amoledSurfacesMode: theme.amoledSurfacesMode
    });

    Object.entries(themeVariables).forEach(([key, value]) => {
      document.documentElement.style.setProperty(key, value);
    });

    // Writes --app-font-family with the local fallback stack immediately and
    // upgrades it to the web font after first paint, if and when it downloads.
    applyAppFontFamily(theme.fontFamily);
    document.documentElement.dataset.nuvioTheme = themeName;
    syncBrandWordmarks(themeName);
    document.documentElement.style.setProperty("color-scheme", "dark");

    if (!SUPPORTS_CSS_VARS) {
      const colorMap = {
        bg: themeVariables["--bg-color"],
        bgElevated: themeVariables["--bg-elevated"],
        cardBg: themeVariables["--card-bg"],
        secondary: themeVariables["--secondary-color"],
        onSecondary: themeVariables["--on-secondary"],
        focusColor: themeVariables["--focus-color"],
        focusBg: themeVariables["--focus-bg"],
        text: themeVariables["--text-color"],
        textSecondary: themeVariables["--text-secondary"],
        textTertiary: themeVariables["--text-tertiary"],
        border: themeVariables["--border-color"]
      };
      injectLegacyTheme(buildLegacyThemeCss(colorMap));
    }
  }
};
