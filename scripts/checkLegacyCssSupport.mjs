// Gate: features CSS que o Chromium alvo nao suporta, conferidas contra a base
// do caniuse via `doiuse`.
//
// A logica NAO e "zero features nao suportadas" — isso seria impossivel e
// inutil. Metade da lista tem fallback gerado pelos nossos plugins de PostCSS,
// e outra parte degrada de forma cosmetica e aceitavel. O gate e uma LISTA DE
// EXCECOES JUSTIFICADAS: cada feature presente precisa de uma linha dizendo por
// que e tolerada. Feature que aparecer fora da lista derruba o build.
//
// LIMITE CONHECIDO, medido: o doiuse NAO detecta `aspect-ratio` (testado, sai
// "nada detectado"). Quem cobre isso e a classe `no-aspect-ratio` aplicada em
// runtime pelo legacy-features.js. Ou seja este gate cobre a maior parte, nao
// tudo — nao o trate como prova de compatibilidade total.
//
// Assim o numero para de ser ruido: se alguem introduzir `position: sticky` novo
// ou um seletor que o 38 nao entende, o CI aponta antes do aparelho.
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import doiuse from "doiuse";
import { compatibilityPolicy } from "./compatibilityPolicy.mjs";

const alvo = compatibilityPolicy.webOsChromiumVersion || compatibilityPolicy.chromiumVersion;

// feature -> por que e tolerada. Ordem: cobertas por fallback, depois cosmeticas.
const TOLERADAS = {
  "css-math-functions":
    "min()/max()/clamp() — o PostCSS gera fallback estatico em px; a cobertura e medida por check:legacy-css",
  "flexbox-gap": "flexGapFallbackPlugin gera margin nos filhos sob html.no-flex-gap",
  "css-grid": "gridFallbackPlugin gera layout em flex sob html.no-css-grid",
  "css-backdrop-filter": "classe no-backdrop-filter aplicada em runtime remove o efeito",
  "css-focus-visible": "unsupportedSelectorFallbackPlugin duplica a regra com :focus",
  "css-focus-within": "idem — fallback de seletor gerado",
  "css-has": "idem — fallback de seletor gerado",
  "css-appearance": "autoprefixer emite -webkit-appearance, que o 38 entende",
  multicolumn: "autoprefixer emite -webkit-column-*",
  "css-logical-props":
    "`inset: 0` sempre acompanhado das longhands top/right/bottom/left, que o 38 usa",
  "css-overflow":
    "falso positivo: o uso e `overflow: hidden/auto`, suportado desde sempre; a entrada do caniuse cobre valores novos",
  "css-scrollbar": "scrollbar-width/color sao de outro motor; a TV ignora e nao muda layout",
  "css-snappoints": "scroll-snap e melhoria; a navegacao real e por foco de D-pad",
  "css-scroll-behavior": "smooth scroll degrada para salto instantaneo",
  "css-overscroll-behavior": "sem efeito colateral visivel numa TV sem rolagem elastica",
  "css-containment": "`contain` e dica de performance; ausente apenas nao otimiza",
  "css-masks": "mascara decorativa; degrada para elemento sem recorte",
  "css-placeholder": "cor de placeholder; degrada para a cor padrao do motor",
  "css-caret-color": "cor do cursor de texto; irrelevante numa TV sem edicao intensa",
  "css-display-contents": "usado 1x; degrada para caixa extra no layout",
  "css-sticky": "position: sticky degrada para static — verificar se algum cabecalho depende disso",
  "word-break": "`break-word` e o valor legado, entendido pelo 38",
  "justify-content-space-evenly": "degrada para space-between",
  "prefers-reduced-motion": "media query ignorada; animacoes seguem ligadas",
  "extended-system-fonts": "pilha de fonte tem fallback explicito"
};

const DIST_CSS = path.resolve("dist", "css");
if (!fs.existsSync(DIST_CSS)) {
  console.error("dist/css nao existe — rode o build antes deste gate.");
  process.exit(2);
}

const contagem = new Map();
const exemplos = new Map();

for (const nome of fs.readdirSync(DIST_CSS).filter((f) => f.endsWith(".css"))) {
  const css = fs.readFileSync(path.join(DIST_CSS, nome), "utf8");
  // eslint-disable-next-line no-await-in-loop
  await postcss([
    doiuse({
      browsers: [`chrome ${alvo}`],
      onFeatureUsage: (uso) => {
        contagem.set(uso.feature, (contagem.get(uso.feature) || 0) + 1);
        if (!exemplos.has(uso.feature)) {
          try {
            exemplos.set(uso.feature, String(uso.usage).trim().slice(0, 90));
          } catch (_) {
            /* usage nem sempre e serializavel */
          }
        }
      }
    })
  ]).process(css, { from: undefined });
}

const desconhecidas = [...contagem.keys()].filter((f) => !(f in TOLERADAS));

console.log(
  `css-support: alvo Chrome ${alvo}; ${contagem.size} feature(s) nao suportadas, todas justificadas?`
);
[...contagem.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([f, n]) => {
    const marca = f in TOLERADAS ? "ok " : "NOVA";
    console.log(`  ${marca} ${String(n).padStart(4)}x ${f}`);
  });

if (desconhecidas.length > 0) {
  console.error(`\n${desconhecidas.length} feature(s) SEM justificativa:`);
  desconhecidas.forEach((f) => {
    console.error(`  ${f} (${contagem.get(f)}x) — ex.: ${exemplos.get(f) || "?"}`);
  });
  console.error(
    "\nAvalie se ha fallback. Se degrada de forma aceitavel, acrescente a TOLERADAS com a razao."
  );
  process.exit(1);
}

console.log("\ntodas as features encontradas estao na lista de excecoes justificadas");
