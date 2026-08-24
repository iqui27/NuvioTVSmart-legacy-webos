> ## ⚠️ Unofficial modified build — legacy LG webOS
>
> **This is not the official Nuvio TV.** It is a modified fork, maintained by a
> third party, with one purpose: to keep Nuvio running on **LG TVs with webOS 4.x
> and older** (C9, C8, B7 and earlier).
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
> Building requires your own `local.properties` — copy
> `local.example.properties` and fill it in. Optional build flags:
> `NUVIO_UI_SCALE` (global UI scale, e.g. `0.8`), `NUVIO_BUILD_LABEL`,
> `NUVIO_IPK_NAME`. Run `npm run check:legacy-css` before releasing.

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
