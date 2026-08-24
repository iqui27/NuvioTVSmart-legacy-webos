# Building web apps for legacy LG webOS — measured facts

Everything here was measured on an **LG OLED65C9PSA**, firmware `05.50.00`,
webOS 4.10.0, **Chromium 53**, JS services on **Node v0.12.2**, `devicePixelRatio`
2, `screen` 3840×2160 with a 1920×1080 CSS viewport.

None of it is inferred from a compatibility table. Each line cost a wrong
hypothesis, and several contradict what the platform itself reports.

## Feature detection lies. Verify on the device.

- **`CSS.supports("zoom", "0.85")` returns `true` and the engine ignores the
  property.** A card measured 419×240 before and after applying `zoom: 0.85`.
- **`canPlayType("video/x-matroska")` returns `""`** — the empty string, meaning
  unsupported — **and MKV files play fine.** Every variant, including
  `video/x-matroska; codecs="dvhe.08.06"`, returns empty. Meanwhile
  `video/mp4; codecs="dvhe.08.06"` returns `"probably"`.
- Declaring `type="video/x-matroska"` on a `<source>` **fails the load outright**
  (`networkState` 3, `NETWORK_EMPTY`). This is why a player must hand MKV to the
  element with no type at all and let the TV sniff it.
- `Array.prototype.sort` is **not stable** (stability landed in Chrome 70), for
  arrays longer than 10 elements.

## Dolby Vision only comes out of an MP4 container

Two releases of the same film, identical DV metadata — `dv_profile 8`,
`dv_level 6`, `rpu_present_flag 1`, `bl_signal_compatibility_id 1`:

| container                   | `content-type`             | result on the panel    |
| --------------------------- | -------------------------- | ---------------------- |
| MP4 / ISOBMFF (`ftyp isom`) | `video/mp4`                | **Dolby Vision**       |
| Matroska (`EBML`)           | `application/octet-stream` | HDR10 (the base layer) |

Confirmed independently: LG's own forums state the internal player does not
detect Dolby Vision in MKV, and Jellyfin's webOS app hits the same wall and
remuxes to MP4/TS server-side. `dvmkv2mp4` exists for exactly this.

Things that do **not** help, all tried on the device: declaring
`video/mp4; codecs="dvhe.08.06"` on an MKV (plays, still HDR10); declaring
`video/x-matroska` (breaks the load); `mediaOption` with
`mediaTransportType: "URI"` plus 4K caps (plays, still HDR10); toggling
`object-fit`. For DV profile 8.1 the HDR10 you get is the designed base layer —
correct picture, no dynamic per-scene metadata.

The picture settings are ACG-locked for a dev app: `com.webos.settingsservice`
returns `Access denied`, and `com.webos.media` denies `getActivePipelines`. There
is no programmatic way to read the current HDR mode — only the panel's own menu.

## CDP debugging over `http://TV:9998/json`

- **`Page.captureScreenshot` does not exist** on this build. `Page.startScreencast`
  does, and it delivers frames as `Page.screencastFrame` events — but only when
  the screen actually changes.
- `Page.getLayoutMetrics` and `Emulation.setDeviceMetricsOverride` do not exist.
  `DOM`, `CSS`, `Runtime`, `Input` and `Page.enable` do.
- **`Runtime.evaluate` does not support `awaitPromise`.** Write to `window.__x` in
  one call, read it in a second.
- `Runtime.consoleAPICalled` and the `Network` domain yield nothing. To capture
  console output, install a collector with
  `Page.addScriptToEvaluateOnLoad` before `Page.reload` and wrap
  `window.onerror` / `console.error` into an array you read later.
- Native HLS playback happens below Chromium, so the `Network` domain never sees
  the segments.

## Synthetic input

- **Back is keyCode 461**, not Backspace. `history.back()` is not the app's back
  path and does nothing useful.
- **Enter needs the `char` event**: dispatch `rawKeyDown`, then `char` with
  `text: "\r"`, then `keyUp`. Without the `char` step nothing happens, which is
  easy to misread as "synthetic Enter does not work on this platform".
- Arrow keys work with `rawKeyDown` + `keyUp` alone.

## Reading the DOM

- **`visibility` is not a screen discriminator.** Every screen element reports
  `visibility: visible` at all times. Use
  `display !== "none" && children.length > 0`.
