// Gate: APIs de browser que o Chromium alvo nao tem, conferidas contra a base do
// caniuse via `eslint-plugin-compat`.
//
// Complementa o check:no-undef, que so ve identificador nunca declarado no nosso
// codigo. Aqui o alvo e outro: API que EXISTE no navegador moderno, esta escrita
// corretamente, e simplesmente nao existe no aparelho. `fetch` e o exemplo — o
// core-js nao o fornece porque cobre ECMAScript, nao rede.
//
// Como o CSS: lista de excecoes justificadas, e cada entrada diz o que a cobre.
// API nova sem justificativa derruba o build. Sem isso a lista viraria ruido,
// porque a ferramenta nao sabe que carregamos polyfills.
import { ESLint } from "eslint";
import compat from "eslint-plugin-compat";
import { compatibilityPolicy } from "./compatibilityPolicy.mjs";

const alvo = compatibilityPolicy.webOsChromiumVersion || compatibilityPolicy.chromiumVersion;

const COBERTAS = {
  // core-js, listadas em CORE_JS_MODULES no build.mjs
  "Object.assign()": "core-js es.object.assign",
  "Object.entries()": "core-js es.object.entries",
  "Object.values()": "core-js es.object.values",
  "Object.fromEntries()": "core-js es.object.from-entries",
  "Array.from()": "core-js es.array.from",
  "Array.find()": "core-js es.array.find",
  "Array.includes()": "core-js es.array.includes",
  "Array.flatMap()": "core-js es.array.flat-map",
  "String.startsWith()": "core-js es.string.starts-with",
  "String.endsWith()": "core-js es.string.ends-with",
  "String.includes()": "core-js es.string.includes",
  "String.padStart()": "core-js es.string.pad-start",
  "String.padEnd()": "core-js es.string.pad-end",
  "String.replaceAll()": "core-js es.string.replace-all",
  "Promise.allSettled()": "core-js es.promise.all-settled",
  URLSearchParams: "core-js web.url-search-params",
  "URLSearchParams.get()": "core-js web.url-search-params",

  // whatwg-fetch, incluido no bundle de polyfills da variante legada
  fetch: "whatwg-fetch (XHR por baixo)",
  Headers: "whatwg-fetch",
  Request: "whatwg-fetch",
  Response: "whatwg-fetch",

  // Guardadas por `typeof` no proprio codigo — ausencia e caminho previsto
  AbortController: "usado sempre atras de typeof; cai em Promise.race quando falta",
  requestIdleCallback: "atras de typeof; cai em setTimeout",
  "navigator.mediaSession()": "atras de typeof; sem controles de midia do sistema",
  "navigator.wakeLock()": "atras de typeof; a TV ja suprime o protetor por outro caminho",
  "navigator.deviceMemory()": "leitura opcional para perfil de performance; undefined e tratado"
};

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ["**/*.js"],
      plugins: { compat },
      settings: { browsers: [`chrome ${alvo}`], lintAllEsApis: false },
      languageOptions: { ecmaVersion: 2022, sourceType: "module" },
      rules: { "compat/compat": "error" }
    }
  ]
});

const resultados = await eslint.lintFiles(["js/**/*.js", "assets/runtime/*.js"]);
const encontradas = new Map();

for (const arquivo of resultados) {
  for (const m of arquivo.messages) {
    if (m.ruleId !== "compat/compat") continue;
    const api = (m.message.match(/^(.+?) is not supported/) || [, m.message])[1];
    const entrada = encontradas.get(api) || { n: 0, onde: [] };
    entrada.n += 1;
    if (entrada.onde.length < 3) {
      entrada.onde.push(`${arquivo.filePath.replace(process.cwd() + "/", "")}:${m.line}`);
    }
    encontradas.set(api, entrada);
  }
}

const semJustificativa = [...encontradas.keys()].filter((api) => !(api in COBERTAS));

console.log(`js-apis: alvo Chrome ${alvo}; ${encontradas.size} API(s) ausentes no motor`);
[...encontradas.entries()]
  .sort((a, b) => b[1].n - a[1].n)
  .forEach(([api, e]) => {
    console.log(`  ${api in COBERTAS ? "ok " : "NOVA"} ${String(e.n).padStart(4)}x ${api}`);
  });

if (semJustificativa.length > 0) {
  console.error(`\n${semJustificativa.length} API(s) sem cobertura declarada:`);
  semJustificativa.forEach((api) => {
    const e = encontradas.get(api);
    console.error(`  ${api} (${e.n}x) — ${e.onde.join(", ")}`);
  });
  console.error(
    "\nOu acrescente o polyfill (CORE_JS_MODULES / bundle de polyfills), ou guarde o uso com" +
      " `typeof`, ou registre em COBERTAS explicando por que a ausencia e aceitavel."
  );
  process.exit(1);
}

console.log("\ntodas as APIs ausentes tem cobertura declarada");
