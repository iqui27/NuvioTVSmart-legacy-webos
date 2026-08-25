/**
 * Suporte a CSS custom properties, sondado UMA vez no load do modulo.
 *
 * Custom properties chegaram no Chrome 49; o Chromium 38 do webOS 3 nao as tem
 * e `element.style.setProperty("--x", ...)` la e um no-op silencioso. Este
 * modulo e a fonte unica dessa capacidade para o codigo de runtime — mesma
 * sonda que assets/runtime/legacy-features.js usa para a classe `no-css-vars`
 * no CSS. Em modulo proprio (e nao no themeManager) porque quem precisa dele
 * inclui codigo de js/core (assRenderer), que nao deve importar de js/ui.
 *
 * `CSS.supports("--probe", "0")` responde true em qualquer motor com custom
 * properties e false (ou nem existe CSS.supports valido para isso) no 38.
 */
export const SUPPORTS_CSS_VARS =
  typeof window !== "undefined" &&
  !!window.CSS &&
  typeof window.CSS.supports === "function" &&
  window.CSS.supports("--probe", "0");
