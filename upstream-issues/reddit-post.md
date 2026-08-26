# Post para r/Nuvio

**Flair obrigatória: `Unofficial Fork`** — existe exatamente para "community-built
custom ports", que é o que isto é. Sem ela o post entra na fila errada.

**Título sugerido:**
[Unofficial Fork] 0.3.42 build for LG webOS 4.x (2018-2019 sets) — the
platforms the official build dropped

**Checado contra as regras do sub (2026-08-24):**

- Regra 2 / política de addons: o texto não cita nenhum scraper de terceiros, nem
  debrid, nem link de conteúdo. Só o cliente, hardware e desempenho — que é
  explicitamente o que pertence ao sub.
- Sem link de doação pessoal (proibido; só link para os devs do Nuvio é aceito).
- **Se você anexar screenshot ou vídeo:** a regra de imagem proíbe logo de
  streaming, emissora ou estúdio, e capa protegida por direito autoral. Print da
  home com pôsteres viola isso. Use a tela de Ajustes, a lista de fontes ou a
  tela de faixas de áudio — sem arte de filme — ou não anexe imagem.

---

Nuvio TV 0.3.42 raised its floor to webOS 5.0 / Chromium 68, and the boot guard
stops the app before it starts on anything older. On my OLED65C9 (webOS 4.10,
Chromium 53) the official build shows "TV not supported" and exits.

I maintain a fork that lowers that floor, and it is now on the 0.3.42 base:
**https://github.com/iqui27/NuvioTVSmart-legacy-webos**

To be clear about what this is: an **unofficial modified build**, not affiliated
with the Nuvio authors. Everything good in it is theirs. Please star and support
the original project — https://github.com/NuvioMedia/NuvioTVSmart — and report
bugs to _my_ repo, not theirs, unless you can reproduce them on the official
build.

## What works on webOS 4.x

Verified on an OLED65C9: home, search, detail, source list, playback including
4K, audio and subtitle menus naming the actual language, Trakt sync, watch
progress and watched state.

## Two things worth knowing even if you never install this

**Dolby Vision only engages from an MP4 container.** I tested the same title in
two containers with identical Dolby Vision metadata: the MP4 engaged DV, the MKV
fell back to HDR10. This is the TV's media pipeline, not the app — the Jellyfin
webOS client runs into the same limitation and works around it on the server
side. Practical consequence for anyone on these sets: if DV matters to you, an
MP4 is the only container that gets you there. This build labels the container on
each entry in the source list so you can see it before you commit.

**The old engine lies about what it supports.** `CSS.supports("zoom")` answers
`true` and the engine ignores the property. `canPlayType("video/x-matroska")`
answers `""` and MKV plays fine. Feature detection is not trustworthy here, which
is most of why a separate build is needed at all. I wrote down everything I
measured on real hardware in `LEGACY-WEBOS.md` in the repo — it should be useful
to anyone doing webOS work, Nuvio or not.

## Speed

The 0.3.42 base brought a persistent addon manifest cache that is a real
improvement on slow hardware: the addon stage went from 906ms to 26ms on my C9.
Pressing Enter on a profile to a painted home is about 1.5s.

## Installing is the annoying part, and that is LG's fault

Side-loading needs Developer Mode: LG developer account, Dev Mode app, TV reboot,
then `ares-install` from a computer. **The dev session expires after roughly 50
hours** and the app stops launching until you renew it in the Dev Mode app. Full
step by step is in the README.

## Caveats, honestly

- Tested on exactly one model — my C9 65". Reports from other webOS 4.x sets
  are what I need most.
- It is a fork, so it trails official versions by however long the merge takes.
- Defects I found that are not specific to old hardware are being reported
  upstream so they get fixed for everyone, and the fork shrinks over time. That
  is the goal, not a permanent parallel app.

GPLv3, same as upstream. Source is the repo; releases carry the matching tag.
