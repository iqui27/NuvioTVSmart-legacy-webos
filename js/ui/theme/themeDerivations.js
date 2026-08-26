/**
 * Derivacoes de tema, puras e sem DOM.
 *
 * Extraidas do themeManager para poderem ser consumidas TAMBEM pelo build: a
 * variante webOS 3 (Chromium 38) nao tem custom properties, entao as folhas de
 * tema precisam ser geradas com valores concretos em tempo de build. Se as
 * derivadas fossem duplicadas la, cada cor nova teria que ser lembrada em dois
 * lugares e a divergencia apareceria como cor errada so no aparelho mais antigo,
 * que e onde ninguem testa.
 *
 * Vive em js/ e nao em scripts/ porque e codigo de runtime que o build consome,
 * e nao o inverso — o app nao deve importar nada de scripts/.
 */

function hexChannels(hex) {
  const value = String(hex || "").trim();
  const match = value.match(/^#([0-9a-f]{6})$/i);
  if (!match) {
    return null;
  }
  const normalized = match[1];
  return [
    parseInt(normalized.slice(0, 2), 16),
    parseInt(normalized.slice(2, 4), 16),
    parseInt(normalized.slice(4, 6), 16)
  ];
}

/** `#0d0d0d` -> `"13 13 13"` (sintaxe de espaco, para `rgb(var(--x) / a)`). */
export function toRgbChannels(hex, fallback = "255 255 255") {
  const channels = hexChannels(hex);
  return channels ? channels.join(" ") : fallback;
}

/** `#0d0d0d` -> `"13, 13, 13"` (sintaxe legada, para `rgba(var(--x), a)`). */
export function toLegacyRgbChannels(hex, fallback = "255, 255, 255") {
  const channels = hexChannels(hex);
  return channels ? channels.join(", ") : fallback;
}

/**
 * Aplica AMOLED sobre uma paleta. Devolve um objeto novo — nao muta a entrada,
 * porque a paleta vem de ThemeColors e e compartilhada.
 */
export function applyAmoledOverrides(
  colors,
  { amoledMode = false, amoledSurfacesMode = false } = {}
) {
  if (!amoledMode) {
    return { ...colors };
  }
  const result = { ...colors, "--bg-color": "#000000" };
  if (amoledSurfacesMode) {
    result["--bg-elevated"] = "#000000";
    result["--card-bg"] = "#000000";
  }
  return result;
}

/**
 * Canais RGB e aliases `--player-*` derivados da paleta.
 *
 * Os fallbacks nao sao decorativos: uma paleta sem `--bg-color` valido cairia
 * para branco puro e a interface inteira ficaria ilegivel, entao cada canal tem
 * o tom escuro correspondente como piso.
 */
export function deriveThemeColors(colors = {}) {
  return {
    "--bg-color-rgb": toRgbChannels(colors["--bg-color"], "13 13 13"),
    "--bg-color-rgb-legacy": toLegacyRgbChannels(colors["--bg-color"], "13, 13, 13"),
    "--bg-elevated-rgb": toRgbChannels(colors["--bg-elevated"], "26 26 26"),
    "--card-bg-rgb": toRgbChannels(colors["--card-bg"], "34 34 34"),
    "--secondary-color-rgb": toRgbChannels(colors["--secondary-color"], "245 245 245"),
    "--focus-color-rgb": toRgbChannels(colors["--focus-color"], "255 255 255"),
    "--player-secondary": colors["--secondary-color"],
    "--player-on-secondary": colors["--on-secondary"],
    "--player-focus-ring": colors["--focus-color"],
    "--player-focus-background": colors["--focus-bg"],
    "--player-background-elevated": colors["--bg-elevated"],
    "--player-background-card": colors["--card-bg"],
    "--player-text-primary": colors["--text-color"],
    "--player-text-secondary": colors["--text-secondary"],
    "--player-text-tertiary": colors["--text-tertiary"]
  };
}

/** Paleta completa (base + AMOLED + derivadas) pronta para virar CSS. */
export function resolveThemeVariables(palette, options = {}) {
  const colors = applyAmoledOverrides(palette, options);
  return { ...colors, ...deriveThemeColors(colors) };
}