- **An inline style set on a screen element gets overwritten by that screen's own
  render pass.** Measured on the home screen: an inline `transform` reverted to
  identity within a frame, while the same declaration from an injected stylesheet
  with `!important` stuck.
- `textContent` concatenates adjacent inline nodes with no separator regardless of
  CSS, so it cannot be used to diagnose "text looks glued together". Measure
  `getBoundingClientRect` and `getComputedStyle`.
- `focus({ preventScroll })` and `addEventListener(..., { once: true })` **are**
  supported. `scrollIntoView(options)` silently coerces its argument to `true`
  instead of throwing.

## CSS the engine cannot use

No CSS Grid (Chrome 57), no flex `gap` (84), no `min()`/`max()`/`clamp()` (79), no
`backdrop-filter` (76), no `aspect-ratio` (88), no `content-visibility` (85), no
`position: sticky` (56), no `:focus-visible` (86). `transform`, flexbox, CSS
custom properties and `contain: layout paint` all work.

Two traps in the build pipeline itself, if you use PostCSS to generate fallbacks:

1. **The generated fallbacks exist only in the build output.** Grepping the source
   for `no-css-grid` returns nothing and leads straight to the wrong conclusion
   that no fallback exists. Grep `dist/`.
2. **PostCSS deduplicates declarations of the same property and keeps the last
   one.** A hand-written pair `margin-left: 8px; margin-left: min(0.42vw, 8px)`
   therefore loses its fallback and computes to `0` on this engine. Write the
   modern value alone and let the pipeline add the fallback — or write plain `px`.

Also: a fallback existing is not the same as a fallback being correct. The
generated fallback for a two-row grid was `flex-wrap: nowrap`, which cannot
reproduce two rows.

## Image decode is the cost, not the network

A cold downward traversal of 12 home rows spent 3183ms in frames over 120ms, and
the number did not change with the images already in the HTTP cache (3983ms vs
3817ms). Roughly 41ms per poster. With the rows warm, the same traversal produced
**zero** long frames.

`img.decode()` does not exist (Chrome 64). `createImageBitmap` exists but
`ImageBitmapOptions.resizeWidth` only landed in Chrome 54, and drawing the result
still happens on the main thread. `decoding="async"`, `loading` and
`fetchpriority` attributes are all inert here.

At `devicePixelRatio` 2 a 221 CSS-px poster slot needs 442 device pixels, so a
TMDB `w500` image is appropriately sized — do not "optimise" it down to `w342`.

## Node 0.12 in the JS service

No WHATWG `URL` — and `require("url").URL` is `undefined` too, so a `new URL()`
inside a `try/catch` turns every request into a silent "Invalid URL". No
`Readable.prototype.destroy` (Node 8), no `readableHighWaterMark` (8), no
`Number.MAX_SAFE_INTEGER`, and `Buffer` is not a `Uint8Array` subclass.

esbuild cannot lower `class` to this target. Babel with
`@babel/preset-env` and `targets: { node: "0.12" }` can.

## Platform identity

`webOS.deviceInfo` on this set reports `modelName: "OLED65C9PSA"`,
`version: "05.50.00"`, `versionMajor: 5`, `sdkVersion: "4.10.0"`, `uhd: true`,
`hdr10: true`, `dolbyVision: true`, `dolbyAtmos: true`, `oled: true`,
`ddrSize: "3G"`.

Note the trap: **firmware major is 5 while the SDK is 4.10.** A user-agent parser
that does not separate engine version from platform version will read the
Chromium version as the platform version — which is the defect described in
`CHANGES.md`.

`appinfo.json`'s `version` accepts **only** three numeric components. Per LG's
documentation: "The major, minor, and revision numbers are all mandatory; if any
is missing, the app may not be installed." No letters, no hyphen, no `+build`
suffix — a fork label has to live somewhere else.

## Operational notes

- `ares-install` builds a shell command on the TV, so an artifact filename
  containing `'` or `()` fails with `sh: syntax error`.
- The Developer Mode SSH passphrase rotates; re-read it from the Developer Mode
  app when authentication starts failing.
- On this machine, `curl http://TV:9998/json` returns a type schema instead of the
  JSON body. Use `node` with `fetch` to read CDP targets.
- Relaunching the app in a loop consumes the backend's rate limit. After roughly
  fifteen install/relaunch cycles the device started receiving
  "API rate limit exceeded" for session registration and profile sync, and the
  home screen rendered with zero rows — which looks exactly like a regression in
  your own code. Prefer `Page.reload` over relaunching.
