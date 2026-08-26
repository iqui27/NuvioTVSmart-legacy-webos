// Gate de release: nenhuma custom property pode chegar ao dist da variante
// webOS 3 (Chromium 38).
//
// Existe porque a falha e SILENCIOSA e total: o motor nao avisa, nao loga, nao
// degrada — ele simplesmente descarta cada declaracao que contem `var()`. Uma
// unica regressao no plugin devolveria um app sem estilo, e o sintoma no
// aparelho ("abriu tudo branco") nao aponta para a causa.
//
// Roda sobre o DIST e nao sobre a fonte, pela mesma razao do checkLegacyRegex:
// o defeito nasce no que foi gerado.
import fs from "node:fs";
import path from "node:path";
import { compatibilityPolicy } from "./compatibilityPolicy.mjs";

const DIST_CSS = path.resolve("dist", "css");

if (!compatibilityPolicy.webOsLegacyBabelTarget) {
  console.log(
    "css-vars: variante sem alvo legado (webOS 4) — custom properties sao suportadas, nada a checar"
  );
  process.exit(0);
}

if (!fs.existsSync(DIST_CSS)) {
  console.error("dist/css nao existe — rode o build antes deste gate.");
  process.exit(2);
}

const problemas = [];
for (const nome of fs.readdirSync(DIST_CSS)) {
  if (!nome.endsWith(".css")) continue;
  const conteudo = fs.readFileSync(path.join(DIST_CSS, nome), "utf8");
  const usos = conteudo.match(/var\(\s*--[\w-]+/g) || [];
  if (usos.length > 0) {
    const nomes = [...new Set(usos.map((u) => u.replace(/var\(\s*/, "")))];
    problemas.push(`${nome}: ${usos.length} uso(s) de var() — ${nomes.slice(0, 8).join(", ")}`);
  }
  // Definicoes tambem nao servem para nada no 38 e indicam que o plugin nao rodou.
  const defs = conteudo.match(/--[\w-]+\s*:/g) || [];
  if (defs.length > 0) {
    problemas.push(`${nome}: ${defs.length} definicao(oes) de custom property remanescente(s)`);
  }
}

if (problemas.length > 0) {
  console.error("custom properties no dist da variante Chromium 38:");
  problemas.forEach((p) => console.error(`  ${p}`));
  console.error(
    "\nCada uma invalida a declaracao inteira no aparelho. Verifique o cssVarsInlinePlugin."
  );
  process.exit(1);
}

console.log("css-vars: nenhuma custom property no dist da variante Chromium 38");
