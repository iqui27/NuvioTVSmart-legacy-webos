export const compatibilityPolicy = Object.freeze({
  tizenSupportYear: 2018,
  webOsSupportYear: 2019,
  webOsRequiredVersion: "4.0.0",
  tizenRequiredVersion: "4.0",
  chromiumVersion: 53,
  webOsChromiumVersion: 53,
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
