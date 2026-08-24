// Gate de release: recursos de expressao regular que o Chromium 53 do webOS 4
// nao implementa.
//
// Por que olhar o dist e nao a fonte: quando um literal traz uma flag que o
// alvo nao suporta, o esbuild nao falha o build nem transpila — ele reescreve o
// literal como `new RegExp(source, flags)`, que compila em qualquer engine e so
// estoura como SyntaxError na primeira chamada. Foi assim que
// `/\[spoiler\].*?\[\/spoiler\]/is` derrubou todo o carregamento de comentarios
// do Trakt no C9 sem aparecer em nenhuma etapa do build.
//
// Cobre o que o 53 rejeita: flag `s` (dotAll, ES2018), lookbehind e grupos de
// captura nomeados (ambos ES2018).
import fs from "node:fs";
import path from "node:path";

const DIST = path.resolve("dist");
const TARGETS = ["app.bundle.js", "player.chunk.js"];
const problemas = [];

for (const nome of TARGETS) {
  const arquivo = path.join(DIST, nome);
  if (!fs.existsSync(arquivo)) continue;
  const src = fs.readFileSync(arquivo, "utf8");

  for (const m of src.matchAll(/new RegExp\((?:[^,()]|\([^)]*\))*,\s*"([a-z]+)"/g)) {
    if (m[1].includes("s")) {
      problemas.push(`${nome}: flag dotAll "s" em new RegExp(..., "${m[1]}") @ offset ${m.index}`);
    }
  }
  for (const m of src.matchAll(/\(\?<[=!]/g)) {
    problemas.push(`${nome}: lookbehind @ offset ${m.index}`);
  }
  for (const m of src.matchAll(/\(\?<[A-Za-z_]/g)) {
    problemas.push(`${nome}: grupo de captura nomeado @ offset ${m.index}`);
  }
}

if (!fs.existsSync(DIST)) {
  console.error("dist/ nao existe — rode o build antes deste gate.");
  process.exit(2);
}

if (problemas.length) {
  console.error(`recursos de regex incompativeis com Chromium 53: ${problemas.length}`);
  for (const p of problemas.slice(0, 40)) console.error(`  ${p}`);
  console.error("\nUse [\\s\\S] em vez da flag s; reescreva lookbehind e grupos nomeados.");
  process.exit(1);
}

console.log("regex: nenhum recurso pos-ES2017 encontrado no dist");
