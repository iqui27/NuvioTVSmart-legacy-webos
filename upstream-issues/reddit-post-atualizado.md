# Post do Reddit — versão atualizada (2026-08-29)

Substitui o corpo do post que está no ar. Mantém a estrutura que funcionou e
atualiza: base 1.0.0, webOS 3 deixou de ser "nunca rodou", Dolby Vision com a
causa documentada, e o layout novo. Os links de preview apontam para a LISTA de
releases em vez de uma tag fixa, porque a preview de webOS 3 muda de número
quase todo dia.

---

Nuvio TV 0.3.42 raised its floor to webOS 5.0 / Chromium 68, and the boot guard stops the app before it starts on anything older. On my OLED65C9 (webOS 4.10, Chromium 53) the official build shows "TV not supported" and exits.

I maintain a fork that lowers that floor. It now carries the code from upstream **1.0.0**: https://github.com/iqui27/NuvioTVSmart-legacy-webos

To be clear about what this is: an unofficial modified build, not affiliated with the Nuvio authors. Everything good in it is theirs. Please star and support the original project — https://github.com/NuvioMedia/NuvioTVSmart — and report bugs to my repo, not theirs, unless you can reproduce them on the official build.

**What works on webOS 4.x**

Verified on an OLED65C9: home, search, detail, source list, playback including 4K, audio and subtitle menus naming the actual language, Trakt sync, watch progress and watched state.

**webOS 3.x is no longer a shot in the dark**

The last time I posted, the webOS 3 build had never run on webOS 3 hardware. Two people with old sets have been testing since, and it boots, browses and plays. Fixed along the way, each one reported from a real living room: playback that stalled before the first frame, the back button exiting the app instead of navigating, settings focus that would not scroll with you, blank continue-watching thumbnails, and a new profile inheriting the first profile's addons.

The preview is still a preview — it is the newest pre-release marked `webos3` on the releases page, and it changes often.

**Two things worth knowing even if you never install this**

_Dolby Vision only engages from an MP4 container._

I tested the same title in two containers with identical Dolby Vision metadata — same profile, same level, same compatibility id: the MP4 engaged DV, the MKV fell back to its HDR10 base layer.

The reason is the container, not the video. The TV's pipeline needs Dolby Vision announced by the container — the `dvh1`/`dvhe` sample entry plus the configuration record. Matroska only standardised a way to carry that record in 2021, and the demuxer on these sets predates it, so the DV metadata never reaches the decoder even though the frames are sitting right there. Jellyfin's webOS client hits the same wall and remuxes MKV to MP4 server-side with `-tag:v dvh1`.

One correction to what I assumed earlier: filtering by DV profile does not help. Profile 8.1 in MKV fails exactly like profile 7 on my set.

Practical consequence: if DV matters to you, MP4 is the only container that gets you there. This build labels the container on each entry in the source list, and on webOS it only gives a source the Dolby Vision ranking bonus when the release is actually MP4 — an MKV is never penalised, it just cannot outrank a source that can really deliver DV.

_The old engine lies about what it supports._

`CSS.supports("zoom")` answers true and the engine ignores the property. `canPlayType("video/x-matroska")` answers `""` and MKV plays fine. Feature detection is not trustworthy here, which is most of why a separate build is needed at all.

A newer one, measured this week and genuinely surprising: `MediaSource.isTypeSupported('video/mp4; codecs="dvhe.08.06"')` returns **true** on Chromium 53. I expected false and wrote that prediction down before measuring. What it does refuse is any muxed combination — `dvhe,ec-3` is false, and so is plain `hvc1,ec-3` — while `ec-3` on its own is true. It is not about Dolby Vision or about EAC3; that MSE simply wants video and audio in separate source buffers.

Everything I measured on real hardware is written down in LEGACY-WEBOS.md in the repo — it should be useful to anyone doing webOS work, Nuvio or not.

**What changed since the last post**

Beyond the upstream merges, the parts you would actually notice:

- The home screen stopped being rows of identical posters. Rows now show a handful of titles and end in a door into the full list, each row says what kind of list it is, and the full-list screen has a side panel with the focused title's rating, runtime, genres and synopsis.
- Sharper picture on 4K sets. The app runs at a 1920x1080 viewport, but the panel's device pixel ratio is 2 — so a 4K TV actually draws 3840x2160, and artwork requested at 1280px wide was being upscaled 3x in real pixels. The detail screen now asks for full-size art. The home screen deliberately does not: its hero changes artwork on every move between rows, where full-size art cost 1125ms in a single image decode.
- Navigation is smoother for the same reason, from the other direction: the home hero was downloading 8.3 megapixels per artwork change. Worst frame during a twelve-row descent went from 1290ms to 137ms.
- The subtitle panel was unreadable on these sets and is fixed. Two separate faults, both worth knowing if you write CSS for old engines: list items in a fixed-height flex column were being silently squeezed by the default shrink factor — a 131px row rendered as 40px while its text still drew at full size, spilling over its neighbours — and a grid row's middle cell ended up with zero width once CSS Grid fell back to flex.

**Caveats, honestly**

- Tested on exactly one model — my C9 65". The webOS 3 fixes come from two volunteers' reports; I own no webOS 3 or webOS 5 set. Reports from other sets are still what I need most.
- It is a fork, so it trails official versions by however long the merge takes.
- Defects I find that are not specific to old hardware get reported upstream so they are fixed for everyone and the fork shrinks over time. That is the goal, not a permanent parallel app.
