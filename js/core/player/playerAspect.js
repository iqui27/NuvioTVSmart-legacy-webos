/**
 * Modos de proporcao.
 *
 * MEDIDO no aparelho (OLED65C9, webOS 4.10) e nao suposto: `transform: scale()`
 * FUNCIONA no plano de video desta TV. O codigo anterior desligava esse caminho
 * com `canTransformVideo = !Environment.isWebOS()` — por decreto, sem medicao — e
 * era o unico capaz de recortar barra preta. Com ele desligado, os graus de zoom
 * abaixo eram inalcancaveis no webOS e todos os modos caiam em object-fit.
 *
 * Por que object-fit nunca resolveu, e a razao de o zoom ser obrigatorio: a barra
 * de um filme widescreen esta EMBUTIDA no quadro. Um 2.39:1 entregue como
 * 3840x2160 tem proporcao de quadro 1.778, identica a da tela — logo `cover` e
 * `contain` produzem exatamente a mesma imagem, e nenhum valor de object-fit
 * corta nada. Cortar exige ampliar e deixar o excesso sair da viewport.
 *
 * Os fatores nao sao arbitrarios: sao 16/9 dividido pela proporcao do filme.
 *   2.35:1 -> 1.778/2.35 = 0.757  => 1.32
 *   2.39:1 -> 1.778/2.39 = 0.744  => 1.34
 *   2.76:1 -> 1.778/2.76 = 0.644  => 1.55
 * ULTRA_ZOOM existe porque CINEMA_ZOOM (1.33) deixa barra visivel em 2.76:1,
 * observado na TV.
 *
 * `objectFit` continua sendo lido no webOS para o caso sem zoom; o grau vem do
 * transform, via resolveAspectScale.
 */
export const ASPECT_MODE_IDS = Object.freeze([
  "ORIGINAL",
  "FULL_SCREEN",
  "STRETCH",
  "SLIGHT_ZOOM",
  "CINEMA_ZOOM",
  "ULTRA_ZOOM",
  "VERTICAL_STRETCH",
  "HORIZONTAL_STRETCH"
]);

export const DEFAULT_ASPECT_MODE = "ORIGINAL";

export const ASPECT_MODE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "ORIGINAL",
    labelKey: "player_aspect_fit",
    fallbackLabel: "Fit (Original)",
    objectFit: "contain"
  }),
  Object.freeze({
    id: "FULL_SCREEN",
    labelKey: "player_aspect_crop",
    fallbackLabel: "Crop",
    objectFit: "cover"
  }),
  Object.freeze({
    id: "STRETCH",
    labelKey: "player_aspect_stretch",
    fallbackLabel: "Stretch",
    objectFit: "fill"
  }),
  Object.freeze({
    id: "SLIGHT_ZOOM",
    labelKey: "player_aspect_mode_slight_zoom",
    fallbackLabel: "Slight Zoom",
    objectFit: "cover"
  }),
  Object.freeze({
    id: "CINEMA_ZOOM",
    labelKey: "player_aspect_mode_cinema_zoom",
    fallbackLabel: "Cinema Zoom",
    objectFit: "cover"
  }),
  Object.freeze({
    id: "ULTRA_ZOOM",
    labelKey: "player_aspect_mode_ultra_zoom",
    fallbackLabel: "Ultra Zoom",
    objectFit: "contain"
  }),
  Object.freeze({
    id: "VERTICAL_STRETCH",
    labelKey: "player_aspect_fit_height",
    fallbackLabel: "Fit Height",
    objectFit: "cover"
  }),
  Object.freeze({
    id: "HORIZONTAL_STRETCH",
    labelKey: "player_aspect_fit_width",
    fallbackLabel: "Fit Width",
    objectFit: "contain"
  })
]);

const LEGACY_OBJECT_FIT_MODES = Object.freeze({
  contain: "ORIGINAL",
  cover: "FULL_SCREEN",
  fill: "STRETCH"
});

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function parseAspectRatio(value) {
  const numeric = positiveNumber(value);
  if (numeric) {
    return numeric;
  }

  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }
  const match = text.match(/^(\d+(?:\.\d+)?)\s*[:/xX]\s*(\d+(?:\.\d+)?)$/);
  if (!match) {
    return null;
  }
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  return numerator > 0 && denominator > 0 ? numerator / denominator : null;
}

export function normalizeAspectMode(value) {
  const raw = String(value ?? "").trim();
  const normalized = raw.toUpperCase();
  if (ASPECT_MODE_IDS.includes(normalized)) {
    return normalized;
  }
  return LEGACY_OBJECT_FIT_MODES[raw.toLowerCase()] || DEFAULT_ASPECT_MODE;
}

export function aspectModeIndex(mode) {
  const index = ASPECT_MODE_IDS.indexOf(normalizeAspectMode(mode));
  return index >= 0 ? index : 0;
}

