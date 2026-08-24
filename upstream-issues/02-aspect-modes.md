# [Bug]: Six of the seven video aspect modes are identical — Crop and Zoom do nothing

## Where
`js/core/player/playerAspect.js` on `main`.

## The problem
Seven aspect modes are exposed to the user, but their `objectFit` values are:

| mode | objectFit |
|---|---|
| ORIGINAL | `contain` |
| FULL_SCREEN | `contain` |
| SLIGHT_ZOOM | `contain` |
| CINEMA_ZOOM | `contain` |
| VERTICAL_STRETCH | `contain` |
| HORIZONTAL_STRETCH | `contain` |
| STRETCH | `fill` |

So six of the seven produce exactly the same picture. Picking "Full screen",
"Slight zoom" or "Cinema zoom" changes nothing on screen — in particular none of
them removes letterboxing, which is the reason a user reaches for those modes.

## Suggested fix
The zoom/fill family needs `cover` so the image fills the frame and the excess is
cropped:

- FULL_SCREEN, SLIGHT_ZOOM, CINEMA_ZOOM, VERTICAL_STRETCH → `cover`
- ORIGINAL, HORIZONTAL_STRETCH → `contain`
- STRETCH → `fill`

(`cover` alone does not differentiate *slight* from *cinema* zoom — those need a
scale factor on top. But `cover` at least makes the modes do something, which is
the actual bug.)

I can send this as a PR if you want it.

## Environment
LG OLED65C9, webOS 4.10. The mapping is platform independent.
