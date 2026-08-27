import { cp, mkdir, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import coreJsCompat from "core-js-compat";
import postcssGlobalData from "@csstools/postcss-global-data";
import postcss from "postcss";
import cssnano from "cssnano";
import autoprefixer from "autoprefixer";
import { readAppMetadata, syncVersionFiles } from "./appMetadata.mjs";
import { compatibilityPolicy } from "./compatibilityPolicy.mjs";
import { writeRuntimeEnvScriptFile } from "./envProperties.mjs";
import { buildI18nBundles } from "./i18nBundle.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const requireConfiguredRuntimeEnv = /^(1|true|yes|on)$/i.test(
  String(process.env.NUVIO_REQUIRE_LOCAL_PROPERTIES || "")
);
const debugBundle = /^(1|true|yes|on)$/i.test(String(process.env.NUVIO_DEBUG_BUNDLE || ""));

/**
 * Global UI scale, applied at build time.
 *
 * It has to be a build step, not a runtime setting. Two runtime mechanisms were
 * measured on an LG OLED65C9 and both failed: `zoom` is reported as supported by
 * CSS.supports() and then ignored outright, and the "enlarge the logical canvas,
 * shrink it with transform" trick breaks because the stylesheet mixes 4742 px
 * lengths with 852 vw/vh ones — viewport units resolve against the viewport, not
 * the scaled parent, so they refuse to grow with the canvas and the page ends up
 * scaled twice (0.85 x 0.85) with the layout no longer filling the screen.
 *
 * Scaling every px and vw/vh value here moves both families together, which is
 * the only uniform result available. Percentages are left alone: they are already
 * relative.
 */
const uiScale = (() => {
  const raw = String(process.env.NUVIO_UI_SCALE || "").trim();
  if (!raw) {
    return 1;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0.4 || value > 1.5) {
    throw new Error(`NUVIO_UI_SCALE fora da faixa util (0.4 a 1.5): ${raw}`);
  }
  return value;
})();

// Scaling these would change meaning, not size.
const UI_SCALE_SKIPPED_PROPERTIES = new Set([
  "background-position",
  "background-size",
  "object-position",
  "transform-origin",
  "perspective-origin",
  "stroke-width",
  "flex",
  "flex-basis"
]);

function uiScalePlugin(scale) {
  return {
    postcssPlugin: "nuvio-ui-scale",
    // OnceExit, not the Declaration visitor: PostCSS 8 re-visits a declaration
    // whose value the visitor mutated, so scaling inside Declaration compounds on
    // every pass. Measured: a 52px font-size came out as 0.0003px.
    OnceExit(root) {
      if (scale === 1) {
        return;
      }
      root.walkDecls((decl) => {
        if (UI_SCALE_SKIPPED_PROPERTIES.has(decl.prop.toLowerCase())) {
          return;
        }
        if (decl.value.indexOf("url(") !== -1) {
          return;
        }
        // Only px. Viewport units are the STRUCTURAL layer — they are already
        // proportional to the screen, and scaling them fights the layout instead of
        // resizing it. Measured on the C9: `.home-hero-copy { bottom: 52vh }`
        // reserves exactly the band where the row viewport starts (JS puts it at
        // top: 48% of the viewport, which no CSS pass can scale). Scaling that 52vh
        // to 41.6vh grew the hero copy 112px downward and dropped its description
        // on top of the first row title. px is the size layer, vw/vh is the frame.
        const scaled = decl.value.replace(/(-?\d*\.?\d+)px\b/g, (match, number) => {
          const next = Number(number) * scale;
          if (!Number.isFinite(next)) {
            return match;
          }
          // Four decimals is finer than the engine resolves and keeps cssnano
          // from rounding a sub-pixel border away to zero.
          return `${Number(next.toFixed(4))}px`;
        });
        if (scaled !== decl.value) {
          decl.value = scaled;
        }
      });
    }
  };
}
uiScalePlugin.postcss = true;
const legacyViewport = {
  width: 1920,
  height: 1080,
  remPx: 20
};
const rgbVariableFallbacks = {
  "--bg-color-rgb": "13 13 13",
  "--bg-elevated-rgb": "26 26 26",
  "--card-bg-rgb": "34 34 34",
  "--secondary-color-rgb": "245 245 245",
  "--focus-color-rgb": "255 255 255"
};

