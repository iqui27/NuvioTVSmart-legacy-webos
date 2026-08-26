// Gate de release: identificador usado e nunca declarado.
//
// Existe porque esta classe de defeito nao aparece em nenhuma etapa do build —
// o esbuild empacota `foo` sem reclamar e o ReferenceError so estoura quando
// aquela linha roda. Na pratica isso derrubou a home inteira: o Router captura
// falha de mount num catch e a rebaixa a console.warn, entao a tela ficava vazia
// sem um unico erro visivel. Eram tres identificadores; um quarto grupo, no
// playerController, lancava dentro do handler de erro do hls.js.
//
// Separado do `npm run lint` por dois motivos: o lint do repo cobre so
// js/ui/screens/home/**, e o codigo tem violacoes pre-existentes de
// no-unused-vars que fariam o gate falhar por ruido em vez de por defeito.
import { ESLint } from "eslint";

const eslint = new ESLint({
  overrideConfig: { rules: { "no-undef": "error" } }
});

const resultados = await eslint.lintFiles(["js/**/*.js", "scripts/**/*.mjs"]);
const achados = [];

for (const r of resultados) {
  for (const m of r.messages) {
    if (m.ruleId === "no-undef") {
      achados.push(
        `${r.filePath.replace(process.cwd() + "/", "")}:${m.line}:${m.column} ${m.message}`
      );
    }
  }
}

if (achados.length) {
  console.error(`identificadores usados e nunca declarados: ${achados.length}`);
  for (const a of achados) console.error(`  ${a}`);
  process.exit(1);
}

console.log("no-undef: nenhum identificador orfao em js/ e scripts/");
