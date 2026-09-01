/*
 * Extraido de build.mjs para ser compartilhado: o empacotador do webOS precisa do
 * MESMO plugin (e do mesmo skip-list) para gerar a variante 720 do CSS a partir do
 * CSS de 1920 ja construido. Duplicar a regra em dois lugares garantiria divergencia
 * -- e o skip-list e justamente a parte que nao pode divergir.
 */

// Scaling these would change meaning, not size.
export const UI_SCALE_SKIPPED_PROPERTIES = new Set([
  "background-position",
  "background-size",
  "object-position",
  "transform-origin",
  "perspective-origin",
  "stroke-width",
  "flex",
  "flex-basis"
]);

export function uiScalePlugin(scale) {
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
