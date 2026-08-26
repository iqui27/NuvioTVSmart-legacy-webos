# [Bug]: Audio menu shows "Audio 1", "Audio 2" instead of the track language

## Where

`js/ui/screens/player/playerScreen.js` — the audio track handling spreads the
track objects (`{ ...track }`, several call sites).

## The problem

`video.audioTracks[i]` is a native `AudioTrack`. Its `language`, `label`, `id`
and `enabled` are **prototype getters**, not own enumerable properties, so
object spread copies none of them: the result is an empty object.

Downstream the language is therefore always empty and the menu falls back to a
positional label, so a movie with English/Latin Spanish/Portuguese tracks shows
"Audio 1", "Audio 2", "Audio 3" and the user has to guess.

## Suggested fix

Read the getters explicitly into a plain object before passing the track around:

```js
function toPlainAudioTrackShape(track) {
  return {
    id: track.id,
    kind: track.kind,
    label: track.label,
    language: track.language,
    enabled: track.enabled
  };
}
```

I have this implemented (plus a guard so `und` and other placeholder language
values do not become a user facing label) and can send it as a PR.

## Environment

Found on LG webOS 4.10, but prototype getters on `AudioTrack` are per spec — the
spread copies nothing on any browser.
