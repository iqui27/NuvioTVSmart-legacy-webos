# [Bug]: An empty cloud pull erases the user's installed addon list

## Where

`js/core/profile/librarySyncService.js`.

## The problem

When the addon pull succeeds but returns zero rows, the result is applied as if
the user had deleted everything: `setAddonOrder([])` plus writes with
`replace: true` wipe `installedAddonUrls`, `installedAddonDisplayNames` and
`installedAddonEnabledStates` for the profile.

A read that returns no rows is indistinguishable from "the table was briefly
unavailable". There is no error, no confirmation prompt, and no way for the user
to tell what happened — their addons are simply gone and have to be re-added by
hand.

Observed on a real device: the profile lost its full addon list after a sync
where the pull came back empty.

## Suggested fix

Decline to apply an empty remote list when addons exist locally: keep the local
list and surface the state so the Addons screen can tell "synced" apart from
"kept what you had because the cloud returned none". A destructive write should
require a positive signal that the user actually deleted them, not the absence of
data.

I have this implemented and can send it as a PR.

## Environment

Platform independent — the logic is in the sync service, not in any adapter.
