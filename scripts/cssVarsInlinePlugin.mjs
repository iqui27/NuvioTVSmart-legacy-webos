// Plugin PostCSS que resolve custom properties para valores concretos.
//
// Em modulo proprio (e nao dentro de build.mjs) por um motivo pratico: build.mjs
// executa o build inteiro ao ser importado, entao um plugin morando la e
// impossivel de testar isoladamente. Aqui ele tem fixtures em
// scripts/testCssVarsInline.mjs.

/**
 * Resolve `var(--token)` para valores concretos. So roda na variante webOS 3.
 *
 * Custom properties chegaram no Chrome 49; o Chromium 38 do webOS 3 nao as tem
 * e descarta a declaracao INTEIRA que as usa — sao 1577 usos em
 * css/components.css, ou seja praticamente todo o visual do app.
 *
 * Por que nao `postcss-custom-properties` de prateleira: ele resolve tokens
 * declarados em `:root`. Aqui 218 tokens sao definidos ESCOPADOS a seletores
 * (`#playerUiRoot`, `.home-shell`, `.home-screen-shell.home-layout-modern`...),
 * e 43 nomes tem definicoes diferentes por escopo — resolver com um valor so
 * daria estilo errado nas variantes de layout.
 *
 * Sobre `var(--x, fallback)`: no Chromium 38 o fallback embutido NAO salva a
 * declaracao; a sintaxe inteira e invalida do mesmo jeito. Por isso os 109 casos
 * com default tambem precisam passar por aqui — o fallback vira o valor literal
 * quando o token so existe em runtime.
 */
