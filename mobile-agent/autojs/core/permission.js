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

  // 截图授权流程由设备画像控制，取值见 device-profiles.js：
  //   bringSelfToForeground —— MIUI/HyperOS 会拦截「后台弹出界面」，后台发起的
  //                            授权弹窗能显示但点不动，需要先切前台再申请。
  //   useWorkerThread       —— requestScreenCapture 会阻塞到用户处理弹窗为止，
  //                            主线程同步调用会冻结事件分发导致弹窗点不动。
  // 这里的默认值与画像默认值一致，画像缺失时行为不变。
  var DEFAULT_CAPTURE_POLICY = {
    bringSelfToForeground: true,
    foregroundWaitMs: 800,
    useWorkerThread: true,
    timeoutMs: 120000
  };

  function resolveCapturePolicy() {
    var profile = deps.deviceProfile ||
      (config && config.deviceProfile && config.deviceProfile.resolved) || null;
    var values = (profile && profile.values && profile.values.capture) || {};
    var policy = {};
    Object.keys(DEFAULT_CAPTURE_POLICY).forEach(function (key) {
      policy[key] = DEFAULT_CAPTURE_POLICY[key];
    });
    policy.profileKey = profile ? String(profile.key || "") : "";
    if (typeof values.bringSelfToForeground === "boolean") {
      policy.bringSelfToForeground = values.bringSelfToForeground;
    }
    if (typeof values.useWorkerThread === "boolean") {
      policy.useWorkerThread = values.useWorkerThread;
    }
    var waitMs = Number(values.foregroundWaitMs);
    if (isFinite(waitMs) && waitMs >= 0) {
      policy.foregroundWaitMs = waitMs;
    }
    var timeoutMs = Number(values.timeoutMs);
    if (isFinite(timeoutMs) && timeoutMs > 0) {
      policy.timeoutMs = timeoutMs;
    }
    return policy;
  }

  // 从后台 Service 发起的授权弹窗在 MIUI 上不可交互，申请前先把自身 App 拉回前台，
  // 让系统弹窗由前台 Activity 发起。是否启用由画像决定。
  function bringSelfToForeground(policy) {
    if (!policy.bringSelfToForeground) {
      return false;
    }
    var packageName = deps.packageName ||
      (config.app && config.app.packageName) ||
      "com.agri.video.collector";
    try {
      if (appApi && typeof appApi.launchPackage === "function") {
        appApi.launchPackage(packageName);
      } else if (appApi && typeof appApi.launch === "function") {
        appApi.launch(packageName);
      } else {
        return false;
      }
    } catch (error) {
      logger.warn("截图权限申请前拉起自身前台失败", { message: String(error) });
      return false;
    }
    if (policy.foregroundWaitMs > 0) {
      sleepFn(policy.foregroundWaitMs);
    }
    logger.info("已拉起自身前台后再申请截图权限", { packageName: packageName });
    return true;
  }

  // requestScreenCapture 会一直阻塞到用户处理系统授权弹窗为止。在主线程调用
  // 会冻结事件分发，弹窗上的「立即开始」点了没反应，因此在子线程发起，
  // 主线程只轮询等待，让系统弹窗能正常接收点击。
  function requestCapturePermissionWithoutBlockingUi(policy) {
    if (!policy.useWorkerThread) {
      return requestScreenCaptureFn(false);
    }
    var threadsApi = deps.threads || (typeof threads !== "undefined" ? threads : null);
    if (!threadsApi || typeof threadsApi.start !== "function") {
      return requestScreenCaptureFn(false);
    }
    var pending = { done: false, granted: false, error: "" };
    try {
      threadsApi.start(function () {
        try {
          pending.granted = requestScreenCaptureFn(false);
        } catch (error) {
          pending.error = String(error);
        }
        pending.done = true;
      });
    } catch (error) {
      logger.warn("子线程申请截图权限失败，回退主线程同步申请", { message: String(error) });
      return requestScreenCaptureFn(false);
    }
    logger.info("截图权限弹窗已发起，等待用户在系统弹窗确认");
    var maxPolls = Math.max(1, Math.ceil(policy.timeoutMs / 500));
    for (var waited = 0; waited < maxPolls && !pending.done; waited += 1) {
      sleepFn(500);
    }
    if (!pending.done) {
      logger.error("截图权限请求超时，用户未处理系统授权弹窗");
      return false;
    }
    if (pending.error) {
      logger.error("截图权限请求异常", { message: pending.error });
      return false;
    }
    return pending.granted;
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
    // 每次申请时重新解析，保证服务端下发的画像覆盖能在下一次申请时生效。
    var policy = resolveCapturePolicy();
    logger.info("请求截图权限", { deviceProfile: policy.profileKey || "unknown" });
    try {
      bringSelfToForeground(policy);
      var granted = requestCapturePermissionWithoutBlockingUi(policy);
      if (!granted) {
        logger.error("截图权限请求失败，若系统弹窗点不动请检查悬浮窗遮挡与后台弹出界面权限");
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
      if (!dirPath) {
        console.log("[WARN] ensureOutputDirs 跳过：目录路径为空");
        return;
      }
      try {
        if (filesApi.exists(dirPath)) {
          return;
        }
        // createWithDirs 失败时可能返回 false，也可能抛异常，两者都必须兜住，
        // 否则未捕获异常会中断整个脚本引擎。
        if (filesApi.createWithDirs(dirPath + "/.keep") === false) {
          logger.warn("输出目录创建失败", { dirPath: dirPath });
          return;
        }
        filesApi.remove(dirPath + "/.keep");
      } catch (error) {
        logger.warn("输出目录创建异常", { dirPath: dirPath, message: String(error) });
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
