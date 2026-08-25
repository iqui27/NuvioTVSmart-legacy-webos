// Gate: marcador de conflito e CSS que nao faz parse.
//
// Existe por um defeito que EU introduzi e que chegou a duas releases
// publicadas: o merge do 0.3.42 deixou um `=======` dentro de uma regra em
// css/components.css. Eu havia "verificado" o merge contando chaves — e um
// marcador de conflito nao altera contagem de chaves, entao a verificacao
// passou. O efeito foi silencioso: a regra nao fechava, engolia o bloco
// seguinte, e `.tmdb-entity-shell` (a tela de atores/estudios) ficou sem estilo
// em todas as plataformas.
//
// Licao embutida aqui: contar simbolo nao e validar sintaxe. Quem valida CSS e
// um parser de CSS.
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";

const problemas = [];

// 1) Marcadores de conflito em qualquer fonte versionada relevante.
const RAIZES = ["css", "js", "assets", "scripts", "services"];
const EXTENSOES = new Set([".css", ".js", ".mjs", ".json", ".html", ".xml"]);
const MARCADOR = /^(<{7}|={7}|>{7})(\s|$)/;

function varre(dir) {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const caminho = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === "node_modules" || entrada.name === "generated") continue;
      varre(caminho);
      continue;
    }
    if (!EXTENSOES.has(path.extname(entrada.name))) continue;
    const linhas = fs.readFileSync(caminho, "utf8").split("\n");
    linhas.forEach((linha, i) => {
      if (MARCADOR.test(linha.trim())) {
        problemas.push(`${caminho}:${i + 1}: marcador de conflito -> ${linha.trim().slice(0, 40)}`);
      }
    });
  }
}

RAIZES.filter((r) => fs.existsSync(r)).forEach(varre);

// 2) O CSS precisa fazer parse. Contagem de chaves nao detecta lixo dentro de
//    uma regra; o parser detecta.
for (const arquivo of fs.readdirSync("css").filter((f) => f.endsWith(".css"))) {
  const caminho = path.join("css", arquivo);
  try {
    postcss.parse(fs.readFileSync(caminho, "utf8"), { from: caminho });
  } catch (error) {
    problemas.push(`${caminho}: nao faz parse -> ${error.message}`);
  }
}

if (problemas.length > 0) {
  console.error(`integridade da fonte: ${problemas.length} problema(s)`);
  problemas.forEach((p) => console.error(`  ${p}`));
  process.exit(1);
}

console.log("integridade da fonte: sem marcadores de conflito, CSS faz parse");
