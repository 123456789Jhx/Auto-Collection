var REMOTE_WAKE_TARGET_PACKAGE = "com.agri.video.collector";

function createRemoteWakeLauncher(options) {
  options = options || {};
  var pollIntervalMs = Math.max(20, Number(options.pollIntervalMs || 100));
  var wait = options.wait || function (milliseconds) {
    if (typeof sleep === "function") sleep(milliseconds);
  };
  var launchPackage = options.launchPackage || function (packageName) {
    try {
      if (typeof app !== "undefined" && app.launchPackage) return app.launchPackage(packageName) !== false;
    } catch (error) { throw error; }
    return false;
  };
  var getCurrentPackage = options.currentPackage || function () {
    try { return typeof currentPackage === "function" ? String(currentPackage() || "") : ""; } catch (error) { return ""; }
  };
  var findUiSignal = options.findUiSignal || function () {
    var patterns = [/^一键启动$/, /^一键停止$/, /^停止运行$/];
    for (var index = 0; index < patterns.length; index += 1) {
      try { if (textMatches(patterns[index]).findOne(100)) return true; } catch (error) {}
      try { if (descMatches(patterns[index]).findOne(100)) return true; } catch (error2) {}
    }
    return false;
  };

  function waitUntil(predicate, timeoutMs) {
    var attempts = Math.max(1, Math.ceil(Math.max(0, Number(timeoutMs || 0)) / pollIntervalMs) + 1);
    for (var index = 0; index < attempts; index += 1) {
      if (predicate()) return true;
      if (index + 1 < attempts) wait(pollIntervalMs);
    }
    return false;
  }

  function launch(timeoutMs) {
    try {
      if (launchPackage(REMOTE_WAKE_TARGET_PACKAGE) === false) {
        return { success: false, reason: "LAUNCH_PACKAGE_REJECTED" };
      }
    } catch (error) {
      return { success: false, reason: "LAUNCH_PACKAGE_EXCEPTION", message: String(error) };
    }
    return waitUntil(function () { return getCurrentPackage() === REMOTE_WAKE_TARGET_PACKAGE; }, timeoutMs)
      ? { success: true, packageName: REMOTE_WAKE_TARGET_PACKAGE }
      : { success: false, reason: "TARGET_PACKAGE_NOT_FOREGROUND" };
  }

  function waitForUiReady(timeoutMs) {
    var ready = waitUntil(function () {
      return getCurrentPackage() === REMOTE_WAKE_TARGET_PACKAGE && findUiSignal();
    }, timeoutMs);
    return ready
      ? { success: true, packageName: REMOTE_WAKE_TARGET_PACKAGE }
      : { success: false, reason: "LIAOYUAN_UI_NOT_READY" };
  }

  return { launch: launch, waitForUiReady: waitForUiReady };
}

module.exports = {
  REMOTE_WAKE_TARGET_PACKAGE: REMOTE_WAKE_TARGET_PACKAGE,
  createRemoteWakeLauncher: createRemoteWakeLauncher
};
