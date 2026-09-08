function createPermissionManager(config, logger, deps) {
  deps = deps || {};
  var captureGranted = false;
  var captureRequestInFlight = false;
  var filesApi = deps.files || files;
  var appApi = deps.app || app;
  var sleepFn = deps.sleep || sleep;
  var toastFn = deps.toast || toast;
  var requestScreenCaptureFn = deps.requestScreenCapture || function (landscape) {
    return requestScreenCapture(landscape);
  };
  var accessibility = deps.accessibility || require(filesApi.join(config.runtime.scriptDir, "core/accessibility.js"));

  if (accessibility.setContext) {
    try {
      accessibility.setContext(typeof context !== "undefined" ? context : null);
    } catch (error) {
      accessibility.setContext(null);
    }
  }

  function logAccessibility(level, message, accessibilityState) {
    var payload = {
      enabled: !!(accessibilityState && accessibilityState.enabled),
      source: accessibilityState && accessibilityState.source || "",
      packageName: accessibilityState && accessibilityState.packageName || "",
      enabledServices: accessibilityState && accessibilityState.enabledServices || ""
    };
    if (logger && logger[level]) {
      logger[level](message, payload);
    }
  }

  function isConfiguredButBindingUnavailable(accessibilityState) {
    return !!(
      accessibilityState &&
      accessibilityState.source === "settings" &&
      accessibilityState.enabledServices &&
      !accessibilityState.enabled
    );
  }

  function isAccessibilityStateUnknown(accessibilityState) {
    return !!(
      accessibilityState &&
      (accessibilityState.source === "context_unavailable" || accessibilityState.source === "settings_unavailable")
    );
  }

  function waitForConfiguredAccessibilityBinding(accessibilityState) {
    logAccessibility("warn", "无障碍服务已在系统配置中开启但暂不可用", accessibilityState);
    for (var warmup = 0; warmup < 8; warmup++) {
      sleepFn(500);
      accessibilityState = accessibility.detectAccessibility();
      if (accessibilityState.enabled) {
        logAccessibility("info", "无障碍服务预热后可用", accessibilityState);
        return true;
      }
    }
    logAccessibility("error", "无障碍服务系统配置已开启但 AutoJS 绑定暂不可用", accessibilityState);
    return false;
  }

  function waitForKnownAccessibilityState(accessibilityState) {
    logAccessibility("warn", "无障碍服务状态无法确认，暂不打开设置页", accessibilityState);
    for (var warmup = 0; warmup < 8; warmup++) {
      sleepFn(500);
      accessibilityState = accessibility.detectAccessibility();
      if (accessibilityState.enabled) {
        logAccessibility("info", "无障碍服务状态恢复可确认", accessibilityState);
        return true;
      }
      if (!isAccessibilityStateUnknown(accessibilityState)) {
        if (isConfiguredButBindingUnavailable(accessibilityState)) {
          return waitForConfiguredAccessibilityBinding(accessibilityState);
        }
        logAccessibility("error", "无障碍服务状态恢复后仍未开启", accessibilityState);
        return false;
      }
    }
    logAccessibility("error", "无障碍服务状态持续无法确认", accessibilityState);
    return false;
  }

  function waitForAccessibility() {
    var accessibilityState = accessibility.detectAccessibility();
    logAccessibility("info", "无障碍服务检测结果", accessibilityState);
    if (accessibilityState.enabled) {
      return true;
    }

    if (isConfiguredButBindingUnavailable(accessibilityState)) {
      return waitForConfiguredAccessibilityBinding(accessibilityState);
    }

    if (isAccessibilityStateUnknown(accessibilityState)) {
      return waitForKnownAccessibilityState(accessibilityState);
    }

    logAccessibility("warn", "无障碍服务未开启，打开设置页", accessibilityState);
    toastFn("请开启无障碍服务后返回脚本");
    appApi.startActivity({
      action: "android.settings.ACCESSIBILITY_SETTINGS"
    });

    for (var i = 0; i < 60; i++) {
      sleepFn(1000);
      accessibilityState = accessibility.detectAccessibility();
      if (accessibilityState.enabled) {
        logAccessibility("info", "无障碍服务已开启", accessibilityState);
        return true;
      }
    }

    logAccessibility("error", "等待无障碍服务超时", accessibilityState);
    return false;
  }

  function ensureCapturePermission() {
    if (captureGranted) {
      return true;
    }
    if (captureRequestInFlight) {
      if (logger && logger.warn) {
        logger.warn("截图权限请求进行中，拒绝重复请求");
      }
      return false;
    }
    captureRequestInFlight = true;
    logger.info("请求截图权限");
    try {
      var granted = requestScreenCaptureFn(false);
      if (!granted) {
        logger.error("截图权限请求失败");
        toastFn("截图权限失败，任务停止");
        return false;
      }
      captureGranted = true;
      logger.info("截图权限已获得");
      return true;
    } finally {
      captureRequestInFlight = false;
    }
  }

  function ensureOutputDirs() {
    var dirs = [
      config.output.baseDir,
      config.output.cacheDir
    ];
    if (config.task.saveScreenshots) {
      dirs.push(config.output.screenshotDir);
    }
    if (config.output.writeLogFile) {
      dirs.push(config.output.logDir);
    }
    dirs.forEach(function (dirPath) {
      if (!filesApi.exists(dirPath)) {
        filesApi.createWithDirs(dirPath + "/.keep");
        filesApi.remove(dirPath + "/.keep");
      }
    });
    return true;
  }

  function ensureAll() {
    ensureOutputDirs();
    if (!waitForAccessibility()) {
      return false;
    }
    return true;
  }

  return {
    ensureAll: ensureAll,
    ensureCapturePermission: ensureCapturePermission
  };
}

module.exports = {
  createPermissionManager: createPermissionManager
};
