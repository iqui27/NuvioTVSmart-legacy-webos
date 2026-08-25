(function detectLegacyFeatureSupport(window, document) {
  "use strict";

  var root = document.documentElement;

  // This build targets a single device: LG webOS 4.x (Chromium 53). None of the
  // gated features exist there, so the legacy path is pinned on instead of
  // probed. Probing would leave layout at the mercy of a partial implementation
  // reporting support it cannot deliver, and it makes what renders locally
  // differ from what renders on the TV. Append ?modernFeatures=1 to run the
  // probes again when checking this build on a current engine.
  var LEGACY_CLASSES = [
    "no-flex-gap",
    "no-css-grid",
    "no-css-math",
    "no-aspect-ratio",
    "no-backdrop-filter",
    // Custom properties (Chrome 49): ausentes no Chromium 38 do webOS 3. O CSS
    // ja chega com var() resolvido pelo build; esta classe existe para o JS de
    // runtime (troca de tema por folha, estilos inline) e para regras que
    // precisem divergir por engine.
    "no-css-vars"
  ];

  function removeClass(name) {
    root.className = (" " + root.className + " ")
      .replace(new RegExp(" " + name + " ", "g"), " ")
      .replace(/^\s+|\s+$/g, "");
  }

  function hasClass(name) {
    return (" " + root.className + " ").indexOf(" " + name + " ") !== -1;
  }

  function addClass(name) {
    if (!hasClass(name)) {
      root.className = (root.className + " " + name).replace(/^\s+|\s+$/g, "");
    }
  }

  function probesRequested() {
    try {
      return String(window.location && window.location.search).indexOf("modernFeatures=1") !== -1;
    } catch (error) {
      return false;
    }
  }

  if (!probesRequested()) {
    for (var i = 0; i < LEGACY_CLASSES.length; i += 1) {
      addClass(LEGACY_CLASSES[i]);
    }
    return;
  }

  function supports(prop, value) {
    var css = window.CSS;
    return Boolean(css && typeof css.supports === "function" && css.supports(prop, value));
  }

  try {
    var test = document.createElement("div");
    var child = document.createElement("div");
    test.style.position = "absolute";
    test.style.left = "-9999px";
    test.style.top = "-9999px";
    test.style.display = "flex";
    test.style.flexDirection = "column";
    test.style.rowGap = "1px";
    child.style.height = "1px";
    test.appendChild(child.cloneNode());
    test.appendChild(child.cloneNode());
    root.appendChild(test);
    if (test.scrollHeight === 3) {
      removeClass("no-flex-gap");
    }
    root.removeChild(test);
  } catch (error) {
    removeClass("no-flex-gap");
  }

  if (
    supports("display", "grid") &&
    supports("grid-template-columns", "repeat(2, minmax(0, 1fr))")
  ) {
    removeClass("no-css-grid");
  }
  if (supports("font-size", "clamp(1px, 2px, 3px)")) removeClass("no-css-math");
  if (supports("aspect-ratio", "1 / 1")) removeClass("no-aspect-ratio");
  if (
    supports("backdrop-filter", "blur(1px)") ||
    supports("-webkit-backdrop-filter", "blur(1px)")
  ) {
    removeClass("no-backdrop-filter");
  }
  // Mesma sonda de js/core/capabilities/cssVarsSupport.js — mantidas iguais
  // para a classe e o modulo nunca discordarem.
  if (supports("--probe", "0")) {
    removeClass("no-css-vars");
  }
})(window, document);
