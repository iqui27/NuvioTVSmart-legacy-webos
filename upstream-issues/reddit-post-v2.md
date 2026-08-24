# Post 2 para r/Nuvio — reescrito do zero

Por que este é diferente do primeiro: o primeiro caiu no filtro do SITE (a
mensagem foi "removed by Reddit's filters", não "by moderators"), e o que o
antispam do Reddit pune é post com forma de anúncio e vários links externos, feito
por conta sem histórico no sub. Então aqui:

- **Zero link no corpo.** O repositório vai no primeiro comentário, depois do post
  sobreviver.
- **Forma de achado técnico, não de lançamento.** O assunto principal é o que eu
  medi sobre a TV, que serve para quem nunca vai instalar nada — e é o que a regra
  do sub chama de "performance and hardware discussion".
- **Sem número de versão no título** e sem palavra de distribuição (download,
  install, build) na primeira linha.
- Flair: `Unofficial Fork` (o post menciona um fork). Se preferir enquadrar como
  discussão técnica, `Discussion & Feedback` também é honesto — mas na dúvida vá
  de Unofficial Fork, que é a mais conservadora.

**Título:**
Three things I measured on a 2019 LG OLED that explain a lot of playback weirdness
(Dolby Vision, letterboxing, MKV)

---

I spent a while getting Nuvio to run on an OLED65C9 — webOS 4.10, Chromium 53,
the generation that 0.3.42 no longer supports. Most of the time went into
measuring the TV rather than writing code, and three of those findings are useful
to anyone here regardless of what app or hardware they use.

**Dolby Vision only engages from an MP4 container.**

I tested the same title in two containers with identical Dolby Vision metadata.
The MP4 engaged DV. The MKV fell back to HDR10. Not a setting, not a bitrate
thing, not the app — the TV's media pipeline. The Jellyfin webOS client runs into
the same wall and works around it on the server side. If DV matters on one of
these sets, the container is the deciding factor, and no player-side option
changes it.

**"Crop" and "Fill" cannot remove letterboxing, and it is not a bug.**

This one surprised me. A 2.39:1 film usually arrives as a 3840x2160 file — frame
aspect 1.778, which is exactly 16:9, exactly the screen. The black bars are part
of the picture, not empty space around it. So `object-fit: cover` and
`object-fit: contain` produce a mathematically identical image, and any "crop to
fill" option that works this way does nothing at all on such a file.

What does work is zooming past the frame edges. The factor is 16/9 divided by the
film's aspect ratio: 1.32 for 2.35:1, 1.34 for 2.39:1, 1.55 for 2.76:1. That last
one is why a single "cinema zoom" preset still leaves a visible bar on the widest
films — 1.33 is simply not enough for a 2.76:1 movie.

**The old engine reports capabilities it does not have, and hides ones it does.**

`CSS.supports("zoom")` answers true and the engine then ignores the property.
`canPlayType("video/x-matroska")` answers with an empty string, and MKV plays
fine. Feature detection is actively misleading on this generation, which is the
single biggest reason old webOS needs different code rather than the same code
with fallbacks.

One more that cost me a full evening: on webOS the video lives on a separate
hardware plane from the UI. A screenshot of playback comes back blank where the
picture should be, so you cannot verify anything about the image programmatically.
Every one of the findings above needed someone looking at the screen.

---

I keep an unofficial fork that lowers the supported floor back to webOS 4.x,
which is where all of this came from. It is not affiliated with the Nuvio project
and everything good in it belongs to the original authors — please support them.
Bugs go to my tracker, not theirs, unless they reproduce on the official build.
Repo link in a comment so this post is about the findings rather than the
download. Tested on exactly one model, so reports from other old sets are what I
actually need.

---

## Primeiro comentário (postar você mesmo, logo depois)

Repo, releases and the platform notes file with everything I measured on this
hardware: https://github.com/iqui27/NuvioTVSmart-legacy-webos

Original project, which this is derived from and which deserves the stars:
https://github.com/NuvioMedia/NuvioTVSmart
