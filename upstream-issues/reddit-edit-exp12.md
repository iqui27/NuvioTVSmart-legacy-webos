# EDIT para acrescentar ao post que já está no ar

Cole no fim do post. Sem link no corpo (o antispam do sub pune link em post de
conta sem histórico) — o link da release vai num comentário seu, se alguém pedir.

---

**EDIT — webOS 3 now boots, plays, and can finally tell you why it failed**

Two testers on old sets have been reporting back, and the preview is at the point
where it does real work. Playback, the back button, the settings focus and the
blank continue-watching thumbnails are all fixed. One of them confirmed the
settings fix on an actual webOS 3 set; the rest I could only verify on webOS 4.

The interesting one is a bug in profile handling that I would not have found
alone. A tester made a second profile, installed exactly two addons in it, and saw
four — the two he installed plus two from his other profile. The cause was a
one-line convenience: a profile with no addon list of its own was seeded with a
copy of profile 1's list. That is invisible for anyone with a single profile and
wrong for everyone else. New profiles now start empty, like the Android app does.
Profiles already mixed up stay mixed up, since the copy was written to storage.

The other thing that came out of this is worth more than the fix itself. He hit a
playback error reading "failed before any bytes arrived", and I could not tell him
what it meant, because that message covers two completely different failures that
need opposite fixes: the TV refused the codec, or the connection never opened at
all. On a 2017 set the second one is very plausible — these root certificate
stores predate the Let's Encrypt chain change, and when that fails it fails
silently, with zero bytes, looking exactly like a codec problem.

So instead of guessing, the error screen now diagnoses itself. It prints what the
TV's engine actually accepts (h264, hevc, av1, mkv, hls), whether it accepts the
failing source's type, and then it retries the same URL asking for a single byte.
An HTTP status back means the network and the certificate are fine and the codec
is the suspect. Status 0 means the connection died and the codec is innocent.

I verified the probe tells those two cases apart — a live host answers 206 to the
byte request, a nonexistent one answers 0 — and I verified the build boots, plays
and has working audio. But I verified all of that on a **webOS 4** set, because
that is the only hardware I own. Whether any of it holds on Chromium 38 is exactly
what the preview exists to find out.

If you have an old LG and hit a playback error, a photo of those three lines is
more useful to me than any description of the symptom.
