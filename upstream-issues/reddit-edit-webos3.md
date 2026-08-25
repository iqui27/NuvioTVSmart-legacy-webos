# EDIT para o post que já está no ar (substitui a linha "Edit: Only tested effectively on WebOS 4")

---

**EDIT — scope correction, install instructions, and a webOS 3 preview looking for testers**

**First, a correction to the title.** I wrote "webOS 3.x/4.x (C9, C8, B7 and older)"
and that was wrong: **B7 is a 2017 set running webOS 3.5**, which was never in
range. The build's floor is webOS 4.0 / Chromium 53, and the boot guard blocks
anything older on purpose. So the accurate list is **webOS 4.x — the 2018 and 2019
sets (C9, C8, B9, B8)**. Sorry to anyone with a 2017 TV who got their hopes up.

**How to install it** — a few people asked, and the README only had command-line
instructions. There is now a step-by-step here:
https://github.com/iqui27/NuvioTVSmart-legacy-webos/blob/legacy-tv/INSTALL.md

Short version, no command line needed: turn on **Developer Mode** from the LG
Content Store, install **webOS Dev Manager**
(https://github.com/webosbrew/dev-manager-desktop — a graphical tool from the
webosbrew project), add your TV (port `9922`, user `prisoner`, plus the
six-character passphrase the Dev Mode app shows), then use _Install_ on the Apps
page to pick the `.ipk`.

The thing that trips everyone up: **the Developer Mode session expires**, and when
it does, sideloaded apps stop launching until you extend it from the Dev Mode app
on the TV. That is LG's restriction, not something this build does — but it is the
most common reason a sideloaded app looks broken.

**Homebrew Channel:** asked about, and the answer is no. It installs from a
repository manifest with a checksum per release, which is ongoing maintenance, and
nobody here has a rooted TV to test the flow. A documented path nobody has ever
walked is worse than no path.

---

**Now the part I could use help with: there is a webOS 3.x preview.**

Someone with a 2016 set offered to test, which pushed me to actually try, and the
result was more interesting than expected. Lowering the floor is not enough,
because **esbuild refuses to target Chromium 38** — it stops the build outright,
since it does not do full block-scope lowering. The way through is two stages:
bundle at the lowest target esbuild accepts, then run the output through Babel down
to 38. Same trick the app's TV background service already uses to reach Node 0.12.

Then came the parts that only show up when you actually run it:

- The first attempt could not boot. A Babel pass lowers **syntax**, not
  **polyfills** — a distinction I glossed over. It died on `Object.assign`, which is
  Chrome 45.
- `fetch` is Chrome 42 and does not exist there. core-js does not provide it — it
  covers ECMAScript, not networking.
- The big one: **~1,577 CSS custom properties**. They are Chrome 49, and Chromium 38
  does not degrade gracefully — it discards the _entire declaration_ containing one.
  Even with the JavaScript fixed, what booted would have had essentially no styling.
  These are now resolved to concrete values at build time, and the 12 themes are
  compiled into separate stylesheets.
- And the one I would never have found without installing it on a real TV: the
  polyfill bundle **threw during load and aborted itself halfway**, so some
  polyfills existed and others silently did not. The exact same file, injected after
  boot, worked perfectly — which sent me down the wrong path three times.

**What I need:** someone with a webOS 3.x LG willing to install a build that has
**never run on webOS 3 hardware**, because nobody involved owns one. It might not
boot. It might boot and be too slow — the bundle is 31% larger, since lowering
block scope costs closures, and that parse cost on 2016 silicon is an open question.

Any of those outcomes is useful information. The preview is the pre-release marked
`webos3` on the releases page, and it says on the tin that it is untested.

For anyone who wants the reproducible part rather than the app: the build is
verified statically against the caniuse database — `eslint-plugin-compat` for
browser APIs and `doiuse` for CSS features, both wired as release gates where every
unsupported item has to carry a written justification. The LG emulator is an x86
VirtualBox image and the Chromium 38 macOS binary is from 2014, so neither runs on
current hardware; static checking is what is left. Measured limitation worth
knowing: `doiuse` does not detect `aspect-ratio`.
