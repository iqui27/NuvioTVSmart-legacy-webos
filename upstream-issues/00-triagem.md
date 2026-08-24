# Triagem: o que vale abrir no upstream e o que nao vale

Critério que descarta a maioria: o 0.3.42 subiu o piso de compatibilidade para
webOS 5.0 / Chromium 68 (`scripts/compatibilityPolicy.mjs`). Defeito que só
aparece no Chromium 53 não é bug para eles — é o motivo deste fork existir, e
mandar como bug deles seria pedir que suportem o que decidiram não suportar.

## Vale abrir (4) — verificados contra a branch `main`, independentes de plataforma

1. `--ass-align-h` / `--ass-align-v` referenciados e nunca definidos → declaração
   `transform` inválida em qualquer engine. Não mando patch: só o autor sabe se é
   código morto ou renderer faltando.
2. Seis dos sete modos de aspecto são `contain` → Crop e Zoom não fazem nada.
3. Pull vazio apaga a lista de addons do usuário → perda de dado, sem erro e sem
   confirmação.
4. Spread de `AudioTrack` nativo não copia nada (getters de prototype) → menu de
   áudio mostra "Audio 1" em vez do idioma.

## NÃO vale abrir

- **Flag `s` (dotAll) em `containsTraktInlineSpoiler`.** Real e derruba todos os
  comentários do Trakt — mas só em engine anterior ao Chromium 62. No piso deles
  (68) funciona. É defeito nosso de fork, não deles.
- **Regex de UA / versão de plataforma.** Já corrigido no 0.3.42: existe
  `parseWebOsMajorVersion` com mapeamento Chromium→webOS. Minha nota anterior de
  que estava quebrado valia para a base 0.3.38.
- **Fallback de Grid no `.player-dialog-item`.** Chromium 68 tem Grid. Só importa
  no 53.
- **`es.array.sort` (sort instável no V8 antigo).** Chrome 68 ainda tem sort
  instável (estável só a partir do 70), então tecnicamente cabe no piso deles —
  mas eu não tenho caso reproduzido de ordenação errada no app, e abrir bug sem
  demonstrar o sintoma gera ruído. Fica pendente de reprodução.
- **`TMPDIR` / EngineFS apagando `/tmp` da TV** e **`Intl.DisplayNames` caindo em
  literal inglês**: precisam de mais uma verificação minha contra o `main` antes
  de virar issue. Não incluí para não afirmar sem medir.

## Antes de publicar

O CONTRIBUTING deles fecha PR sem issue vinculada, então a issue vem primeiro e o
PR referencia o número. Também conferir duplicata: o backlog tem ~757 issues e
vários itens de player/fontes em aberto.