export function cssVarsInlinePlugin({
  enabled = false,
  runtimeTokenDefaults = {},
  dropDeclarationsUsing = [],
  globalCss = ""
} = {}) {
  return {
    postcssPlugin: "nuvio-css-vars-inline",
    OnceExit(root, { result, postcss }) {
      if (!enabled) {
        return;
      }

      // 1) Coleta: token -> lista de { escopo, valor }. `:root` e universal.
      //
      // `globalCss` existe porque o pipeline processa cada arquivo isolado e o
      // `@csstools/postcss-global-data` NAO injeta declaracoes no AST — ele so
      // expoe o arquivo a plugins que sabem consulta-lo. Sem passar o base.css
      // aqui, os ~35 tokens de tema definidos no `:root` dele ficam invisiveis e
      // o plugin acusa 148 nomes "sem valor", sendo que a maioria esta definida.
      const definitions = new Map();

      function coleta(container) {
        container.walkDecls((decl) => {
          if (!decl.prop.startsWith("--")) {
            return;
          }
          const scope = decl.parent && decl.parent.type === "rule" ? decl.parent.selector : "";
          const isRoot = /^:root\b/.test(scope) || scope === "html";
          const entry = definitions.get(decl.prop) || [];
          const existing = entry.findIndex((item) => item.scope === (isRoot ? "" : scope));
          const record = { scope: isRoot ? "" : scope, value: decl.value, isRoot };
          if (existing >= 0) {
            entry[existing] = record;
          } else {
            entry.push(record);
          }
          definitions.set(decl.prop, entry);
        });
      }

      if (globalCss) {
        coleta(postcss.parse(globalCss, { from: undefined }));
      }
      coleta(root);

      // 2) Resolucao de token -> token, com deteccao de ciclo.
      const resolving = new Set();
      function resolveValue(value, scopeSelector, depth = 0) {
        if (depth > 12 || value.indexOf("var(") === -1) {
          return value;
        }
        return replaceVarCalls(value, (match, token, fallback) => {
          const name = token.trim();
          if (resolving.has(name)) {
            result.warn(`ciclo de custom property em ${name}`);
            return fallback !== undefined ? fallback.trim() : match;
          }
          const resolved = lookup(name, scopeSelector);
          if (resolved === null) {
            if (fallback !== undefined) {
              return resolveValue(fallback.trim(), scopeSelector, depth + 1);
            }
            if (Object.prototype.hasOwnProperty.call(runtimeTokenDefaults, name)) {
              return runtimeTokenDefaults[name];
            }
            return match;
          }
          resolving.add(name);
          const out = resolveValue(resolved, scopeSelector, depth + 1);
          resolving.delete(name);
          return out;
        });
      }

      const ambiguos = new Map();

      function lookup(name, scopeSelector) {
        const entry = definitions.get(name);
        if (!entry || entry.length === 0) {
          return null;
        }
        // 1) Escopo que "alcanca" este seletor textualmente vence.
        const scoped = entry.filter(
          (item) => item.scope && selectorIsWithin(scopeSelector, item.scope)
        );
        if (scoped.length > 0) {
          return scoped[scoped.length - 1].value;
        }
        // 2) :root e o piso.
        const rootDef = entry.find((item) => item.isRoot || !item.scope);
        if (rootDef) {
          return rootDef.value;
        }
        // 3) Sem correspondencia textual. Isto e a regra, nao a excecao: o token
        //    e definido num container (`#playerUiRoot`, `.series-detail-shell`) e
        //    usado numa regra cujo seletor nao cita esse container — a heranca
        //    acontece no DOM em runtime, nao no texto do seletor.
        //
        //    Se todas as definicoes concordam no valor, nao ha ambiguidade: o
        //    valor e o mesmo qualquer que seja o container.
        const valores = [...new Set(entry.map((item) => item.value))];
        if (valores.length === 1) {
          return valores[0];
        }
        // Definicoes divergentes e nenhuma alcancavel pelo texto: escolher uma
        // seria pintar a variante de layout errada em silencio. Registra para o
        // relatorio e deixa o build falhar.
        ambiguos.set(
          name,
          entry.map((item) => `${item.scope || ":root"} => ${item.value}`)
        );
        return null;
      }

      // 3) Substituicao.
      const unresolved = new Map();
      const clonagens = [];
      root.walkDecls((decl) => {
        if (decl.prop.startsWith("--") || decl.value.indexOf("var(") === -1) {
          return;
        }
        const scopeSelector =
          decl.parent && decl.parent.type === "rule" ? decl.parent.selector : "";
        ambiguos.clear();
        const next = resolveValue(decl.value, scopeSelector);
        if (next !== decl.value) {
          decl.value = next;
        }
        // Token com valores divergentes por escopo e sem alcance textual: uma
        // declaracao so nao consegue representar os N casos. Emite uma copia da
        // regra por escopo, com o seletor prefixado — e o mesmo padrao que o
        // gridFallbackPlugin ja usa para variantes de layout.
        if (
          decl.value.indexOf("var(") !== -1 &&
          ambiguos.size > 0 &&
          decl.parent &&
          decl.parent.type === "rule"
        ) {
          const nomeAmbiguo = [...ambiguos.keys()][0];
          const escopos = (definitions.get(nomeAmbiguo) || []).filter((item) => item.scope);
          if (escopos.length > 1) {
            clonagens.push({ decl, nome: nomeAmbiguo, escopos, valorOriginal: decl.value });
          }
        }
      });

      // 3b) Executa as clonagens depois do walk, para nao mutar a arvore durante
      //     a travessia.
      clonagens.forEach(({ decl, nome, escopos, valorOriginal }) => {
        const regra = decl.parent;
        if (!regra || !regra.parent) {
          return;
        }
        // `insertAfter` sempre a partir do ultimo inserido, e nao da regra
        // original: inserir sempre depois da original sairia com os escopos em
        // ordem invertida, e no CSS a ordem decide o desempate de especificidade
        // igual.
        let ancora = regra;
        escopos.forEach((escopo) => {
          const seletorPrefixado = regra.selector
            .split(",")
            .map((parte) => `${escopo.scope} ${parte.trim()}`)
            .join(", ");
          const clone = regra.clone({ selector: seletorPrefixado });
          clone.removeAll();
          const declClone = decl.clone({
            value: valorOriginal.replace(
              new RegExp(`var\\(\\s*${nome}\\s*(?:,[^)]*)?\\)`, "g"),
              () => resolveValue(escopo.value, escopo.scope)
            )
          });
          clone.append(declClone);
          regra.parent.insertAfter(ancora, clone);
          ancora = clone;
        });
        // A declaracao original com var() sai: no 38 ela seria descartada de
        // qualquer forma, e mante-la so confundiria a cascata dos clones.
        decl.remove();
      });

      // 3c) So agora o que sobrou e realmente irresoluvel: contar antes da
      //     clonagem acusaria justamente o que ela conserta.
      root.walkDecls((decl) => {
        if (decl.prop.startsWith("--") || decl.value.indexOf("var(") === -1) {
          return;
        }
        const names = decl.value.match(/var\(\s*(--[\w-]+)/g) || [];
        names.forEach((raw) => {
          const name = raw.replace(/var\(\s*/, "");
          unresolved.set(name, (unresolved.get(name) || 0) + 1);
        });
      });

      // 3d) Declaracoes que usam token inexistente em qualquer navegador saem
      //     inteiras. Nao e perda: elas ja sao invalidas em Chrome moderno, e
      //     inventar valor aqui mudaria a aparencia so no webOS 3.
      const aRemover = new Set(dropDeclarationsUsing);
      if (aRemover.size > 0) {
        root.walkDecls((decl) => {
          if (decl.value.indexOf("var(") === -1) {
            return;
          }
          const usa = [...aRemover].some((nome) => decl.value.indexOf(nome) !== -1);
          if (usa) {
            unresolved.delete(decl.prop);
            decl.remove();
          }
        });
        [...aRemover].forEach((nome) => unresolved.delete(nome));
      }

      // 4) As proprias definicoes viram peso morto no 38 — o motor nem as
      //    entende. Removidas depois da substituicao, nunca antes.
      root.walkDecls((decl) => {
        if (decl.prop.startsWith("--")) {
          decl.remove();
        }
      });
      root.walkRules((rule) => {
        if (rule.nodes && rule.nodes.length === 0) {
          rule.remove();
        }
      });

      if (unresolved.size > 0) {
        const lista = [...unresolved.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([name, count]) => `${name} (${count}x)`)
          .join(", ");
        const detalheAmbiguo = [...ambiguos.entries()]
          .filter(([name]) => unresolved.has(name))
          .map(([name, escopos]) => `\n  ${name}: ${escopos.join(" | ")}`)
          .join("");
        throw new Error(
          `cssVarsInlinePlugin: ${unresolved.size} custom propertie(s) sem valor concreto ` +
            `no alvo Chromium 38. Cada uma invalida a declaracao inteira no aparelho. ` +
            `Defina no CSS ou acrescente a runtimeTokenDefaults: ${lista}` +
            (detalheAmbiguo ? `\n\nCom definicoes divergentes por escopo:${detalheAmbiguo}` : "")
        );
      }
    }
  };
}
cssVarsInlinePlugin.postcss = true;

/**
 * Percorre `value` trocando cada `var(...)` de nivel superior.
 *
 * Feito a mao e nao por regex porque o fallback pode ter parenteses aninhados —
 * `var(--x, rgb(var(--y) / 0.05))` aparece 6 vezes em components.css, e um
 * padrao com aninhamento fixo simplesmente NAO casa nesses casos: a declaracao
 * passaria batida e chegaria ao aparelho com `var()` intacto, que e exatamente
 * o que este plugin existe para impedir.
 */
function replaceVarCalls(value, substituir) {
  let saida = "";
  let i = 0;
  while (i < value.length) {
    const inicio = value.indexOf("var(", i);
    if (inicio === -1) {
      saida += value.slice(i);
      break;
    }
    saida += value.slice(i, inicio);
    let profundidade = 0;
    let fim = -1;
    for (let j = inicio + 3; j < value.length; j += 1) {
      if (value[j] === "(") {
        profundidade += 1;
      } else if (value[j] === ")") {
        profundidade -= 1;
        if (profundidade === 0) {
          fim = j;
          break;
        }
      }
    }
    if (fim === -1) {
      // `var(` sem fechamento: CSS invalido de origem, devolvido intacto.
      saida += value.slice(inicio);
      break;
    }
    const interior = value.slice(inicio + 4, fim);
    const virgula = encontraVirgulaDeTopo(interior);
    const token = (virgula === -1 ? interior : interior.slice(0, virgula)).trim();
    const fallback = virgula === -1 ? undefined : interior.slice(virgula + 1).trim();
    saida += substituir(value.slice(inicio, fim + 1), token, fallback);
    i = fim + 1;
  }
  return saida;
}

/** Primeira virgula fora de parenteses — separa o token do fallback. */
function encontraVirgulaDeTopo(texto) {
  let profundidade = 0;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i];
    if (c === "(") profundidade += 1;
    else if (c === ")") profundidade -= 1;
    else if (c === "," && profundidade === 0) return i;
  }
  return -1;
}

/**
 * `.a .b` esta "dentro de" `.a`? Comparacao textual conservadora: usada para
 * decidir qual definicao escopada de um token vale para uma regra. Prefixo ou
 * presenca do escopo como parte composta do seletor conta como alcance.
 */
function selectorIsWithin(selector, scope) {
  if (!selector || !scope) {
    return false;
  }
  return selector.split(",").some((part) => {
    const trimmed = part.trim();
    return scope.split(",").some((scopePart) => {
      const s = scopePart.trim();
      return trimmed === s || trimmed.startsWith(s + " ") || trimmed.indexOf(s) !== -1;
    });
  });
}
