// Fixtures do cssVarsInlinePlugin.
//
// Cada caso aqui corresponde a um padrao real encontrado em css/components.css
// (23 mil linhas), levantado antes de escrever o plugin: tokens em :root, tokens
// escopados a seletor, o mesmo nome com valores diferentes por escopo, var() com
// fallback, cadeia token->token, e token que so existe em runtime.
import postcss from "postcss";
import { cssVarsInlinePlugin } from "./cssVarsInlinePlugin.mjs";

let falhas = 0;
let total = 0;

async function processa(css, options = {}) {
  const result = await postcss([
    cssVarsInlinePlugin({ enabled: true, ...options })
  ]).process(css, { from: undefined });
  return result.css.replace(/\s+/g, " ").trim();
}

async function caso(nome, css, esperado, options) {
  total += 1;
  try {
    const saida = await processa(css, options);
    if (saida === esperado) {
      console.log(`  ok   ${nome}`);
    } else {
      falhas += 1;
      console.log(`  FALHA ${nome}\n    esperado: ${esperado}\n    obtido  : ${saida}`);
    }
  } catch (error) {
    falhas += 1;
    console.log(`  FALHA ${nome} (excecao): ${error.message.slice(0, 160)}`);
  }
}

async function casoQueDeveFalhar(nome, css, trechoEsperado, options) {
  total += 1;
  try {
    await processa(css, options);
    falhas += 1;
    console.log(`  FALHA ${nome}: deveria ter lancado erro e nao lancou`);
  } catch (error) {
    if (error.message.includes(trechoEsperado)) {
      console.log(`  ok   ${nome}`);
    } else {
      falhas += 1;
      console.log(`  FALHA ${nome}: erro diferente do esperado -> ${error.message.slice(0, 160)}`);
    }
  }
}

console.log("cssVarsInlinePlugin:");

// O primeiro caso e o mais importante para a branch webOS 4: com o plugin
// desligado o CSS tem que sair BYTE A BYTE igual ao que entrou, senao ligar a
// variante 38 mudaria o app que ja esta em producao no C9.
{
  total += 1;
  const entrada = ":root { --c: #fff; } .a { color: var(--c); gap: var(--g, 4px); }";
  const saida = await postcss([cssVarsInlinePlugin({ enabled: false })]).process(entrada, {
    from: undefined
  });
  if (saida.css === entrada) {
    console.log("  ok   desligado: saida identica a entrada (protege a variante webOS 4)");
  } else {
    falhas += 1;
    console.log(`  FALHA desligado alterou o CSS:\n    ${saida.css}`);
  }
}

await caso(
  "token em :root",
  ":root { --cor: #fff; } .a { color: var(--cor); }",
  ".a { color: #fff; }"
);

await caso(
  "token escopado a seletor",
  ".home-shell { --largura: 229px; } .home-shell .card { width: var(--largura); }",
  ".home-shell .card { width: 229px; }"
);

await caso(
  "mesmo nome com valor diferente por escopo",
  ".a { --w: 10px; } .b { --w: 20px; } .a .card { width: var(--w); } .b .card { width: var(--w); }",
  ".a .card { width: 10px; } .b .card { width: 20px; }"
);

await caso(
  "escopo vence :root",
  ":root { --w: 1px; } .painel { --w: 9px; } .painel .x { width: var(--w); }",
  ".painel .x { width: 9px; }"
);

await caso(
  "cadeia token -> token",
  ":root { --base: 4px; --dobro: var(--base); } .a { margin: var(--dobro); }",
  ".a { margin: 4px; }"
);

await caso(
  "var() com fallback e token definido: vence a definicao",
  ":root { --g: 12px; } .a { gap: var(--g, 32px); }",
  ".a { gap: 12px; }"
);

await caso(
  "var() com fallback e token AUSENTE: usa o fallback",
  ".a { gap: var(--nao-existe, 32px); }",
  ".a { gap: 32px; }"
);

await caso(
  "token de runtime resolvido pela tabela de defaults",
  ".a { font-size: var(--player-subtitle-font-size); }",
  ".a { font-size: 42px; }",
  { runtimeTokenDefaults: { "--player-subtitle-font-size": "42px" } }
);

await caso(
  "multiplos var() na mesma declaracao",
  ":root { --x: 2px; --y: 4px; } .a { margin: var(--x) var(--y); }",
  ".a { margin: 2px 4px; }"
);

await caso(
  "var() dentro de calc()",
  ":root { --h: 10px; } .a { height: calc(var(--h) * 2); }",
  ".a { height: calc(10px * 2); }"
);

await caso(
  "regra que so definia tokens e removida",
  ":root { --a: 1px; } .b { color: red; }",
  ".b { color: red; }"
);

await caso(
  "token divergente sem alcance textual: clona a regra por escopo",
  ".a { --g: 10px; } .b { --g: 20px; } .card { margin: var(--g); }",
  ".a .card { margin: 10px; } .b .card { margin: 20px; }"
);

await caso(
  "fallback com parenteses aninhados (o caso que o regex nao pegava)",
  ":root { --c: 255 0 0; } .a { background: var(--nao-existe, rgb(var(--c) / 0.05)); }",
  ".a { background: rgb(255 0 0 / 0.05); }"
);

await casoQueDeveFalhar(
  "token sem definicao e sem fallback: build falha",
  ".a { color: var(--fantasma); }",
  "sem valor concreto"
);

console.log(`\n${total - falhas}/${total} casos passaram`);
if (falhas > 0) {
  process.exit(1);
}
