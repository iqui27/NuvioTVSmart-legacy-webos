/**
 * Grep gate for CSS the webOS 4 / Chromium 53 engine cannot use.
 *
 * Why this exists: the local dev browser is modern Chrome, so a rule that the TV
 * silently drops still looks correct on the Mac. That gap shipped two real bugs —
 * `.player-dialog-item` used `display: grid` with no fallback (the subtitle menu
 * drew its label, count badge and check mark on top of each other), and a
 * `margin-left: min(...)` computed to 0 on the device. Both were invisible here.
 *
 * The check is deliberately about MISSING FALLBACKS, not about avoiding modern
 * CSS: a declaration is fine when a rule scoped to the matching `no-*` class
 * (which the boot guard stamps on <html>) provides a legacy path.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cssDir = path.join(rootDir, "css");

// Chrome version each feature landed in; the TV engine is 53.
const FEATURES = [
  {
    name: "CSS Grid",
    since: 57,
    fallbackClass: "no-css-grid",
    re: /(^|[;{\s])(display\s*:\s*(inline-)?grid|grid-template|grid-column|grid-row|grid-area|grid-auto|justify-items|place-items|place-content)\b/i
  },
  {
    name: "min()/max()/clamp()",
    since: 79,
    fallbackClass: "no-css-math",
    re: /[:\s(](min|max|clamp)\(/i
  },
  {
    name: "flex/grid gap",
    since: 84,
    fallbackClass: "no-flex-gap",
    re: /(^|[;{\s])(gap|row-gap|column-gap)\s*:/i
  },
  {
    name: "backdrop-filter",
    since: 76,
    fallbackClass: "no-backdrop-filter",
    re: /(^|[;{\s])(-webkit-)?backdrop-filter\s*:/i
  },
  {
    name: "aspect-ratio",
    since: 88,
    fallbackClass: "no-aspect-ratio",
    re: /(^|[;{\s])aspect-ratio\s*:/i
  },
  {
    name: "content-visibility",
    since: 85,
    fallbackClass: null,
    re: /(^|[;{\s])content-visibility\s*:/i
  },
  { name: "position: sticky", since: 56, fallbackClass: null, re: /position\s*:\s*sticky/i },
  {
    name: ":focus-visible (regra inteira cai se o seletor for invalido)",
    since: 86,
    fallbackClass: null,
    re: /:focus-visible\b/i
  },
  // `inset` is deliberately NOT checked: every use in this codebase follows the
  // top/right/bottom/left longhands in the same block, so Chromium 53 ignores the
  // shorthand and keeps the longhand values. Flagging it was pure noise.
  { name: ":focus-visible", since: 86, fallbackClass: null, skip: true, re: /$^/ }
];

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

// PostCSS emits the `html.no-*` fallback rules at build time, so they exist in
// dist and NOT in source. Counting them in source underreports coverage and was
// the first thing that made this report untrustworthy.
const distCssDir = path.join(rootDir, "dist", "css");
let distText = "";
try {
  for (const f of (await readdir(distCssDir)).filter((n) => n.endsWith(".css"))) {
    distText += await readFile(path.join(distCssDir, f), "utf8");
  }
} catch (_) {
  distText = "";
}

const files = (await readdir(cssDir)).filter((f) => f.endsWith(".css"));
const findings = [];
const fallbackCounts = new Map();

for (const file of files) {
  const raw = await readFile(path.join(cssDir, file), "utf8");
  const text = stripComments(raw);
  const lines = text.split("\n");
  for (const feature of FEATURES) {
    if (feature.skip) {
      continue;
    }
    lines.forEach((line, index) => {
      if (feature.re.test(line)) {
        findings.push({
          file,
          line: index + 1,
          feature: feature.name,
          since: feature.since,
          text: line.trim().slice(0, 88)
        });
      }
    });
  }
}

const byFeature = new Map();
findings.forEach((f) => {
  if (!byFeature.has(f.feature)) byFeature.set(f.feature, []);
  byFeature.get(f.feature).push(f);
});

FEATURES.forEach((feature) => {
  if (!feature.fallbackClass) return;
  const count = distText
    ? (distText.match(new RegExp("no-" + feature.fallbackClass.replace(/^no-/, ""), "g")) || [])
        .length
    : -1;
  fallbackCounts.set(feature.name, count);
});

console.log("CSS que o Chromium 53 (webOS 4) nao suporta:");
console.log(
  distText
    ? "(cobertura de fallback medida no dist/, pos-PostCSS)\n"
    : "(dist/ ausente — rode o build antes para medir a cobertura)\n"
);
let semFallback = 0;
for (const feature of FEATURES) {
  const hits = byFeature.get(feature.name) || [];
  if (!hits.length) continue;
  const fallbacks = feature.fallbackClass ? fallbackCounts.get(feature.name) || 0 : 0;
  const marca = !feature.fallbackClass
    ? "SEM mecanismo de fallback"
    : fallbacks < 0
      ? "cobertura desconhecida (sem dist/)"
      : fallbacks === 0
        ? "NENHUM fallback no dist/ — RISCO"
        : `fallback \`${feature.fallbackClass}\` no dist/: ${fallbacks} ocorrencia(s)`;
  if (!feature.fallbackClass) semFallback += hits.length;
  console.log(`${feature.name} (Chrome ${feature.since}) — ${hits.length} uso(s), ${marca}`);
  hits.slice(0, 4).forEach((h) => console.log(`    ${h.file}:${h.line}  ${h.text}`));
  if (hits.length > 4) console.log(`    ... e ${hits.length - 4} outros`);
  console.log("");
}
console.log(
  `Total: ${findings.length} usos; ${semFallback} em features sem nenhum mecanismo de fallback.`
);

// PostCSS emits the legacy fallback for min()/max()/clamp() by DUPLICATING the
// declaration with a static value ahead of the modern one, not with a `no-*`
// class. So the class count says nothing here — what matters is whether each
// math declaration in dist has a same-property fallback in front of it.
// Corollary worth knowing before editing CSS: do NOT hand-write the pair. PostCSS
// dedupes identical properties and keeps the LAST one, so a manual
// `margin-left: 8px; margin-left: min(...)` loses the fallback and computes to 0
// on the TV. Write the modern value alone and let the build add the fallback.
if (distText) {
  const declaracoes = distText.match(/[a-z-]+\s*:\s*[^;{}]*?(?:min|max|clamp)\([^;{}]*/g) || [];
  const comPar =
    distText.match(/([a-z-]+)\s*:\s*[^;{}]*?;\s*\1\s*:\s*[^;{}]*?(?:min|max|clamp)\(/g) || [];
  const descobertas = declaracoes.length - comPar.length;
  console.log("");
  console.log(
    `min()/max()/clamp() no dist/: ${declaracoes.length} declaracoes, ${comPar.length} com fallback estatico gerado pelo PostCSS.`
  );
  if (descobertas > 0) {
    console.log(`  ${descobertas} SEM fallback — cada uma computa errado ou nada no Chromium 53.`);
  }
}
