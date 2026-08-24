# Changes made in this fork

Required by the GNU General Public License v3.0, §5(a): a modified work must
carry prominent notices stating that it was changed, and the date of the change.

- **Upstream project:** [NuvioMedia/NuvioTVSmart](https://github.com/NuvioMedia/NuvioTVSmart)
- **Base version:** upstream tag `0.3.42` (merged 2026-08-24)
- **Earlier base:** upstream tag `0.3.38-beta` (commit `0d74fc6`)
- **Modified by:** hrocha
- **Dates of modification:** 2026-08-22 to 2026-08-24
- **License:** unchanged, GPL-3.0. `LICENSE` is byte-identical to upstream.

Everything below was measured on an **LG OLED65C9PSA**, firmware `05.50.00`,
webOS 4.10.0, Chromium 53, JS services on Node v0.12.2.

## Why this fork exists

Upstream `0.3.42` raised the platform floor to **webOS 5.0.0+ / Chromium 68+**
(`scripts/compatibilityPolicy.mjs`), and `boot-guard.js` now stops the app before
startup on anything older. On this TV the official build shows "TV not supported"
and exits.

This fork keeps that policy file at `4.0.0` / Chromium 53 / Node 0.12 and supplies
what the older engine and service runtime need in order for that to be true rather
than merely permitted.

## Defect fixes — these affect any user, not only webOS 4

Each was verified to still be present in upstream `0.3.42`.

| File                                           | Defect                                                                                                                                                                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `js/platform/index.js`                         | The user-agent pattern list has no flag separating engine version from platform version, so every webOS TV reported its Chromium version _as_ the platform version. Consequence: the `legacy-webos` class was never applied and every rule scoped to it was inert. |
| `js/core/profile/librarySyncService.js`        | An empty-but-successful cloud pull **erased the user's installed addon list**. Data loss.                                                                                                                                                                          |
| `js/ui/screens/player/playerScreen.js`         | `{...track}` on a native `AudioTrack` copies nothing — `label`/`language` are prototype getters. The audio menu showed "Audio 1" instead of the language. Measured: `track.language` is `"en"`, `Object.keys(track)` is `[]`, `{...track}` is `{}`.                |
| `js/core/player/playerAspect.js`               | Six of the seven aspect modes were `objectFit: contain`, and on webOS `object-fit` is the only effect applied. "Crop" did nothing to a letterboxed video.                                                                                                          |
| `css/components.css`                           | `.player-dialog-item` used `display: grid` with no fallback. On an engine without Grid the subtitle menu drew the language name, the count badge and the check mark on top of one another.                                                                         |
| `js/ui/screens/player/playerScreen.js`         | `Intl.DisplayNames` is Chrome 81; on older engines the code fell through to a hardcoded **English** literal, putting "Portuguese (Brazil)" in a Portuguese interface. `und` (ISO "undetermined") rendered as "Und" and `uk` rendered as "UK".                      |
| `scripts/build.mjs`                            | `Array.prototype.sort` is not stable in V8 5.3; `es.array.sort` was missing from the core-js set. Non-deterministic stream ordering.                                                                                                                               |
| `js/ui/theme/appFontLoader.js`, `css/base.css` | `font-display` is Chrome 60. Without it a face that becomes matchable while still downloading leaves text **invisible** for up to 3s. The font now loads after first paint, and the family is only named once the face has downloaded.                             |
| `boot-guard.js`                                | `PalmSystem.deviceInfo` carries no `sdkVersion` on this platform.                                                                                                                                                                                                  |
| `services/webos/src/serverHost.js`             | The bundled EngineFS runtime swept `/tmp` and **deleted TV system files**. `TMPDIR`/`TMP`/`TEMP` are redirected to the app directory before the runtime loads.                                                                                                     |

## Platform support for webOS 4 / Chromium 53 / Node 0.12

- **`services/webos/`**: the media runtime is transpiled to ES5 (esbuild cannot
  lower `class` to that target; Babel can), with a prelude supplying missing
  builtins and a `URL`/`URLSearchParams` shim — Node 0.12 has neither the global
  nor `require("url").URL`.
- **CSS fallbacks generated at build time** for CSS Grid, flex `gap`,
  `min()`/`clamp()`, `backdrop-filter` and `aspect-ratio`.
- **`scripts/checkLegacyCss.mjs`**: release gate that reports CSS with no
  fallback for the target, measuring coverage in `dist/` (after PostCSS) rather
  than in source.

## Performance

Cold traversal of 12 home rows, arrow keys only:

|                            | before    | after     |
| -------------------------- | --------- | --------- |
| worst frame                | 2988ms    | 267ms     |
| total jank (frames >120ms) | 8719ms    | 3183ms    |
| jank with rows warm        | —         | 0         |
| jank during playback       | —         | 0         |
| `app.bundle.js`            | 2,395,432 | 1,986,869 |
| core-js                    | 170,926   | 64,545    |
| IPK                        | 5,795,526 | ~4.7 MB   |

Main changes: the player is a separate on-demand chunk; the core-js set is an
explicit 21-module list instead of the full library; locale bundles are
precompiled to JSON instead of parsing 465 KB of XML through `DOMParser`; icons
are inline SVG instead of a remote webfont; the startup sync no longer blocks
first paint.

## Deliberate divergences from upstream

- **`js/core/player/playerController.js`** — upstream made a playlist 404
  terminal for Android TV parity. The bounded retry is kept here because it only
  acts while startup has no media data; established playback is never restarted.
- **`js/ui/screens/home/homeScreen.js`** — upstream `0.3.42` implemented a fast
  Home independently. This fork keeps its own implementation for now, because that
  one was measured on this hardware, while adopting upstream's persistent manifest
  cache for the addon load. To be settled by measurement, not preference.
- **Opinionated UI changes** that are not defect fixes: flat text chips in the
  source list with an MP4 container badge, MP4-first source ordering, reduced
  detail-screen type scale, dimmed watched episodes, and a global UI scale
  (`NUVIO_UI_SCALE`).

## Build flags added

| Flag                | Effect                                                                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NUVIO_UI_SCALE`    | Global UI scale, e.g. `0.8`. Scales `px` only — `vw`/`vh` are the structural layer and scaling them breaks the layout.                                                 |
| `NUVIO_BUILD_LABEL` | Label shown next to the version in Settings. Exists because webOS `appinfo.json` accepts only numeric `x.y.z`, so the version itself cannot say the build is modified. |
| `NUVIO_IPK_NAME`    | Output artifact name.                                                                                                                                                  |
