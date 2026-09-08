const repeatStateByOwner = new WeakMap();

function directionForKeyCode(keyCode) {
  if (keyCode === 37) return "left";
  if (keyCode === 39) return "right";
  if (keyCode === 38) return "up";
  if (keyCode === 40) return "down";
  return "";
}

/**
 * Keep Smart-TV repeat navigation at the same cadence as Android TV.
 * The first key-down is never delayed; only native repeat key-down events
 * are gated, so focus ordering and edge behavior remain screen-owned.
 */
export function allowDpadRepeat(owner, event, { horizontalMs = 80, verticalMs = 112 } = {}) {
  if (!owner || !event?.repeat) {
    return true;
  }

  const direction = directionForKeyCode(Number(event.keyCode || 0));
  if (!direction) {
    return true;
  }

  const throttleMs = direction === "left" || direction === "right" ? horizontalMs : verticalMs;
  if (!Number.isFinite(throttleMs) || throttleMs <= 0) {
    return true;
  }

  const now = Date.now();
  const previous = Number(repeatStateByOwner.get(owner) || 0);
  if (previous > 0 && now - previous < throttleMs) {
    event.preventDefault?.();
    return false;
  }

  repeatStateByOwner.set(owner, now);
  return true;
}

export function resetDpadRepeat(owner) {
  if (owner) {
    repeatStateByOwner.delete(owner);
  }
}
