# EDIT para acrescentar ao post que já está no ar

Cole isto no fim do post original (no Reddit, editar o post e acrescentar no fim).
Escrito para funcionar como atualização honesta: diz o que mudou, admite o erro do
primeiro build, e não repete o link do repo se ele já estiver no post.

---

**EDIT:** a resposta à pergunta óbvia — "e funcionou?" — é: o primeiro build não
funcionava, e eu publiquei antes de descobrir isso. Vale contar por quê, porque o
erro é instrutivo.

Eu tinha dito que o passe do Babel resolvia o problema. Ele resolve **sintaxe**,
não **polyfills** — e essa distinção era exatamente o que faltava. O build morria
na avaliação do bundle em `Object.assign`, que é Chrome 45 e roda no topo de um
módulo importado pelo router. Atrás dela vinham `Array.from`, `Array.find`,
`String.includes`, e um `fetch` (Chrome 42) que simplesmente não existe e que o
core-js não fornece — ele cobre ECMAScript, não rede.

E havia uma coisa maior que nada disso: **~1.577 usos de CSS custom properties**.
Elas são Chrome 49, e o Chromium 38 não as ignora com elegância — ele descarta a
**declaração inteira** que contém uma. Ou seja, mesmo com todo o JavaScript
consertado, o que subiria seria um app praticamente sem estilo.

O que resolveu foi resolver as variáveis para valores concretos em tempo de build.
Não deu para usar plugin de prateleira: os que existem resolvem tokens declarados
em `:root`, e neste projeto 218 tokens são definidos escopados a seletores, com 43
nomes tendo valores diferentes por escopo — resolver com um valor só pintaria a
variante de layout errada. Os temas viraram folhas de estilo separadas, uma por
paleta, e trocar de tema passou a trocar a folha em vez de chamar `setProperty`,
que é no-op no 38.

Uma nota sobre como verificar isso sem hardware, que talvez seja a parte mais útil
para quem faz coisa parecida: o emulador da LG é imagem x86 e o binário do Chromium
38 para Mac é de 2014, então nenhum dos dois roda em máquina atual. O que funciona
é conferir estaticamente contra a base do caniuse — `eslint-plugin-compat` para
APIs de browser e `doiuse` para CSS, os dois como gate de release, onde cada item
não suportado precisa carregar uma justificativa escrita. Limite que medi e que
vale saber: o `doiuse` **não** detecta `aspect-ratio`.

Esse mesmo gate, aliás, encontrou um bug meu completamente diferente: um marcador
de conflito de merge (`=======`) esquecido dentro de uma regra de CSS, que fazia
uma tela inteira perder o estilo — em **todos** os navegadores, não só nos velhos.
Ele passou porque eu tinha "verificado" aquele merge contando chaves, e um marcador
de conflito não altera a contagem de chaves. Contar símbolo não é validar sintaxe.

Existe um segundo build agora, e ele continua **sem nunca ter rodado num aparelho
webOS 3** — ninguém envolvido tem um. A diferença é que agora ele pode falhar de
forma informativa, em vez de morrer na primeira linha.
