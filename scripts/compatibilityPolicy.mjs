// VARIANTE EXPERIMENTAL webOS 3.x (Chromium 38).
//
// Existe por causa da issue #1: um usuario com LG 55UH617V em webOS 3.4.3 se
// ofereceu para testar. O piso da branch legacy-tv e 4.0.0 / Chromium 53, e o
// boot guard bloqueia 3.x de proposito — Chromium 38 e outro motor.
//
// NADA aqui foi verificado em aparelho webOS 3: ninguem no projeto tem um. Esta
// branch existe para produzir um IPK que o voluntario possa instalar, e o
// resultado dele e que decide se isso vira suporte de verdade ou volta atras.
export const compatibilityPolicy = Object.freeze({
  tizenSupportYear: 2018,
  webOsSupportYear: 2016,
  webOsRequiredVersion: "3.0.0",
  tizenRequiredVersion: "4.0",
  // O esbuild NAO consegue rebaixar para 38: ele recusa com "Transforming const
  // to the configured target environment (chrome38) is not supported yet", e o
  // mesmo para `let` e argumentos padrao. Entao ele empacota em 53, que e o
  // menor alvo que ele aceita, e um passe Babel posterior leva a 38 — a mesma
  // tecnica que o servico webOS ja usa para chegar ao Node 0.12.
  chromiumVersion: 53,
  webOsChromiumVersion: 38,
  // Alvo do passe Babel pos-bundle e do core-js-compat nesta variante.
  webOsLegacyBabelTarget: Object.freeze({ chrome: "38" }),
  // webOS TV 4.x hosts JS services on Node v0.12.2. esbuild cannot lower
  // async/await straight to that target, so the service is built at es2015 with
  // an explicit feature table (ES5 syntax, generators allowed) and a runtime
  // prelude supplies the missing builtins.
  webOsServiceNodeVersion: "0.12",
  webOsServiceSyntax: Object.freeze({
    target: "es2015",
    supported: Object.freeze({
      arrow: false,
      "const-and-let": false,
      "template-literal": false,
      class: false,
      destructuring: false,
      "object-rest-spread": false,
      "array-spread": false,
      "default-argument": false,
      "for-of": false,
      "object-extensions": false,
      "async-await": false,
      generator: true
    })
  })
});
