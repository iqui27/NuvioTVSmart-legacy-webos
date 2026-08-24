# Post para r/NuvioApp (ou onde a comunidade do Nuvio estiver)

**Título sugerido:**
Unofficial 0.3.42 build for LG webOS 3.x/4.x (C9, C8, B7 and older) — the
platforms the official build dropped

---

Nuvio TV 0.3.42 raised its floor to webOS 5.0 / Chromium 68, and the boot guard
stops the app before it starts on anything older. On my OLED65C9 (webOS 4.10,
Chromium 53) the official build shows "TV not supported" and exits.

I maintain a fork that lowers that floor, and it is now on the 0.3.42 base:
**https://github.com/iqui27/NuvioTVSmart-legacy-webos**

To be clear about what this is: an **unofficial modified build**, not affiliated
with the Nuvio authors. Everything good in it is theirs. Please star and support
the original project — https://github.com/NuvioMedia/NuvioTVSmart — and report
bugs to *my* repo, not theirs, unless you can reproduce them on the official
build.

## What works on webOS 4.x

Verified on an OLED65C9: home, search, detail, source list, playback including
4K, audio and subtitle menus naming the actual language, Trakt sync, watch
progress and watched state.

## Two things worth knowing even if you never install this

**Dolby Vision only engages from an MP4 container.** Same release, same
`dv_profile 8`: the MP4 went into DV, the MKV played as HDR10. This is the TV's
pipeline, not the app — the Jellyfin webOS client hits the same wall and remuxes
server side. So the source list in this build ranks MP4 first and labels the
container on each source.

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

- Tested on exactly one model — my C9 65". Reports from other webOS 3.x/4.x sets
  are what I need most.
- It is a fork, so it lags upstream releases by however long the merge takes.
- Defects I found that are not specific to old hardware are being reported
  upstream so they get fixed for everyone, and the fork shrinks over time. That
  is the goal, not a permanent parallel app.

GPLv3, same as upstream. Source is the repo; releases carry the matching tag.
