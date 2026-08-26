> ## ⚠️ Unofficial modified build — legacy LG webOS
>
> **This is not the official Nuvio TV.** It is a modified fork, maintained by a
> third party, with one purpose: to keep Nuvio running on **LG TVs with webOS 4.x**
> (2018 and 2019 sets — C9, C8, B9, B8).
>
> **webOS 3.x and older are NOT supported**, and the app refuses to start there on
> purpose: the floor in `scripts/compatibilityPolicy.mjs` is webOS 4.0.0 /
> Chromium 53, while webOS 3.x ships Chromium 38 — a different engine that this
> build's output does not even parse. Supporting it would mean retargeting the
> bundle and widening the polyfill and CSS fallback sets, and I have no webOS 3.x
> set to verify against. If you own one and want to test, open an issue.
>
> Upstream Nuvio TV **0.3.42 requires webOS 5.0.0+ and Chromium 68+**, and its
> boot guard stops the app before it starts on anything older. On an OLED65C9
> (webOS 4.10.0, Chromium 53) the official build shows "TV not supported" and
> exits. This fork lowers that floor and supplies what the older engine and its
> Node 0.12 service runtime actually need.
>
> - **Original project:** [NuvioMedia/NuvioTVSmart](https://github.com/NuvioMedia/NuvioTVSmart) — please star and support the upstream authors.
> - **Base version of this fork:** upstream `0.3.42`.
> - **What was changed and when:** [CHANGES.md](./CHANGES.md) (required by GPLv3 §5a).
> - **Platform notes measured on real hardware:** [LEGACY-WEBOS.md](./LEGACY-WEBOS.md).
> - **Issues:** [iqui27/NuvioTVSmart-legacy-webos/issues](https://github.com/iqui27/NuvioTVSmart-legacy-webos/issues)
> - **Report bugs here, not upstream.** If you can reproduce a problem on the
>   official build, then it belongs upstream.
>
> "Nuvio", the logo and the wordmark belong to the original authors. The GPL
> covers the code, **not** the name or the branding — they appear here only to
> identify the project this is derived from.
>
> ### Which build do I want?
>
> | Your TV                               | Use                                                                         |
> | ------------------------------------- | --------------------------------------------------------------------------- |
> | webOS 5.0+ (2020 and newer)           | the [official release](https://github.com/NuvioMedia/NuvioTVSmart/releases) |
> | webOS 4.x or older (2019 and earlier) | this fork                                                                   |
>
> ### Measured on an LG OLED65C9
>
> |                                  | upstream 0.3.38 baseline | this fork       |
> | -------------------------------- | ------------------------ | --------------- |
> | runs at all on webOS 4.x         | 0.3.42 refuses to start  | yes             |
> | worst frame, cold home traversal | 2988ms                   | 267ms           |
> | total jank, cold traversal       | 8719ms                   | 3183ms          |
> | jank with rows warm              | —                        | 0               |
> | jank during playback             | —                        | 0               |
> | `app.bundle.js`                  | 2,395,432 bytes          | 1,986,869 bytes |
> | core-js bundle                   | 170,926 bytes            | 64,545 bytes    |
>
> ### Startup, measured on the C9 with the 0.3.42 merge
>
> Taken with `globalThis.__NUVIO_DEBUG_HOME_PERF__ = true`, which turns on the
> per-stage probes.
>
> | stage                                 | before         | now    |
> | ------------------------------------- | -------------- | ------ |
> | `installed-addons` (addon manifests)  | 906ms          | 26ms   |
> | profile activation, six local steps   | not attributed | 19ms   |
> | `Router.navigate` → home mounted      | —              | 1440ms |
> | Enter on the profile → home on screen | —              | 1459ms |
> | `startup-sync-await`                  | 2641ms         | gone   |
>
> The manifest cache is upstream's, and it is a clear win — that row is why this
> fork takes their implementation instead of ours. The `startup-sync-await` stage
> no longer exists: home renders from local state and the cloud pull lands in
> place afterwards.
>
> Two numbers that are **not** bottlenecks, measured so nobody chases them:
> `watch-progress-recent` (3082ms) and `watch-progress-all` (2437ms) run inside
> the startup-sync gate and only appear in the stage report about 6s _after_ the
> first paint — they are network wait off the critical path, not CPU.
>
> ### Installing on an older LG
>
> This is the real barrier, and it has nothing to do with the app: LG requires
> Developer Mode to side-load an IPK.
>
> 1. Install **Developer Mode** from the LG Content Store, sign in with an LG
>    developer account, and turn Dev Mode **on**. The TV reboots.
> 2. Note the **passphrase** the Developer Mode app shows — it rotates when the
>    session is renewed.
> 3. On your computer: `npm i -g @webos-tools/cli`, then
>    `ares-setup-device` to add the TV (`prisoner@<tv-ip>:9922`) and
>    `ares-novacom --device <name> --getkey` to fetch the key.
> 4. `ares-install -d <name> NuvioTV-webOS-<version>.ipk`
> 5. `ares-launch -d <name> space.nuvio.webos`
>
> **The dev session expires** (about 50 hours, extendable in the Developer Mode
> app). When it lapses the app stops launching until you renew it — that is LG's
> restriction, not a bug in this build.
>
> ### Known state
>
> Verified on an OLED65C9 (webOS 4.10.0): home, search, detail, source list,
> playback including 4K, Dolby Vision from MP4 sources, audio and subtitle track
> menus naming the language, Trakt sync, watch progress and watched state.
>
> Limitations that are the platform, not the build: **Dolby Vision only engages
> from an MP4 container** — the same release in MKV plays as HDR10, which is why
> the source list ranks MP4 first and labels the container. Tested on exactly one
> model so far; reports from other webOS 4.x sets are welcome.
>
> ### Building and the release gates
>
> Building requires your own `local.properties` — copy
> `local.example.properties` and fill it in. Optional build flags:
> `NUVIO_UI_SCALE` (global UI scale, e.g. `0.8`), `NUVIO_BUILD_LABEL`,
> `NUVIO_IPK_NAME`.
>
> Three checks run in CI, and each one exists because the matching defect reached
> the TV without any build step noticing:
>
> | command                      | catches                                                                                            |
> | ---------------------------- | -------------------------------------------------------------------------------------------------- |
> | `npm run check:no-undef`     | identifier used and never declared — esbuild bundles it happily, `ReferenceError` fires at runtime |
> | `npm run check:legacy-regex` | post-ES2017 regex in `dist/`; a literal with an unsupported flag becomes `new RegExp(src, flags)`  |
> | `npm run check:legacy-css`   | fallback coverage report (informational — it exits 0 on purpose)                                   |
>
> The first one matters more than it sounds: `Router` catches a screen mount
> failure and downgrades it to `console.warn`, so an undeclared identifier in the
> home screen produced an **empty home with no visible error at all**.

---

<div align="center">

  <img src="assets/brand/app_logo_wordmark.png" alt="Nuvio" width="300" />

  <p>
    A free, open-source media app for your phone, your desktop, and the TV you already own.
    <br />
    Bring your own sources. Nuvio turns them into a library with artwork, ratings, subtitles, and your place saved on every screen.
  </p>

[Website](https://nuvio.tv) · [GitHub releases](https://github.com/NuvioMedia/NuvioTVSmart/releases/latest) · [Support Nuvio](https://nuvio.tv/support)

</div>

## Get Nuvio TV

Nuvio TV supports **Samsung Tizen TVs from 2018 onward (Tizen 4+)** and **LG webOS TVs from 2020 onward (webOS 5+)**.
On Tizen 4, some advanced audio/subtitle features may be limited, and torrent/P2P playback is unavailable by design.
On Tizen 5+ and LG webOS, torrent/P2P uses only the bundled local companion service; no external torrent streaming server is configured or required.

- [Nuvio TV Installer](https://github.com/NuvioMedia/NuvioTVSmart-Installer/releases/latest) for Windows, macOS, and Linux
- [Samsung Tizen WGT](https://github.com/NuvioMedia/NuvioTVSmart/releases/latest) for manual installation
- [LG webOS Homebrew repository](https://raw.githubusercontent.com/NuvioMedia/NuvioTVWebOS/main/webosbrew/apps.json)
- [LG webOS IPK](https://github.com/NuvioMedia/NuvioTVSmart/releases/latest) for manual installation

## Build from source

```bash
git clone https://github.com/NuvioMedia/NuvioTVSmart.git NuvioTVSmart
cd NuvioTVSmart
npm install
npm run build
```

Build TV packages with:

```bash
npm run package:tizen
npm run package:tizen:store
npm run package:webos
```

`package:tizen` creates the unsigned WGT used by development and the Nuvio TV Installer. The installer signs it locally for the target TV before installation. `package:tizen:store` is a separate Seller Office build: it requires Tizen Studio/Web CLI and a configured security profile, and creates the signed Store package with the local EngineFS service included so Tizen 5+ retains torrent/P2P playback. Tizen 4 still reports P2P as unsupported at runtime. Nuvio TV is built with JavaScript, HTML, CSS, and platform TV APIs. Building requires Node.js and npm; package installation additionally requires the relevant Tizen or webOS tools.

## License

[GNU General Public License v3.0](./LICENSE)