function splitTopLevelSpaces(value) {
  const parts = [];
  let current = "";
  let depth = 0;

  for (const char of value) {
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    }

    if (/\s/.test(char) && depth === 0) {
      if (current.trim()) {
        parts.push(current.trim());
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function splitFunctionArgs(value) {
  const args = [];
  let current = "";
  let depth = 0;

  for (const char of value) {
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    }

    if (char === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    args.push(current.trim());
  }

  return args;
}

function toLegacyLengthValue(value) {
  let result = value.trim();
  let changed = true;

  while (changed) {
    changed = false;
    result = result.replace(
      /\b(min|max|clamp)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g,
      (match, fn, argsText) => {
        const args = splitFunctionArgs(argsText).map(toLegacyLengthValue);
        const computed = computeLegacyMathValue(fn, args);
        const replacement =
          computed ||
          (fn === "clamp" ? args[2] || args[1] || args[0] : chooseStaticMathFallback(fn, args));
        changed = true;
        return replacement || match;
      }
    );
  }

  return result;
}

function parseLengthToPx(value) {
  const match = String(value || "")
    .trim()
    .match(/^(-?\d*\.?\d+)(px|vw|vh|rem)$/i);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(amount)) {
    return null;
  }
  if (unit === "px") {
    return amount;
  }
  if (unit === "vw") {
    return (amount * legacyViewport.width) / 100;
  }
  if (unit === "vh") {
    return (amount * legacyViewport.height) / 100;
  }
  if (unit === "rem") {
    return amount * legacyViewport.remPx;
  }
  return null;
}

function formatPx(value) {
  const rounded = Math.round(value * 1000) / 1000;
  return `${String(rounded)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1")}px`;
}

function computeLegacyMathValue(fn, args) {
  const values = args.map(parseLengthToPx);
  if (values.some((value) => value === null)) {
    return "";
  }

  if (fn === "min") {
    return formatPx(Math.min(...values));
  }
  if (fn === "max") {
    return formatPx(Math.max(...values));
  }
  if (fn === "clamp") {
    const min = values[0];
    const preferred = values[1] ?? min;
    const max = values[2] ?? preferred;
    return formatPx(Math.max(min, Math.min(max, preferred)));
  }
  return "";
}

function chooseStaticMathFallback(fn, args) {
  const parseable = args
    .map((value) => ({ value, px: parseLengthToPx(value) }))
    .filter((entry) => entry.px !== null);
  if (!parseable.length) {
    return args[args.length - 1] || "";
  }
  if (fn === "max") {
    return parseable.reduce((max, entry) => (entry.px > max.px ? entry : max), parseable[0]).value;
  }
  if (fn === "min") {
    return parseable.reduce((min, entry) => (entry.px < min.px ? entry : min), parseable[0]).value;
  }
  return args[2] || args[1] || args[0] || "";
}

function splitRgbChannels(channels) {
  const parts = String(channels || "")
    .trim()
    .split(/\s+/)
    .map((part) => Number(part));
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  return parts.slice(0, 3);
}

function toLegacyColorValue(value) {
  let result = String(value || "");

  result = result.replace(
    /\brgba?\(\s*var\((--[\w-]+)\)\s*\/\s*([^)]+?)\s*\)/g,
    (match, variableName, alpha) => {
      const channels = splitRgbChannels(rgbVariableFallbacks[variableName]);
      if (!channels) {
        return match;
      }
      return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha.trim()})`;
    }
  );

  result = result.replace(
    /\brgba?\(\s*(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s*\/\s*([^)]+?)\s*\)/g,
    (_match, red, green, blue, alpha) => `rgba(${red}, ${green}, ${blue}, ${alpha.trim()})`
  );

  return result;
}

function insertInsetFallbacks(decl) {
  if (decl.prop.toLowerCase() !== "inset") {
    return;
  }

  const values = splitTopLevelSpaces(decl.value);
  if (!values.length || values.length > 4) {
    return;
  }

  const top = values[0];
  const right = values[1] || top;
  const bottom = values[2] || top;
  const left = values[3] || right;
  const fallbacks = [
    ["top", top],
    ["right", right],
    ["bottom", bottom],
    ["left", left]
  ];

  for (const [prop, value] of fallbacks) {
    decl.cloneBefore({ prop, value });
  }
}

// `width: min(100%, 440px)` is a percentage that never exceeds a cap. The
// generic math fallback cannot evaluate the percentage — it has no containing
// block — so it drops that side and emits the bare cap, turning a fluid width
// into a fixed one that overflows a narrow parent. The two-declaration form
// says the same thing in CSS every engine has understood for decades.
const SIZE_PROPS_WITH_MAX = new Map([
  ["width", "max-width"],
  ["height", "max-height"]
]);

function insertMinPercentSizeFallback(decl) {
  const prop = decl.prop.toLowerCase();
  const maxProp = SIZE_PROPS_WITH_MAX.get(prop);
  if (!maxProp) {
    return false;
  }

  const match = /^min\(([\s\S]*)\)$/i.exec(decl.value.trim());
  if (!match) {
    return false;
  }

  const args = splitFunctionArgs(match[1]).map((arg) => arg.trim());
  if (args.length !== 2) {
    return false;
  }

  const percentIndex = args.findIndex((arg) => /^\d+(?:\.\d+)?%$/.test(arg));
  if (percentIndex === -1) {
    return false;
  }

  const cap = toLegacyLengthValue(args[percentIndex === 0 ? 1 : 0]);
  if (!cap || /^(min|max|clamp)\(/i.test(cap)) {
    return false;
  }

  const previous = decl.prev();
  if (previous && previous.type === "decl" && previous.prop === maxProp) {
    return true;
  }

  decl.cloneBefore({ prop: prop, value: args[percentIndex] });
  decl.cloneBefore({ prop: maxProp, value: cap });
  return true;
}

function legacyDeclarationFallbackPlugin() {
  return {
    postcssPlugin: "nuvio-legacy-declaration-fallbacks",
    Declaration(decl) {
      insertInsetFallbacks(decl);

      if (insertMinPercentSizeFallback(decl)) {
        return;
      }

      const legacyValue = toLegacyColorValue(toLegacyLengthValue(decl.value));
      if (legacyValue && legacyValue !== decl.value) {
        // Custom property: SUBSTITUIR, nunca clonar antes.
        //
        // A tecnica de fallback (declaracao estatica antes da moderna) so
        // funciona em propriedade normal, onde o motor REJEITA o valor que nao
        // entende e a declaracao anterior prevalece. Custom property nao valida
        // conteudo: `--x: clamp(...)` e guardado como texto mesmo num motor sem
        // clamp(), entao a declaracao moderna sempre vence a estatica, e a
        // falha so aparece la na frente, no `var()`, onde vira valor invalido e
        // a propriedade cai para o inicial.
        //
        // MEDIDO na OLED65C9 (Chromium 53, CSS.supports('width','clamp(...)')
        // === false): 13 de 15 tokens devolviam a string do clamp em
        // getComputedStyle — --tv-safe-gutter, --tv-title-text, --tv-body-text,
        // --tv-button-height, --tv-card-gap e companhia. Ou seja a escala de
        // tipografia, os espacamentos e as margens de seguranca inteiras
        // estavam sem valor nessa TV. O sintoma visivel foi o overlay de pausa
        // colado na borda, sem margem.
        if (decl.prop.startsWith("--")) {
          decl.value = legacyValue;
          return;
        }
        const previous = decl.prev();
        if (
          !previous ||
          previous.type !== "decl" ||
          previous.prop !== decl.prop ||
          previous.value !== legacyValue
        ) {
          decl.cloneBefore({ value: legacyValue });
        }
      }
    }
  };
}

legacyDeclarationFallbackPlugin.postcss = true;

function unsupportedSelectorFallbackPlugin() {
  return {
    postcssPlugin: "nuvio-unsupported-selector-fallbacks",
    Rule(rule) {
      if (!rule.selector || !rule.selectors?.length) {
        return;
      }

      const safeSelectors = rule.selectors.filter(
        (selector) => !selector.includes(":focus-visible") && !selector.includes(":has(")
      );
      if (!safeSelectors.length || safeSelectors.length === rule.selectors.length) {
        return;
      }

      const fallback = rule.clone({ selectors: safeSelectors });
      rule.before(fallback);
    }
  };
}

unsupportedSelectorFallbackPlugin.postcss = true;

// Chromium 53 has no flex `gap`, so every `display:flex` rule with a gap gets a
// margin fallback scoped to `html.no-flex-gap` -- a class hardcoded into the <html>
// element for webOS, so all of these rules are always live.
//
// The default fallback shape is `<container> > * + *`. That is the expensive one: a
// rule's rightmost compound selector decides which bucket Blink's style engine files
// it under, and a rightmost `*` files it under the UNIVERSAL bucket, which is tested
// against every element in the document on every style recalc. It also means inserting
// one child invalidates its siblings, which is exactly what a TV home screen does
// while rows stream in.
//
// A container can opt out of the universal shape by naming the class its children
// carry:
//
//   .home-track {
//     display: flex;
//     gap: 24px;
//     --nuvio-flex-gap-child: home-track-item;
//   }
//
// which emits `<container> > .home-track-item + .home-track-item` instead. Same
// spacing semantics, but the rule moves from the universal bucket into a class
// bucket, so it is only ever tested against elements that actually carry the class.
// The declaration is stripped from the output, so nothing extra ships to the TV.
//
// MIGRATION ORDER MATTERS -- get this backwards and spacing silently disappears:
//   1. First make EVERY generator of that container's children stamp the class. If the
//      children are built in more than one place, all of them must be updated, or the
//      ones that were missed lose their margin with no build error and no console
//      warning.
//   2. Only then add `--nuvio-flex-gap-child` to the CSS rule.
// If you cannot enumerate every generator with confidence, leave the container on the
// default `> * + *` shape. A correct expensive selector beats a cheap wrong one.
const FLEX_GAP_CHILD_PROP = "--nuvio-flex-gap-child";
const FLEX_GAP_CHILD_PATTERN = /^-?[_a-zA-Z][\w-]*$/;

function flexGapFallbackPlugin() {
  return {
    postcssPlugin: "nuvio-flex-gap-fallback",
    Rule(rule) {
      if (
        !rule.selector ||
        (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name))
      ) {
        return;
      }

      let displayFlex = false;
      let rowGap = null;
      let columnGap = null;
      let flexDirection = "row";
      let flexWrap = "nowrap";
      let childClass = null;
      let childClassDecl = null;

      rule.walkDecls((decl) => {
        const prop = decl.prop.toLowerCase();
        if (prop === FLEX_GAP_CHILD_PROP) {
          const value = decl.value.trim().replace(/^\.+/, "");
          // Fail the build rather than silently emitting a selector that matches
          // nothing -- a typo here would drop the container's spacing on the TV with
          // no other symptom.
          if (!FLEX_GAP_CHILD_PATTERN.test(value)) {
            throw decl.error(
              `${FLEX_GAP_CHILD_PROP} must be a single CSS class name, got "${decl.value}".`
            );
          }
          childClass = value;
          childClassDecl = decl;
          return;
        }
        if (prop === "display" && /\b(?:inline-)?flex\b/.test(decl.value)) {
          displayFlex = true;
          return;
        }

        if (prop === "flex-direction") {
          flexDirection = decl.value.toLowerCase();
          return;
        }

        if (prop === "flex-wrap") {
          flexWrap = decl.value.toLowerCase();
          return;
        }

        if (prop === "flex-flow") {
          const value = decl.value.toLowerCase();
          if (value.includes("column")) {
            flexDirection = "column";
          }
          if (value.includes("wrap")) {
            flexWrap = "wrap";
          }
          return;
        }

        if (prop === "gap") {
          const values = splitTopLevelSpaces(decl.value).map(toLegacyLengthValue);
          rowGap = values[0] || "0";
          columnGap = values[1] || rowGap;
          return;
        }

        if (prop === "row-gap") {
          rowGap = toLegacyLengthValue(decl.value);
          return;
        }

        if (prop === "column-gap") {
          columnGap = toLegacyLengthValue(decl.value);
        }
      });

      // The opt-in declaration is build-time metadata only; never ship it.
      if (childClassDecl) {
        childClassDecl.remove();
      }

      if (!displayFlex || (!rowGap && !columnGap)) {
        return;
      }

      rowGap ||= "0";
      columnGap ||= "0";

      // gap: 0 nao precisa de emulacao — e emitir o fallback mesmo assim faz
      // dano. A regra gerada (`html.no-flex-gap <sel> > * + *`) tem
      // especificidade maior que a de qualquer filho por classe, entao um
      // `margin-left: 0` vindo daqui APAGA margem que o autor definiu no filho.
      //
      // Caso real: `.series-insight-tabs { gap: 0 }` (o container zera o gap de
      // proposito porque `.series-insight-divider` traz `margin: 0 10px`). No
      // legado o fallback zerava a margem ESQUERDA do separador e deixava a
      // direita, entao o "|" colava na palavra anterior e o vao inteiro ia para
      // depois dele. Medido no bench a 1920px: vaos 0, 20, 0, 20, 0, 20.
      const rowGapZero = /^0(?:[a-z%]*)?$/i.test(rowGap.trim());
      const columnGapZero = /^0(?:[a-z%]*)?$/i.test(columnGap.trim());
      if (rowGapZero && columnGapZero) {
        return;
      }

      const scopedSelectors = rule.selectors.map((selector) => `html.no-flex-gap ${selector}`);
      const isColumnDirection = flexDirection.includes("column");
      const wraps = flexWrap.includes("wrap") && !flexWrap.includes("nowrap");
      // `*` stays in the universal bucket; `.child` moves the rule into a class bucket.
      const child = childClass ? `.${childClass}` : "*";
      const childFallback = postcss.rule({
        selectors: scopedSelectors.map((selector) => `${selector} > ${child} + ${child}`)
      });

      if (isColumnDirection) {
        childFallback.append({ prop: "margin-top", value: rowGap });
      } else if (wraps) {
        childFallback.selectors = scopedSelectors.map((selector) => `${selector} > ${child}`);
        childFallback.append({ prop: "margin-right", value: columnGap });
        childFallback.append({ prop: "margin-bottom", value: rowGap });
      } else {
        childFallback.append({ prop: "margin-left", value: columnGap });
      }

      rule.after(childFallback);
    }
  };
}

flexGapFallbackPlugin.postcss = true;

function splitTopLevelCommas(value) {
  const parts = [];
  let current = "";
  let depth = 0;

  for (const char of value) {
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    }

    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

// Chromium below 57 has no unprefixed CSS Grid. Every `display: grid` rule gets a
// flexbox twin scoped to html.no-css-grid so 2019 webOS panels keep their layout.
const GRID_FR_PATTERN = /^([0-9.]*)fr$/i;

function describeGridTrack(track) {
  const value = String(track || "").trim();
  const frMatch = GRID_FR_PATTERN.exec(value);

  if (frMatch) {
    return { grow: Number(frMatch[1] || "1") || 1, basis: "0%", minWidth: "0" };
  }

  const minmaxMatch = /^minmax\(([\s\S]*)\)$/i.exec(value);
  if (minmaxMatch) {
    const args = splitTopLevelCommas(minmaxMatch[1]);
    const min = (args[0] || "0").trim();
    const max = (args[1] || "auto").trim();
    const maxFr = GRID_FR_PATTERN.exec(max);
    const minIsZero = /^0(?:px|rem|em|%|vw|vh)?$/i.test(min);

    if (maxFr) {
      return {
        grow: Number(maxFr[1] || "1") || 1,
        basis: minIsZero ? "0%" : toLegacyLengthValue(min),
        minWidth: minIsZero ? "0" : toLegacyLengthValue(min)
      };
    }

    return {
      grow: 1,
      basis: minIsZero ? "0%" : toLegacyLengthValue(min),
      minWidth: minIsZero ? "0" : toLegacyLengthValue(min),
      maxWidth: /^auto$/i.test(max) ? null : toLegacyLengthValue(max)
    };
  }

  if (/^(auto|min-content|max-content|fit-content.*)$/i.test(value)) {
    return { grow: 0, basis: "auto" };
  }

  const length = toLegacyLengthValue(value);
  return { grow: 0, basis: length, maxWidth: length };
}

function expandRepeatToken(token) {
  const repeatMatch = /^repeat\(([\s\S]*)\)$/i.exec(token);
  if (!repeatMatch) {
    return [token];
  }

  const args = splitTopLevelCommas(repeatMatch[1]);
  const count = Number.parseInt((args[0] || "").trim(), 10);
  const track = args.slice(1).join(", ").trim();
  if (!Number.isFinite(count) || count < 1 || !track || splitTopLevelCommas(track).length > 1) {
    return null;
  }

  return new Array(count).fill(track);
}

function expandGridTemplateColumns(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || /^(none|subgrid|inherit|initial|unset)$/i.test(trimmed)) {
    return null;
  }

  const tokens = splitTopLevelSpaces(trimmed);
  if (!tokens.length) {
    return null;
  }

  // A lone repeat() is the only shape that can stay column-count agnostic and wrap.
  if (tokens.length === 1 && /^repeat\(/i.test(tokens[0])) {
    const args = splitTopLevelCommas(/^repeat\(([\s\S]*)\)$/i.exec(tokens[0])[1]);
    const count = (args[0] || "").trim();
    const track = args.slice(1).join(", ").trim();
    if (!track || splitTopLevelCommas(track).length > 1) {
      return null;
    }

    if (/^(auto-fill|auto-fit)$/i.test(count)) {
      return { mode: "auto", track: describeGridTrack(track) };
    }

    const columns = Number.parseInt(count, 10);
    if (!Number.isFinite(columns) || columns < 1) {
      return null;
    }

    return { mode: "uniform", columns, track: describeGridTrack(track) };
  }

  const expanded = [];
  for (const token of tokens) {
    if (/^repeat\(/i.test(token) && /(auto-fill|auto-fit)/i.test(token)) {
      return null;
    }
    const parts = expandRepeatToken(token);
    if (!parts) {
      return null;
    }
    expanded.push(...parts);
  }

  return { mode: "explicit", tracks: expanded.map(describeGridTrack) };
}

// Box Alignment keywords Chromium 53 does not accept in flexbox. Emitting the
// legacy value immediately before the modern one is enough: an engine that
// understands `start` takes the later declaration, and one that does not drops
// it as invalid and keeps the fallback. No scoping needed.
const LEGACY_ALIGNMENT_VALUES = new Map([
  ["start", "flex-start"],
  ["end", "flex-end"],
  ["space-evenly", "space-around"]
]);

const ALIGNMENT_PROPS = new Set([
  "align-items",
  "align-content",
  "align-self",
  "justify-items",
  "justify-content"
]);

const GRID_GEOMETRY_PROPS = new Set([
  "grid-template-columns",
  "grid-template-rows",
  "grid-auto-rows",
  "grid-auto-columns",
  "grid-auto-flow"
]);

function gridFallbackPlugin() {
  return {
    postcssPlugin: "nuvio-css-grid-fallback",
    Rule(rule) {
      if (
        !rule.selector ||
        !rule.selectors?.length ||
        (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) ||
        rule.selector.includes("no-css-grid")
      ) {
        return;
      }

      let isGrid = false;
      let inlineGrid = false;
      let hasExplicitDisplay = false;
      let templateColumns = null;
      let templateRows = null;
      let autoRows = null;
      let autoFlow = "row";
      let rowGap = null;
      let columnGap = null;
      let justifySelf = null;
      let declaresGridGeometry = false;

      rule.walkDecls((decl) => {
        const prop = decl.prop.toLowerCase();
        const value = decl.value.trim();

        if (ALIGNMENT_PROPS.has(prop)) {
          const legacyValue = LEGACY_ALIGNMENT_VALUES.get(value.toLowerCase());
          const previous = decl.prev();
          if (
            legacyValue &&
            (!previous ||
              previous.type !== "decl" ||
              previous.prop !== decl.prop ||
              previous.value !== legacyValue)
          ) {
            decl.cloneBefore({ value: legacyValue });
          }
          return;
        }

        if (prop === "justify-self") {
          justifySelf = value.toLowerCase();
          return;
        }

        if (prop === "display") {
          hasExplicitDisplay = true;
          if (/^inline-grid$/i.test(value)) {
            isGrid = true;
            inlineGrid = true;
          } else if (/^grid$/i.test(value)) {
            isGrid = true;
            inlineGrid = false;
          } else if (/^(flex|inline-flex|block|none|inline-block|contents)$/i.test(value)) {
            isGrid = false;
          }
          return;
        }

        if (GRID_GEOMETRY_PROPS.has(prop)) {
          declaresGridGeometry = true;
        }

        if (prop === "grid-template-columns") {
          templateColumns = value;
          return;
        }

        if (prop === "grid-template-rows") {
          templateRows = value;
          return;
        }

        if (prop === "grid-auto-rows") {
          autoRows = toLegacyLengthValue(value);
          return;
        }

        if (prop === "grid-auto-flow") {
          autoFlow = value.toLowerCase();
          return;
        }

        if (prop === "gap" || prop === "grid-gap") {
          const parts = splitTopLevelSpaces(value).map(toLegacyLengthValue);
          rowGap = parts[0] || "0";
          columnGap = parts[1] || rowGap;
          return;
        }

        if (prop === "row-gap" || prop === "grid-row-gap") {
          rowGap = toLegacyLengthValue(value);
          return;
        }

        if (prop === "column-gap" || prop === "grid-column-gap") {
          columnGap = toLegacyLengthValue(value);
        }
      });

      // justify-self has no flexbox equivalent; auto margins reproduce the two
      // values this stylesheet actually uses.
      if (justifySelf === "end" || justifySelf === "start") {
        const selfFallback = postcss.rule({
          selectors: rule.selectors.map((selector) => `html.no-css-grid ${selector}`)
        });
        selfFallback.append({
          prop: justifySelf === "end" ? "margin-left" : "margin-right",
          value: "auto"
        });
        rule.after(selfFallback);
      }

      // A rule that sets grid geometry without setting display is an override —
      // a modifier class or a media query refining a container whose
      // display:grid lives in another rule. The fallback has to be emitted here
      // too, at this rule's own specificity, or the element keeps the column
      // count of its base rule. Declaring display:flex alongside is safe: grid
      // geometry on a non-grid element is meaningless, so nothing else could
      // have been relying on this element's display value staying put.
      const treatAsGrid = isGrid || (declaresGridGeometry && !hasExplicitDisplay);
      if (!treatAsGrid) {
        return;
      }

      const scopedSelectors = rule.selectors.map((selector) => `html.no-css-grid ${selector}`);
      const layout = expandGridTemplateColumns(templateColumns);
      const rowLayout = expandGridTemplateColumns(templateRows);
      const wraps = Boolean(layout) && layout.mode !== "explicit" && !autoFlow.includes("column");
      const resolvedColumnGap = columnGap || "0";
      const resolvedRowGap = rowGap || "0";
      const hasColumnGap = resolvedColumnGap !== "0";
      const hasRowGap = resolvedRowGap !== "0";
      const singleColumn = Boolean(layout) && layout.mode === "uniform" && layout.columns === 1;

      const containerFallback = postcss.rule({ selectors: scopedSelectors });
      containerFallback.append({ prop: "display", value: inlineGrid ? "inline-flex" : "flex" });
      if (autoFlow.includes("column") || (singleColumn && rowLayout)) {
        containerFallback.append({ prop: "flex-direction", value: "column" });
        containerFallback.append({ prop: "flex-wrap", value: "nowrap" });
      } else {
        containerFallback.append({ prop: "flex-wrap", value: wraps ? "wrap" : "nowrap" });
      }
      rule.after(containerFallback);

      function childRule(suffix) {
        return postcss.rule({
          selectors: scopedSelectors.map((selector) => `${selector} > *${suffix || ""}`)
        });
      }

      // grid-auto-rows and grid-template-rows give implicit rows a height that
      // flex items never get on their own. Children styled `height: 100%` — the
      // settings layout previews — collapse to zero without this.
      let previous = containerFallback;
      if (autoRows) {
        const rowHeights = childRule();
        rowHeights.append({ prop: "height", value: autoRows });
        previous.after(rowHeights);
        previous = rowHeights;
      } else if (singleColumn && rowLayout && rowLayout.mode === "explicit") {
        rowLayout.tracks.forEach((track, index) => {
          if (track.grow > 0 || !track.basis || track.basis === "auto") {
            return;
          }
          const rowHeight = childRule(`:nth-child(${index + 1})`);
          rowHeight.append({ prop: "flex", value: `0 0 ${track.basis}` });
          rowHeight.append({ prop: "height", value: track.basis });
          previous.after(rowHeight);
          previous = rowHeight;
        });
      }

      if (!layout || autoFlow.includes("column")) {
        return;
      }

      function applyTrack(target, track, basisOverride) {
        const basis = basisOverride || track.basis;
        target.append({ prop: "box-sizing", value: "border-box" });
        target.append({ prop: "flex", value: `${basisOverride ? 0 : track.grow} 1 ${basis}` });
        if (track.minWidth && !basisOverride) {
          target.append({ prop: "min-width", value: track.minWidth });
        }
        if (basisOverride) {
          target.append({ prop: "max-width", value: basis });
        } else if (track.maxWidth) {
          target.append({ prop: "max-width", value: track.maxWidth });
        }
      }

      if (layout.mode === "uniform") {
        const { columns, track } = layout;
        const isFlexible = track.basis === "0%" || track.grow > 0;
        const basisOverride =
          isFlexible && columns > 1
            ? hasColumnGap
              ? `calc((100% - ${columns - 1} * ${resolvedColumnGap}) / ${columns})`
              : `${(100 / columns).toFixed(4)}%`
            : isFlexible
              ? "100%"
              : null;

        const child = childRule();
        applyTrack(child, track, basisOverride);
        if (hasColumnGap && columns > 1) {
          child.append({ prop: "margin-right", value: resolvedColumnGap });
        }
        if (hasRowGap) {
          child.append({ prop: "margin-bottom", value: resolvedRowGap });
        }
        previous.after(child);
        previous = child;

        if (hasColumnGap && columns > 1) {
          const lastInRow = childRule(`:nth-child(${columns}n)`);
          lastInRow.append({ prop: "margin-right", value: "0" });
          previous.after(lastInRow);
        }
        return;
      }

      if (layout.mode === "auto") {
        const child = childRule();
        applyTrack(child, layout.track, null);
        if (hasColumnGap) {
          child.append({ prop: "margin-right", value: resolvedColumnGap });
        }
        if (hasRowGap) {
          child.append({ prop: "margin-bottom", value: resolvedRowGap });
        }
        previous.after(child);
        return;
      }

      layout.tracks.forEach((track, index) => {
        const child = childRule(`:nth-child(${index + 1})`);
        applyTrack(child, track, null);
        if (hasColumnGap && index > 0) {
          child.append({ prop: "margin-left", value: resolvedColumnGap });
        }
        previous.after(child);
        previous = child;
      });
    }
  };
}

gridFallbackPlugin.postcss = true;

async function buildCSS() {
  console.log("processing CSS with PostCSS (legacy support)...");
  if (uiScale !== 1) {
    console.log(`  escala de UI aplicada: ${Math.round(uiScale * 100)}%`);
  }
  const cssDir = path.join(rootDir, "css");
  const files = await readdir(cssDir);
  const cssFiles = files.filter((f) => f.endsWith(".css"));

  for (const file of cssFiles) {
    const cssPath = path.join(cssDir, file);
    const outPath = path.join(distDir, "css", file);

    const css = await readFile(cssPath, "utf8");
    const result = await postcss([
      postcssGlobalData({ files: [path.join(cssDir, "base.css")] }),
      autoprefixer({
        overrideBrowserslist: [`Chrome ${compatibilityPolicy.chromiumVersion}`],
        grid: "autoplace"
      }),
      legacyDeclarationFallbackPlugin(),
      unsupportedSelectorFallbackPlugin(),
      flexGapFallbackPlugin(),
      gridFallbackPlugin(),
      // After the fallback plugins on purpose: the px fallbacks they generate for
      // clamp()/min() must be scaled too, or the TV would keep the unscaled value.
      uiScalePlugin(uiScale),
      cssnano()
    ]).process(css, { from: cssPath, to: outPath });

    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, result.css);
  }
}

async function copyOptionalRootFile(fileName, { fallback = null, defaultContents = "" } = {}) {
  const targetPath = path.join(distDir, fileName);
  try {
    await cp(path.join(rootDir, fileName), targetPath);
    return fileName;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  if (!fallback) {
    return "";
  }

  try {
    await cp(path.join(rootDir, fallback), targetPath);
    return fallback;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  await writeFile(targetPath, defaultContents, "utf8");
  return "generated-default";
}

// Requesting `core-js/stable` for Chromium 53 resolved to 147 modules / ~171 KB,
// shipped as a blocking script before the app bundle. Most of it was dead weight:
// ~31 TypedArray/ArrayBuffer late-spec modules, the 15-module ES2025 iterator-helpers
// proposal, and 5 explicit-resource-management modules for a `using` syntax that
// appears nowhere in `js/`. This list is the opposite: an explicit enumeration of the
// builtins `js/` (and the separately bundled assjs) actually calls.
//
// The `targets` filter still runs on top of this list, so entries Chromium 53 already
// implements are dropped automatically. That makes it safe to list a builtin
// defensively -- the cost of an unnecessary entry is zero bytes, while the cost of a
// MISSING entry is a runtime crash on the TV that no build step can catch.
//
// Adding a new ES2017+ builtin to `js/` means adding its module here. Grep hints:
// each group below names the call sites that justify it.
const CORE_JS_MODULES = [
  // Object.entries (51 uses) / Object.values (13) / Object.fromEntries (24, plus assjs).
  "es.object.entries",
  "es.object.values",
  "es.object.from-entries",

  // String.prototype padStart (14) / padEnd (6) / trimStart (2) / trimEnd (3) /
  // replaceAll (37).
  "es.string.pad-start",
  "es.string.pad-end",
  "es.string.trim-start",
  "es.string.trim-end",
  "es.string.replace-all",

  // Promise.prototype.finally (35) and Promise.allSettled (3).
  "es.promise.finally",
  "es.promise.all-settled",

  // Array.prototype flat (1) / flatMap (9, plus assjs). The `unscopables` entries are
  // part of the same spec change. `includes` is listed for intent even though
  // Chromium 47 already has it, so the list stays correct if the target ever moves.
  "es.array.flat",
  "es.array.flat-map",
  "es.array.unscopables.flat",
  "es.array.unscopables.flat-map",
  "es.array.includes",

  // Array.prototype.sort is NOT stable in V8 5.3 (stability landed in Chrome 70)
  // for arrays longer than 10 elements. This is a behaviour difference, not a
  // missing method, so it shows up as non-deterministic ordering rather than a
  // TypeError — cheap to cover, expensive to debug. Stream ordering is the
  // exposure: js/core/debrid/directDebridStreamPresentation.js and
  // js/core/media/addonLogoCache.js both sort lists that can exceed 10 items.
  "es.array.sort",

  // globalThis (236 uses).
  "es.global-this",

  // URL / URLSearchParams (36 `new URL(...)`, 44 `searchParams.set`, and an
  // `instanceof URLSearchParams` check in js/core/network/httpClient.js).
  //
  // These two MUST stay together. core-js gates both behind one shared
  // `url-constructor-detection` flag, which fails on Chromium 53. Taking only
  // `web.url-search-params` would replace the global `URLSearchParams` while leaving
  // `URL` native, so `new URL(x).searchParams` would hand back a *native* params
  // object that fails `instanceof` against the polyfilled global -- a silent bug.
  // Together they cost ~27 KB of the bundle; see the note in the build docs before
  // trying to drop them.
  "web.url",
  "web.url-search-params",

  // NodeList/HTMLCollection iteration and forEach, used pervasively around the
  // ~210 querySelectorAll call sites.
  "web.dom-collections.iterator",
  "web.dom-collections.for-each"
];

async function buildCoreJsBundle() {
  console.log("building core-js bundle...");
  const { list: requiredModules } = coreJsCompat({
    modules: CORE_JS_MODULES,
    targets: { chrome: String(compatibilityPolicy.chromiumVersion) }
  });
  if (requiredModules.length === 0) {
    throw new Error("Core-js compatibility query returned no required modules.");
  }
  await build({
    stdin: {
      contents: requiredModules
        .map((moduleName) => `import "core-js/modules/${moduleName}.js";`)
        .join("\n"),
      resolveDir: rootDir,
      sourcefile: "core-js-entry.js"
    },
    outfile: path.join(distDir, "core-js.bundle.js"),
    bundle: true,
    format: "iife",
    minify: !debugBundle,
    target: [`chrome${compatibilityPolicy.chromiumVersion}`],
    legalComments: "none"
  });
}

async function buildAssSubtitleLibrary() {
  await build({
    entryPoints: [path.join(rootDir, "node_modules", "assjs", "dist", "ass.global.min.js")],
    outfile: path.join(distDir, "assets", "libs", "ass.min.js"),
    minify: !debugBundle,
    target: [`chrome${compatibilityPolicy.chromiumVersion}`],
    legalComments: "none"
  });
}

// ---------------------------------------------------------------------------
// Screen chunks (bundle split stage 1b)
//
// `playerScreen.js` is 18.6% of the minified app bundle and is imported by
// nothing except the router, so it is the one screen that can be lifted out
// cleanly. It ships as a second IIFE loaded on demand by
// js/runtime/loadScreenChunks.js.
//
// THE CYCLE IS THE WHOLE PROBLEM. Every screen imports `Router` back from
// router.js, and router.js imports the screens, so building playerScreen.js as
// a standalone entry point re-pulls essentially the entire application - all 26
// screens - into the chunk. That would not merely double the bytes: `Router`
// owns mutable state (`current`, `currentParams`, `stack`), and so do
// RouteStateStore, LocalStore, Platform and every repository singleton. A
// second copy inside the chunk means `Router.current` as the player sees it and
// `Router.current` as focusEngine sees it are different variables. That is a
// correctness bug that no size measurement would reveal.
//
// The cut: whatever the main bundle and the chunk BOTH need becomes "shared
// core". The main bundle publishes those module namespaces on
// `globalThis.__NUVIO_SHARED__`, and inside the chunk every import of a shared
// module is rewritten to a re-export from that global. Exactly one copy exists,
// and it is the main bundle's.
//
// The shared list is MEASURED, never hand-written: it is the intersection of
// the two module graphs, computed by two throwaway metafile builds. A
// hand-written list would drift the moment anyone adds an import, and the
// failure mode of drift is a silently duplicated singleton.
const SHARED_GLOBAL = "__NUVIO_SHARED__";
const SCREEN_CHUNK_GLOBAL = "__NUVIO_SCREEN_CHUNKS__";
const SHARED_NAMESPACE = "nuvio-shared";
const SHARED_REGISTRY_FILE = path.join(
  rootDir,
  "js",
  "runtime",
  "generated",
  "sharedModuleRegistry.js"
);
const SHARED_REGISTRY_INPUT = "js/runtime/generated/sharedModuleRegistry.js";
const APP_ENTRY = path.join(rootDir, "js", "app.js");

const SCREEN_CHUNKS = [
  {
    id: "player",
    entry: path.join(rootDir, "js", "ui", "screens", "player", "playerScreen.js"),
    exports: ["PlayerScreen"],
    // Must match `sources` in js/runtime/loadScreenChunks.js.
    outputFile: "player.chunk.js"
  }
];

// esbuild reports metafile paths relative to process.cwd(); everything here is
// keyed relative to the repo root so the two are never confused.
function toRepoRelative(filePath) {
  return path.relative(rootDir, path.resolve(process.cwd(), filePath)).split(path.sep).join("/");
}

function metafileInputSet(metafile) {
  return new Set(
    Object.keys(metafile.inputs)
      .filter((input) => !input.includes(":"))
      .map(toRepoRelative)
  );
}

// Neutralises a stale generated registry during the probe builds. Without this
// the previous build's registry could pull a module into the main graph that no
// longer belongs there, and the measured intersection would be wrong in a way
// that is invisible until a singleton duplicates.
function emptySharedRegistryPlugin() {
  return {
    name: "nuvio-empty-shared-registry",
    setup(build) {
      build.onLoad({ filter: /generated[\\/]sharedModuleRegistry\.js$/ }, () => ({
        contents: "export const SHARED_MODULE_IDS = [];",
        loader: "js"
      }));
    }
  };
}

async function probeModuleGraph(options) {
  const result = await build({
    bundle: true,
    write: false,
    metafile: true,
    minify: !debugBundle,
    format: "iife",
    target: [`chrome${compatibilityPolicy.chromiumVersion}`],
    logLevel: "silent",
    define: {
      "process.env.NODE_ENV": '"production"',
      __NUVIO_APP_VERSION__: '"0.0.0"'
    },
    ...options
  });
  return result.metafile;
}

// Derives each shared module's export names from esbuild itself rather than
// from a hand-maintained list, so the re-export surface inside the chunk can
// never drift from the source. A per-file `format: "esm"` pass reports the
// export names in `metafile.outputs[...].exports`.
async function readSharedModuleExports(sharedModules) {
  if (sharedModules.length === 0) {
    return new Map();
  }
  const result = await build({
    entryPoints: sharedModules.map((relativePath) => path.join(rootDir, relativePath)),
    outdir: path.join(distDir, ".shared-exports-probe"),
    outbase: rootDir,
    bundle: false,
    write: false,
    metafile: true,
    format: "esm",
    target: [`chrome${compatibilityPolicy.chromiumVersion}`],
    logLevel: "silent"
  });

  const exportsByModule = new Map();
  for (const output of Object.values(result.metafile.outputs)) {
    if (!output.entryPoint) {
      continue;
    }
    exportsByModule.set(toRepoRelative(output.entryPoint), output.exports || []);
  }

  const missing = sharedModules.filter((relativePath) => !exportsByModule.has(relativePath));
  if (missing.length > 0) {
    throw new Error(`Could not resolve exports for shared modules: ${missing.join(", ")}`);
  }

  // Two shapes cannot survive the global re-export and must fail the build
  // rather than break subtly at runtime:
  //   * `export *`: the per-file pass cannot see through it (nothing is
  //     bundled), so the export list would be silently incomplete.
  //   * `export let` / `export var`: the chunk reads the value once through
  //     `const x = namespace.x`, which snapshots it. A later reassignment in
  //     the main bundle would not be visible inside the chunk.
  await Promise.all(
    sharedModules.map(async (relativePath) => {
      const source = await readFile(path.join(rootDir, relativePath), "utf8");
      if (/^\s*export\s+\*/m.test(source)) {
        throw new Error(
          `Shared module ${relativePath} uses "export *", which cannot be re-exported ` +
            "through the shared-core global. Name its exports explicitly."
        );
      }
      const mutableExport = /^\s*export\s+(let|var)\s+/m.exec(source);
      if (mutableExport) {
        throw new Error(
          `Shared module ${relativePath} has a mutable "export ${mutableExport[1]}". ` +
            "The chunk reads shared exports by value, so a reassignment would not be " +
            "visible across the split. Wrap the value in an object instead."
        );
      }
    })
  );

  return exportsByModule;
}

function renderSharedRegistry(sharedModules) {
  const registryDir = path.dirname(SHARED_REGISTRY_FILE);
  const imports = sharedModules.map((relativePath, index) => {
    const specifier = path
      .relative(registryDir, path.join(rootDir, relativePath))
      .split(path.sep)
      .join("/");
    return `import * as shared${index} from "${specifier.startsWith(".") ? specifier : `./${specifier}`}";`;
  });
  const assignments = sharedModules.map(
    (relativePath, index) => `registry[${JSON.stringify(relativePath)}] = shared${index};`
  );

  return [
    "// GENERATED FILE - do not edit. Rewritten by scripts/build.mjs on every build.",
    "//",
    "// Publishes the shared-core module namespaces on the global object so the",
    "// on-demand screen chunks can re-export the SAME singletons instead of",
    "// bundling their own copies. The list is the measured intersection of the",
    "// main bundle's and the chunks' module graphs - see scripts/build.mjs.",
    "",
    ...imports,
    "",
    `const registry = (globalThis.${SHARED_GLOBAL} = globalThis.${SHARED_GLOBAL} || {});`,
    ...assignments,
    "",
    `export const SHARED_MODULE_IDS = ${JSON.stringify(sharedModules, null, 2)};`,
    ""
  ].join("\n");
}

function renderSharedProxyModule(moduleId, exportNames) {
  const lines = [
    `const namespace = globalThis.${SHARED_GLOBAL}[${JSON.stringify(moduleId)}];`,
    "if (!namespace) {",
    `  throw new Error("Shared module not published by the app bundle: ${moduleId}");`,
    "}"
  ];
  for (const name of exportNames) {
    if (name === "default") {
      lines.push("export default namespace.default;");
      continue;
    }
    lines.push(`export const ${name} = namespace[${JSON.stringify(name)}];`);
  }
  return lines.join("\n");
}

// Rewrites every import of a shared-core module to a virtual module that reads
// the namespace back off the global. This is what stops the chunk from pulling
// the router (and therefore every screen) back in.
function sharedCorePlugin(exportsByModule) {
  return {
    name: "nuvio-shared-core",
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /.*/ }, async (args) => {
        if (args.namespace === SHARED_NAMESPACE || args.pluginData === "nuvio-shared-resolved") {
          return null;
        }
        if (!args.importer) {
          return null;
        }
        const resolved = await pluginBuild.resolve(args.path, {
          importer: args.importer,
          resolveDir: args.resolveDir,
          kind: args.kind,
          pluginData: "nuvio-shared-resolved"
        });
        if (resolved.errors.length > 0 || !resolved.path) {
          return null;
        }
        const moduleId = toRepoRelative(resolved.path);
        if (!exportsByModule.has(moduleId)) {
          return null;
        }
        return { path: moduleId, namespace: SHARED_NAMESPACE };
      });

      pluginBuild.onLoad({ filter: /.*/, namespace: SHARED_NAMESPACE }, (args) => ({
        contents: renderSharedProxyModule(args.path, exportsByModule.get(args.path) || []),
        loader: "js"
      }));
    }
  };
}

async function buildScreenChunk(chunk, exportsByModule, version) {
  const namedExports = chunk.exports.map((name) => `${name}: ${name}`).join(",\n  ");
  const entrySpecifier = chunk.entry.split(path.sep).join("/");
  const result = await build({
    stdin: {
      // The chunk's last statement publishes itself. `isLoaded()` in
      // loadScreenChunks.js tests for this object rather than trusting the
      // <script> onload event, which fires on parse, not on execution.
      contents: [
        `import { ${chunk.exports.join(", ")} } from ${JSON.stringify(entrySpecifier)};`,
        `const chunks = (globalThis.${SCREEN_CHUNK_GLOBAL} = globalThis.${SCREEN_CHUNK_GLOBAL} || {});`,
        `chunks[${JSON.stringify(chunk.id)}] = {`,
        `  ${namedExports}`,
        "};",
        ""
      ].join("\n"),
      resolveDir: rootDir,
      sourcefile: `${chunk.id}-chunk-entry.js`
    },
    outfile: path.join(distDir, chunk.outputFile),
    bundle: true,
    minify: !debugBundle,
    format: "iife",
    sourcemap: debugBundle,
    target: [`chrome${compatibilityPolicy.chromiumVersion}`],
    metafile: true,
    legalComments: "none",
    plugins: [sharedCorePlugin(exportsByModule)],
    define: {
      "process.env.NODE_ENV": '"production"',
      __NUVIO_APP_VERSION__: JSON.stringify(version)
    }
  });

  await writeFile(
    path.join(distDir, `${chunk.outputFile}.meta.json`),
    JSON.stringify(result.metafile),
    "utf8"
  );

  const outputKey = Object.keys(result.metafile.outputs).find((key) =>
    key.endsWith(chunk.outputFile)
  );
  const bytes = outputKey ? result.metafile.outputs[outputKey].bytes : 0;
  console.log(`chunk "${chunk.id}" built: ${chunk.outputFile} (${bytes} bytes minified)`);
  return {
    chunk,
    bytes,
    inputs: metafileInputSet(result.metafile),
    // Which shared modules this chunk actually reaches. Only these need to be
    // published, so the registry inside the app bundle stays small and does not
    // pin exports of modules nothing across the split ever reads.
    usedSharedModules: Object.keys(result.metafile.inputs)
      .filter((input) => input.startsWith(`${SHARED_NAMESPACE}:`))
      .map((input) => input.slice(SHARED_NAMESPACE.length + 1))
  };
}

// Measures the two module graphs and writes the generated shared-core registry.
// Returns the export map the chunk builds need.
async function prepareSharedCore() {
  console.log("measuring shared-core module graph...");
  const mainProbe = await probeModuleGraph({
    entryPoints: [APP_ENTRY],
    outfile: path.join(distDir, ".probe-app.js"),
    plugins: [emptySharedRegistryPlugin()]
  });
  const mainProbeInputs = metafileInputSet(mainProbe);

  const sharedModules = new Set();
  for (const chunk of SCREEN_CHUNKS) {
    const chunkProbe = await probeModuleGraph({
      entryPoints: [chunk.entry],
      outfile: path.join(distDir, `.probe-${chunk.id}.js`)
    });
    for (const input of metafileInputSet(chunkProbe)) {
      if (mainProbeInputs.has(input) && input !== SHARED_REGISTRY_INPUT) {
        sharedModules.add(input);
      }
    }
  }

  const sharedModuleList = [...sharedModules].sort();
  console.log(`shared core: ${sharedModuleList.length} candidate modules`);
  return readSharedModuleExports(sharedModuleList);
}

async function writeSharedRegistry(sharedModules) {
  const sorted = [...new Set(sharedModules)].sort();
  await mkdir(path.dirname(SHARED_REGISTRY_FILE), { recursive: true });
  await writeFile(SHARED_REGISTRY_FILE, renderSharedRegistry(sorted), "utf8");
  console.log(`shared core: ${sorted.length} modules published on ${SHARED_GLOBAL}`);
}

async function buildBundle() {
  const { version } = await readAppMetadata();

  // Chunks are built FIRST. Their module graphs are what decides which shared
  // modules the app bundle actually has to publish, so the generated registry
  // can be written knowing exactly what is needed instead of everything that
  // might be.
  // O registry real e escrito DEPOIS dos chunks, de proposito (o comentario
  // acima explica), mas `js/runtime/loadScreenChunks.js` o importa — logo tanto a
  // medicao do grafo compartilhado quanto o build do chunk exigem que o arquivo
  // ja exista. Numa arvore que ja buildou ele sobra do build anterior e o
  // problema fica invisivel; num clone limpo o esbuild falha com
  // `Could not resolve "./generated/sharedModuleRegistry.js"`. Foi exatamente
  // assim que o CI quebrou na primeira execucao. O stub vazio abaixo resolve o
  // ovo-e-galinha e e sobrescrito pelo registry real mais adiante, mantendo o
  // arquivo fora do git.
  if (!existsSync(SHARED_REGISTRY_FILE)) {
    await writeSharedRegistry([]);
  }
  const sharedExportsByModule = await prepareSharedCore();
  const chunkResults = [];
  for (const chunk of SCREEN_CHUNKS) {
    chunkResults.push(await buildScreenChunk(chunk, sharedExportsByModule, version));
  }
  await writeSharedRegistry(chunkResults.flatMap((entry) => entry.usedSharedModules));

  console.log("starting bundle build...");
  const result = await build({
    entryPoints: [path.join(rootDir, "js/app.js")],
    outfile: path.join(distDir, "app.bundle.js"),
    bundle: true,
    minify: !debugBundle,
    format: "iife",
    sourcemap: debugBundle,
    target: [`chrome${compatibilityPolicy.chromiumVersion}`],
    metafile: true,
    // Bracket the bundle so the boot cost can be split into "download + parse"
    // and "top-level execution". Only the first half is what code-splitting can
    // reduce, so this is what decides whether splitting is worth doing at all.
    // Cheap enough to ship: two timestamps into a global.
    banner: {
      js: "window.__NUVIO_BUNDLE_START__ = Date.now();"
    },
    footer: {
      js: "window.__NUVIO_BUNDLE_END__ = Date.now();"
    },
    define: {
      "process.env.NODE_ENV": '"production"',
      __NUVIO_APP_VERSION__: JSON.stringify(version)
    }
  });
  if (
    Object.keys(result.metafile.inputs).some((input) => input.includes("node_modules/core-js/"))
  ) {
    throw new Error("Application bundle must not contain core-js modules.");
  }

  const mainInputs = metafileInputSet(result.metafile);

  // The extraction assertion. If playerScreen.js is back in the app bundle,
  // something re-imported it statically and the chunk became dead weight that
  // is downloaded twice - the split would be silently undone with no size
  // regression obvious enough to notice.
  const leakedChunkEntries = SCREEN_CHUNKS.filter((chunk) =>
    mainInputs.has(toRepoRelative(chunk.entry))
  );
  if (leakedChunkEntries.length > 0) {
    throw new Error(
      "Application bundle must not contain lazily loaded screen entries: " +
        leakedChunkEntries.map((chunk) => toRepoRelative(chunk.entry)).join(", ")
    );
  }

  // The metafile was already being generated and thrown away. Writing it is what
  // makes `npx esbuild --analyze` able to report per-module MINIFIED bytes, which
  // is the only honest way to rank code-splitting candidates — source bytes
  // mislead badly for modules that minify well.
  await writeFile(
    path.join(distDir, "app.bundle.meta.json"),
    JSON.stringify(result.metafile),
    "utf8"
  );

  // ANTI-DUPLICATION TRIPWIRE. If any real source file ends up in both graphs,
  // the split has silently regressed into duplicated modules - and if that file
  // holds mutable state (Router, RouteStateStore, LocalStore, Platform, every
  // repository singleton), into duplicated singletons that diverge at runtime.
  // Failing the build is the only thing that keeps this design true over time.
  for (const { chunk, inputs } of chunkResults) {
    const duplicated = [...inputs].filter((input) => mainInputs.has(input)).sort();
    if (duplicated.length > 0) {
      throw new Error(
        `Screen chunk "${chunk.id}" duplicates ${duplicated.length} module(s) already in the ` +
          `app bundle. Duplicated mutable singletons would diverge at runtime. Offenders:\n  ` +
          duplicated.join("\n  ")
      );
    }
  }

  const mainOutputKey = Object.keys(result.metafile.outputs).find((key) =>
    key.endsWith("app.bundle.js")
  );
  console.log(
    `bundle build complete: app.bundle.js ` +
      `(${mainOutputKey ? result.metafile.outputs[mainOutputKey].bytes : 0} bytes minified)`
  );
}
async function runBuild() {
  try {
    console.log("cleaning dist directory...");
    await rm(distDir, { recursive: true, force: true });
    await mkdir(distDir, { recursive: true });

    console.log("building version files...");
    await syncVersionFiles();
    await buildCSS();

    console.log("copying static assets...");
    const copiedAppInfoSource = await copyOptionalRootFile("appinfo.json");
    await Promise.all([
      cp(path.join(rootDir, "assets"), path.join(distDir, "assets"), { recursive: true }),
      cp(path.join(rootDir, "res"), path.join(distDir, "res"), { recursive: true }),
      cp(path.join(rootDir, "boot-guard.js"), path.join(distDir, "boot-guard.js")),
      cp(path.join(rootDir, "docs", "youtube-proxy.html"), path.join(distDir, "youtube-proxy.html"))
    ]);

    // Precompiled locale bundles. The runtime prefers these and only falls back
    // to parsing the shipped XML if one is missing.
    const i18nManifest = await buildI18nBundles({
      resDir: path.join(rootDir, "res"),
      outDir: path.join(distDir, "res", "i18n")
    });
    console.log(
      `precompiled ${i18nManifest.locales.length} locale bundles ` +
        `(${i18nManifest.baseKeyCount} keys each)`
    );
    await buildCoreJsBundle();
    await Promise.all([
      cp(
        path.join(rootDir, "node_modules", "hls.js", "dist", "hls.min.js"),
        path.join(distDir, "assets", "libs", "hls.min.js")
      ),
      cp(
        path.join(rootDir, "node_modules", "hls.js", "LICENSE"),
        path.join(distDir, "assets", "libs", "hls.js.LICENSE")
      ),
      cp(
        path.join(rootDir, "node_modules", "dashjs", "dist", "dash.all.min.js"),
        path.join(distDir, "assets", "libs", "dash.all.min.js")
      ),
      cp(
        path.join(rootDir, "node_modules", "dashjs", "LICENSE.md"),
        path.join(distDir, "assets", "libs", "dashjs.LICENSE.md")
      ),
      cp(
        path.join(rootDir, "node_modules", "assjs", "LICENSE"),
        path.join(distDir, "assets", "libs", "assjs.LICENSE")
      )
    ]);
    await buildAssSubtitleLibrary();
    await cp(
      path.join(rootDir, "node_modules", "libbitsub", "pkg", "libbitsub_bg.wasm"),
      path.join(distDir, "assets", "libs", "libbitsub_bg.wasm")
    );
    await cp(
      path.join(rootDir, "node_modules", "libbitsub", "LICENSE"),
      path.join(distDir, "assets", "libs", "libbitsub.LICENSE")
    );

    if (!copiedAppInfoSource) {
      console.warn("WARNING: skipping appinfo.json because it is not present in the repo root.");
    }

    // js bundle processing (final step to ensure all transformations are applied correctly and we end up with a single, minified bundle file)
    await buildBundle();

    const sourceIndex = await readFile(path.join(rootDir, "index.html"), "utf8");
    await writeFile(path.join(distDir, "index.html"), sourceIndex);

    console.log("configuring runtime env from local.properties...");
    const envResult = await writeRuntimeEnvScriptFile(path.join(distDir, "nuvio.env.js"), {
      rootDir
    });
    const envSourceBaseName = path.basename(envResult.sourcePath || "");
    const usingFallbackEnv =
      !envResult.sourcePath || envSourceBaseName === "local.example.properties";
    if (requireConfiguredRuntimeEnv && usingFallbackEnv) {
      throw new Error(
        "Configured runtime env is required for this build. Provide local.properties."
      );
    }
    if (!envResult.sourcePath) {
      console.warn("WARNING: generated default runtime env (unconfigured).");
    } else if (envSourceBaseName === "local.example.properties") {
      console.warn("WARNING: using local.example.properties as fallback.");
    }

    console.log(`\nbuild finished successfully in: ${distDir}`);
  } catch (error) {
    console.error("\nbuild failed:");
    console.error(error);
    process.exit(1);
  }
}

runBuild();
