export function shouldProtectContinueWatchingDisplay({
  existingCount = 0,
  nextCount = 0,
  hasLoadedRemoteProgress = false
} = {}) {
  const currentCount = Math.max(0, Number(existingCount) || 0);
  const resolvedCount = Math.max(0, Number(nextCount) || 0);
  return currentCount > 0 && !hasLoadedRemoteProgress && resolvedCount < currentCount;
}