export function aspectModeNeedsVideoAspect(mode) {
  switch (normalizeAspectMode(mode)) {
    case "FULL_SCREEN":
    case "STRETCH":
    case "VERTICAL_STRETCH":
    case "HORIZONTAL_STRETCH":
      return true;
    default:
      return false;
  }
}

export function resolveAspectScale(mode, viewAspect, videoAspect) {
  const safeViewAspect = positiveNumber(viewAspect);
  if (!safeViewAspect) {
    return { scaleX: 1, scaleY: 1 };
  }

  const normalizedMode = normalizeAspectMode(mode);
  const safeVideoAspect = positiveNumber(videoAspect);
  if (!safeVideoAspect && aspectModeNeedsVideoAspect(normalizedMode)) {
    return { scaleX: 1, scaleY: 1 };
  }

  switch (normalizedMode) {
    case "FULL_SCREEN": {
      const uniformScale =
        safeVideoAspect > safeViewAspect
          ? safeVideoAspect / safeViewAspect
          : safeViewAspect / safeVideoAspect;
      return { scaleX: uniformScale, scaleY: uniformScale };
    }
    case "STRETCH":
      if (safeVideoAspect > safeViewAspect) {
        return { scaleX: 1, scaleY: safeVideoAspect / safeViewAspect };
      }
      return { scaleX: safeViewAspect / safeVideoAspect, scaleY: 1 };
    case "SLIGHT_ZOOM":
      return { scaleX: 1.15, scaleY: 1.15 };
    case "CINEMA_ZOOM":
      return { scaleX: 1.34, scaleY: 1.34 };
    case "ULTRA_ZOOM":
      return { scaleX: 1.55, scaleY: 1.55 };
    case "VERTICAL_STRETCH":
      if (safeVideoAspect > safeViewAspect) {
        const uniformScale = safeVideoAspect / safeViewAspect;
        return { scaleX: uniformScale, scaleY: uniformScale };
      }
      return { scaleX: 1, scaleY: 1 };
    case "HORIZONTAL_STRETCH":
      if (safeVideoAspect < safeViewAspect) {
        const uniformScale = safeViewAspect / safeVideoAspect;
        return { scaleX: uniformScale, scaleY: uniformScale };
      }
      return { scaleX: 1, scaleY: 1 };
    case "ORIGINAL":
    default:
      return { scaleX: 1, scaleY: 1 };
  }
}

export function resolveAspectContentRect(viewportWidth, viewportHeight, videoAspect) {
  const width = positiveNumber(viewportWidth) || 1;
  const height = positiveNumber(viewportHeight) || 1;
  const mediaAspect = positiveNumber(videoAspect) || 16 / 9;
  const viewportAspect = width / height;
  const widthLimited = viewportAspect < mediaAspect;
  const contentWidth = widthLimited ? width : height * mediaAspect;
  const contentHeight = widthLimited ? width / mediaAspect : height;

  return {
    x: (width - contentWidth) / 2,
    y: (height - contentHeight) / 2,
    width: contentWidth,
    height: contentHeight
  };
}

export function resolveTizenDisplayMethod(mode, viewAspect, videoAspect) {
  const normalizedMode = normalizeAspectMode(mode);
  const safeViewAspect = positiveNumber(viewAspect);
  const safeVideoAspect = positiveNumber(videoAspect);
  if (normalizedMode === "FULL_SCREEN" || normalizedMode === "STRETCH") {
    return "PLAYER_DISPLAY_MODE_FULL_SCREEN";
  }

  if (normalizedMode === "VERTICAL_STRETCH") {
    return safeVideoAspect && safeViewAspect && safeVideoAspect > safeViewAspect
      ? "PLAYER_DISPLAY_MODE_FULL_SCREEN"
      : "PLAYER_DISPLAY_MODE_LETTER_BOX";
  }

  if (normalizedMode === "HORIZONTAL_STRETCH") {
    return safeVideoAspect && safeViewAspect && safeVideoAspect < safeViewAspect
      ? "PLAYER_DISPLAY_MODE_FULL_SCREEN"
      : "PLAYER_DISPLAY_MODE_LETTER_BOX";
  }

  // AVPlay has no native zoom primitive. Letter-boxing is the closest
  // aspect-preserving fallback for Original and the two zoom modes.
  return "PLAYER_DISPLAY_MODE_LETTER_BOX";
}

export function resolveAspectRender(mode, viewportWidth, viewportHeight, videoAspect) {
  const contentRect = resolveAspectContentRect(viewportWidth, viewportHeight, videoAspect);
  const viewAspect =
    contentRect.width > 0 && contentRect.height > 0
      ? (positiveNumber(viewportWidth) || 1) / (positiveNumber(viewportHeight) || 1)
      : 0;
  const scale = resolveAspectScale(mode, viewAspect, videoAspect);

  return {
    ...contentRect,
    ...scale,
    viewAspect,
    displayMethod: resolveTizenDisplayMethod(mode, viewAspect, videoAspect)
  };
}
