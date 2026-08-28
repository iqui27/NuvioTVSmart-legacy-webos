# Post 3 (webOS 3) para r/Nuvio — flair: Unofficial Fork

Nota de forma, pelo mesmo motivo dos anteriores: zero link no corpo, sem numero de
versao no titulo, e o assunto e o achado tecnico. O link do repo vai no primeiro
comentario.

**Título:**
Why Nuvio (and most modern TV web apps) can't just "lower the floor" to a 2016 LG —
what actually blocks Chromium 38

---

Someone with an LG 55UH617V on webOS 3.4.3 asked whether the legacy build I
maintain could run on their set. I assumed the answer was "lower the compatibility
floor and rebuild". I was wrong, and the reason is specific enough to be worth
sharing.

**esbuild refuses to target Chromium 38.** Not "produces something that breaks" —
it stops the build:

```
Transforming const to the configured target environment ("chrome38") is not supported yet
```

Same for `let` and for default arguments. esbuild does not implement full
block-scope lowering, so there is no flag that gets you there. Any project bundling
with esbuild has a hard floor around Chromium 51, whether or not anyone wrote that
down.

The way out is two stages: let esbuild bundle at the lowest target it accepts, then
run the output through Babel `preset-env` down to 38. That is the same trick this
app already uses on its TV background service, which has to reach Node 0.12 —
a runtime old enough that `Readable.prototype.destroy` does not exist.

It builds. Verified in the output: no arrow functions, no generators, no `yield`,
no `regeneratorRuntime` reference. The cost is real though — the main bundle grows
31%, from 1.99 MB to 2.60 MB, because everything block-scoped becomes `var` with
the closure gymnastics that implies. On 2016 silicon that extra parse may itself be
the thing that kills it.

**I don't know if it works.** Nobody involved owns a webOS 3 set. There is an
experimental build for the person who volunteered to test, and their report decides
whether this becomes real support or gets reverted. That is the honest status: a
hypothesis compiled into an IPK.

The general lesson, if you maintain anything for old TVs: the bundler's minimum
target is a constraint people discover by accident, usually late. Worth checking
before promising a platform. I promised webOS 3.x in a README before checking, and
had to correct it publicly.

---

## Primeiro comentário (postar logo depois)

Fork, releases and the platform notes file:
https://github.com/iqui27/NuvioTVSmart-legacy-webos

Original project, which this is derived from:
https://github.com/NuvioMedia/NuvioTVSmart
