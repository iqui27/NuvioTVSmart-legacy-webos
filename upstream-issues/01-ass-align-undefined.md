# [Bug]: `--ass-align-h` / `--ass-align-v` are referenced but never defined

## Where

`css/components.css` — the ASS subtitle positioning block uses:

```css
transform: translate(calc(var(--ass-align-h) * -1), calc(var(--ass-align-v) * -1));
```

## The problem

Neither custom property is defined anywhere — not in the stylesheet, not in any
other CSS file, and nothing assigns them via `style.setProperty` at runtime.
Verified on `main`: `--ass-align-h` appears exactly once (this reference) and
zero times as a declaration.

`var()` with no value and no fallback makes the whole `transform` declaration
invalid at computed-value time, so the translate never applies. This is not
platform specific — it fails on every engine, modern ones included.

## Why I am not sending a patch

Two readings are possible and only the author knows which is right:

1. Dead code from an earlier positioning approach — the fix is deleting the
   declaration.
2. A renderer that was supposed to set these properties per subtitle line and
   does not — the fix is assigning them, and deleting the declaration would
   silently drop a feature.

Happy to send a PR once you say which.

## Environment

Found while running 0.3.42 on LG webOS 4.10 (Chromium 53), but confirmed by
inspection to be engine independent.
