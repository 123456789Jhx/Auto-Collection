function createPermissionManager(config, logger) {
  var captureGranted = false;
  var accessibility = require(files.join(config.runtime.scriptDir, "core/accessibility.js"));
  if (accessibility.setContext) {
    accessibility.setContext(context);
  }

  function waitForAccessibility() {
    var accessibilityState = accessibility.detectAccessibility();
    if (accessibilityState.enabled) {
      return true;
    }

    logger.warn("无障碍服务未开启，跳转设置页");
    toast("请开启无障碍服务后返回脚本");
    app.startActivity({
      action: "android.settings.ACCESSIBILITY_SETTINGS"
    });

    for (var i = 0; i < 60; i++) {
      sleep(1000);
      accessibilityState = accessibility.detectAccessibility();
      if (accessibilityState.enabled) {
        logger.info("无障碍服务已开启");
        return true;
      }
    }

    logger.error("等待无障碍服务超时");
    return false;
  }

  function ensureCapturePermission() {
    if (captureGranted) {
      return true;
    }
    logger.info("请求截图权限");
    var granted = requestScreenCapture(false);
    if (!granted) {
      logger.error("截图权限请求失败");
      toast("截图权限失败，任务停止");
      return false;
    }
    captureGranted = true;
    logger.info("截图权限已获得");
    return true;
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
      if (!files.exists(dirPath)) {
        files.createWithDirs(dirPath + "/.keep");
        files.remove(dirPath + "/.keep");
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
