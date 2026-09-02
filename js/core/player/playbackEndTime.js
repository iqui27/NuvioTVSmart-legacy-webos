export function calculateRemainingPlaybackMilliseconds(
  currentSeconds = 0,
  durationSeconds = 0,
  playbackSpeed = 1
) {
  const current = Number(currentSeconds || 0);
  const duration = Number(durationSeconds || 0);
  if (!Number.isFinite(duration) || duration <= 0) {
    return null;
  }

  const safeCurrent = Number.isFinite(current) ? Math.max(0, current) : 0;
  const requestedSpeed = Number(playbackSpeed || 1);
  const effectiveSpeed = Number.isFinite(requestedSpeed) && requestedSpeed > 0 ? requestedSpeed : 1;
  const remainingMediaMs = Math.max(0, (duration - safeCurrent) * 1000);

  // Keep the same ceiling behavior as Android TV's PlayerClockOverlay.
  return Math.ceil(remainingMediaMs / effectiveSpeed);
}
