function createRemoteWakeScreen(options) {
  options = options || {};
  var pollIntervalMs = Math.max(20, Number(options.pollIntervalMs || 100));
  var wait = options.wait || function (milliseconds) {
    if (typeof sleep === "function") sleep(milliseconds);
  };
  var isScreenOn = options.isScreenOn || function () {
    try { return typeof device !== "undefined" && device.isScreenOn ? !!device.isScreenOn() : false; } catch (error) { return false; }
  };
  var isKeyguardLocked = options.isKeyguardLocked || function () {
    try {
      if (typeof context === "undefined" || !context.getSystemService) return false;
      var serviceName = typeof android !== "undefined" && android.content && android.content.Context
        ? android.content.Context.KEYGUARD_SERVICE
        : "keyguard";
      var manager = context.getSystemService(serviceName);
      return manager && manager.isKeyguardLocked ? !!manager.isKeyguardLocked() : false;
    } catch (error) { return false; }
  };
  var wakeUp = options.wakeUp || function () {
    if (typeof device === "undefined") return false;
    if (device.wakeUpIfNeeded) { device.wakeUpIfNeeded(); return true; }
    if (device.wakeUp) { device.wakeUp(); return true; }
    return false;
  };
  var swipeUp = options.swipe || function (x1, y1, x2, y2, durationMs) {
    if (typeof swipe !== "function") return false;
    swipe(x1, y1, x2, y2, durationMs);
    return true;
  };

  function dimensions() {
    return {
      width: Number(options.width || (typeof device !== "undefined" && device.width) || 1080),
      height: Number(options.height || (typeof device !== "undefined" && device.height) || 1920)
    };
  }

  function waitUntil(predicate, timeoutMs) {
    var attempts = Math.max(1, Math.ceil(Math.max(0, Number(timeoutMs || 0)) / pollIntervalMs) + 1);
    for (var index = 0; index < attempts; index += 1) {
      if (predicate()) return true;
      if (index + 1 < attempts) wait(pollIntervalMs);
    }
    return false;
  }

  function readState() {
    return { screenOn: isScreenOn(), keyguardLocked: isKeyguardLocked() };
  }

  function wake(timeoutMs) {
    if (isScreenOn()) return { success: true, changed: false };
    try {
      if (wakeUp() === false) return { success: false, reason: "WAKE_API_UNAVAILABLE" };
    } catch (error) {
      return { success: false, reason: "WAKE_API_FAILED", message: String(error) };
    }
    return waitUntil(isScreenOn, timeoutMs) ? { success: true, changed: true } : { success: false, reason: "SCREEN_STAYED_OFF" };
  }

  function dismissKeyguard(timeoutMs) {
    if (!isKeyguardLocked()) return { success: true, changed: false };
    var size = dimensions();
    try {
      if (swipeUp(
        Math.floor(size.width * 0.5),
        Math.floor(size.height * 0.78),
        Math.floor(size.width * 0.5),
        Math.floor(size.height * 0.22),
        420
      ) === false) return { success: false, reason: "UNLOCK_GESTURE_UNAVAILABLE" };
    } catch (error) {
      return { success: false, reason: "UNLOCK_GESTURE_FAILED", message: String(error) };
    }
    return waitUntil(function () { return !isKeyguardLocked(); }, timeoutMs)
      ? { success: true, changed: true }
      : { success: false, reason: "KEYGUARD_STILL_LOCKED" };
  }

  return { readState: readState, wake: wake, dismissKeyguard: dismissKeyguard };
}

module.exports = { createRemoteWakeScreen: createRemoteWakeScreen };
