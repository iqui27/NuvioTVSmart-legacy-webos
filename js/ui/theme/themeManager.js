import { MemberAccessRepository } from "../../data/remote/supabase/memberAccessRepository.js";
import { accentColorForTheme, ThemeStore } from "../../data/local/themeStore.js";
import { syncBrandWordmarks } from "../components/brandWordmark.js";
import { resolveThemeName } from "./themeAccess.js";
import { ThemeColors } from "./themeColors.js";
import { applyAppFontFamily } from "./appFontLoader.js";
import { resolveThemeVariables } from "./themeDerivations.js";
import { SUPPORTS_CSS_VARS } from "../../core/capabilities/cssVarsSupport.js";

// buildLegacyThemeCss/injectLegacyTheme (o subconjunto de regras escrito a mao
// para o 38) foram APOSENTADOS no commit das folhas de tema geradas: o build
// agora produz dist/css/theme-<nome>.css com TODAS as declaracoes dependentes
// de tema, derivadas de themeColors.js/themeDerivations.js — a mesma fonte que
// o runtime usa. Manter o subconjunto manual em paralelo seria uma segunda
// verdade que so diverge (ele cobria ~15 grupos de regras; as folhas cobrem
// todas), entao ele sai em vez de ser estendido.

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

const LEGACY_THEME_LINK_ID = "nuvioLegacyThemeSheet";
const LEGACY_AMOLED_LINK_ID = "nuvioLegacyAmoledSheet";

function setLegacyThemeLink(id, href) {
  let el = document.getElementById(id);
  if (!href) {
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }
    return;
  }
  if (!el) {
    el = document.createElement("link");
    el.id = id;
    el.rel = "stylesheet";
  }
  if (el.getAttribute("href") !== href) {
    el.setAttribute("href", href);
  }
  // Re-append mantem a folha por ULTIMO no <head>: as regras dela tem a mesma
  // especificidade das regras embutidas com o tema padrao, entao quem decide
  // e a ordem na cascata.
  document.head.appendChild(el);
}

/**
 * Troca de tema sem custom properties: alterna a folha gerada pelo build
 * (dist/css/theme-<nome>.css) em vez de setProperty, que no Chromium 38 e
 * no-op. AMOLED empilha uma folha de override por cima — os overrides sao
 * preto literal, iguais para todas as paletas, entao 2 folhas cobrem todas
 * as combinacoes (mesma decisao do buildThemeSheets em scripts/build.mjs).
 */
function applyLegacyThemeSheets(themeName, theme) {
  setLegacyThemeLink(LEGACY_THEME_LINK_ID, `css/theme-${String(themeName).toLowerCase()}.css`);
  const amoledHref = theme.amoledMode
    ? theme.amoledSurfacesMode
      ? "css/theme-amoled-surfaces.css"
      : "css/theme-amoled.css"
    : "";
  setLegacyThemeLink(LEGACY_AMOLED_LINK_ID, amoledHref);
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

    // No webOS 4 (Chromium 53) SUPPORTS_CSS_VARS e true e nada disto roda:
    // o caminho de setProperty acima segue sendo o unico mecanismo la.
    if (!SUPPORTS_CSS_VARS) {
      applyLegacyThemeSheets(themeName, theme);
    }
  }
};
