var createXiaomi14RecentsCleanup = require("./xiaomi14-recents-cleanup").createXiaomi14RecentsCleanup;

function createDouyinPostPublishCleanup(options) {
  options = options || {};
  var logger = options.logger || { info: function () {}, warn: function () {} };
  var deviceProfile = options.deviceProfile || (options.context && options.context.deviceProfile) || null;
  var accessibility = options.accessibility || (options.context && options.context.accessibility) || null;
  var randomInt = options.randomInt || function (min, max) {
    return Math.floor(min + Math.random() * (max - min + 1));
  };
  var wait = options.wait || function (milliseconds) {
    if (typeof sleep === "function") sleep(milliseconds);
  };
  var openRecents = options.openRecents || function () {
    if (typeof recents !== "function") return false;
    recents();
    return true;
  };
  var douyinPackageName = String(options.douyinPackageName || "com.ss.android.ugc.aweme");
  var getCurrentPackage = options.getCurrentPackage || function () {
    try { return typeof currentPackage === "function" ? String(currentPackage() || "") : ""; } catch (error) { return ""; }
  };
  var findDouyinCard = options.findDouyinCard || function (timeoutMs) {
    var selectors = [];
    try { selectors.push(textMatches(".*抖音.*")); } catch (error) {}
    try { selectors.push(descMatches(".*抖音.*")); } catch (error) {}
    var startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      for (var index = 0; index < selectors.length; index += 1) {
        try {
          var node = selectors[index].findOne(200);
          if (node) return node;
        } catch (findError) {}
      }
    }
    return null;
  };
  var findAgentCard = options.findAgentCard || function (timeoutMs) {
    var selectors = [];
    try { selectors.push(descMatches(/.*燎原星火.*/)); } catch (error) {}
    try { selectors.push(textMatches(/^燎原星火$/)); } catch (error2) {}
    var startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      for (var index = 0; index < selectors.length; index += 1) {
        try {
          var node = selectors[index].findOne(200);
          if (node) return node;
        } catch (findError) {}
      }
    }
    return null;
  };
  var isPublishing = options.isPublishing || function () {
    try { if (textMatches(/.*(发布进度|正在发布|上传中).*/).findOne(200)) return true; } catch (error) {}
    try { if (descMatches(/.*(发布进度|正在发布|上传中).*/).findOne(200)) return true; } catch (error2) {}
    return false;
  };
  function isXiaomi14() {
    return String(deviceProfile && deviceProfile.key || "") === "xiaomi_14";
  }

  var dismissCard = options.dismissCard || function (card) {
    if (typeof device === "undefined") return false;
    var width = Number(device.width || 0);
    var height = Number(device.height || 0);
    if (width <= 0 || height <= 0) return false;
    var target = card;
    var bounds = null;
    for (var level = 0; level < 6 && target; level += 1) {
      try {
        var candidate = target.bounds && target.bounds();
        if (candidate && candidate.width() >= width * 0.35 && candidate.height() >= height * 0.12) {
          bounds = candidate;
          break;
        }
      } catch (boundsError) {}
      try { target = target.parent && target.parent(); } catch (parentError) { target = null; }
    }
    if (!bounds) return false;
    if (typeof swipe !== "function") return false;
    swipe(Math.floor(bounds.left + bounds.width() * 0.8), bounds.centerY(), Math.floor(bounds.left + bounds.width() * 0.1), bounds.centerY(), 420);
    return true;
  };
  var openAgentCard = options.openAgentCard || function (card) {
    var target = card;
    for (var level = 0; level < 6 && target; level += 1) {
      try {
        if (target.clickable && target.clickable() && target.click()) return true;
      } catch (clickError) {}
      try { target = target.parent && target.parent(); } catch (parentError) { target = null; }
    }
    return false;
  };
  var goHome = options.goHome || function () {
    if (typeof home !== "function") return false;
    home();
    return true;
  };
  var findAgentHomeIcon = options.findAgentHomeIcon || function (timeoutMs) {
    var selectors = [];
    try { selectors.push(textMatches(/^燎原星火$/)); } catch (error) {}
    try { selectors.push(descMatches(/.*燎原星火.*/)); } catch (error2) {}
    var startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      for (var index = 0; index < selectors.length; index += 1) {
        try {
          var node = selectors[index].findOne(200);
          if (node) return node;
        } catch (findError) {}
      }
    }
    return null;
  };
  var openAgentHomeIcon = options.openAgentHomeIcon || function (icon) {
    var target = icon;
    for (var level = 0; level < 6 && target; level += 1) {
      try {
        if (target.clickable && target.clickable() && target.click()) return true;
      } catch (clickError) {}
      try { target = target.parent && target.parent(); } catch (parentError) { target = null; }
    }
    return false;
  };
  var openAgentByPackage = options.openAgentByPackage || function () {
    try {
      if (typeof app !== "undefined" && app && typeof app.launchPackage === "function") {
        return app.launchPackage("com.agri.video.collector") !== false;
      }
      if (typeof app !== "undefined" && app && typeof app.launch === "function") {
        return app.launch("燎原星火") !== false;
      }
    } catch (error) {}
    return false;
  };

  function isDouyinForeground() {
    return getCurrentPackage() === douyinPackageName;
  }

  function isMiuiRecentsVisible() {
    return getCurrentPackage() === "com.miui.home";
  }

  function findCenteredMiuiTaskCard() {
    if (typeof id !== "function" || typeof device === "undefined") return null;
    var width = Number(device.width || 0);
    var height = Number(device.height || 0);
    if (width <= 0 || height <= 0) return null;
    var thumbnails = [];
    try { thumbnails = id("com.miui.home:id/task_view_thumbnail").find() || []; } catch (error) { return null; }
    var selected = null;
    var selectedDistance = Infinity;
    for (var index = 0; index < thumbnails.length; index += 1) {
      var target = thumbnails[index];
      for (var level = 0; level < 4 && target; level += 1) {
        try {
          var bounds = target.bounds && target.bounds();
          if (bounds && bounds.width() >= width * 0.35 && bounds.height() >= height * 0.12) {
            var distance = Math.abs(bounds.centerX() - width / 2);
            if (distance < selectedDistance) {
              selected = target;
              selectedDistance = distance;
            }
            break;
          }
        } catch (boundsError) {}
        try { target = target.parent && target.parent(); } catch (parentError) { target = null; }
      }
    }
    return selected;
  }

  function miuiTaskCardCount() {
    if (typeof id !== "function") return 0;
    try {
      var thumbnails = id("com.miui.home:id/task_view_thumbnail").find() || [];
      return Number(thumbnails.length || 0);
    } catch (error) {
      return 0;
    }
  }
  var cooldownMs = Math.max(0, Number(options.cooldownMs == null ? 30000 : options.cooldownMs));
  var recentsReadyWaitMs = Math.max(0, Number(options.recentsReadyWaitMs == null ? 1200 : options.recentsReadyWaitMs));
  var findCardTimeoutMs = Math.max(0, Number(options.findCardTimeoutMs == null ? 3000 : options.findCardTimeoutMs));
  var agentCardReadyWaitMs = Math.max(0, Number(options.agentCardReadyWaitMs == null ? 1000 : options.agentCardReadyWaitMs));
  var findAgentCardTimeoutMs = Math.max(0, Number(options.findAgentCardTimeoutMs == null ? 3000 : options.findAgentCardTimeoutMs));
  var homeReadyWaitMs = Math.max(0, Number(options.homeReadyWaitMs == null ? 1000 : options.homeReadyWaitMs));
  var findAgentHomeIconTimeoutMs = Math.max(0, Number(options.findAgentHomeIconTimeoutMs == null ? 3000 : options.findAgentHomeIconTimeoutMs));
  function fallbackToHome(taskId, reason) {
    var returnedHome = false;
    try { returnedHome = goHome() !== false; } catch (error) {}
    if (returnedHome) {
      wait(homeReadyWaitMs);
      var homeIcon = findAgentHomeIcon(findAgentHomeIconTimeoutMs);
      if (homeIcon && openAgentHomeIcon(homeIcon) !== false) {
        logger.info("已从系统主页打开燎原星火", { taskId: taskId, reason: reason });
        return { completed: true, fallback: "HOME_ICON", reason: reason };
      }
      logger.warn("未能从最近任务返回燎原星火，尝试通过包名启动", { taskId: taskId, reason: reason });
    }
    if (openAgentByPackage() !== false) {
      wait(homeReadyWaitMs);
      logger.info("已通过包名启动燎原星火", { taskId: taskId, reason: reason });
      return { completed: true, fallback: "PACKAGE", reason: reason };
    }
    if (returnedHome) {
      logger.warn("未能从最近任务返回燎原星火，已回到系统主页但未找到应用图标", { taskId: taskId, reason: reason });
      return { completed: true, fallback: "HOME", reason: reason };
    }
    logger.warn("未能从最近任务返回燎原星火，且系统主页与包名回退均失败", { taskId: taskId, reason: reason });
    return { completed: false, reason: "HOME_FALLBACK_FAILED", cause: reason };
  }

  function run(payload, lifecycle) {
    var taskId = String(payload && payload.taskId || "");
    logger.info("抖音发布成功后收尾开始", { taskId: taskId, cooldownMs: cooldownMs });
    wait(cooldownMs);
    if (isPublishing()) {
      logger.warn("抖音仍显示发布进度，跳过后台清理", { taskId: taskId });
      return { completed: false, reason: "PUBLISH_STILL_IN_PROGRESS" };
    }
    if (isXiaomi14()) {
      return createXiaomi14RecentsCleanup({
        logger: logger, wait: wait, randomInt: randomInt,
        accessibility: accessibility, getCurrentPackage: getCurrentPackage
      }).run(payload);
    }
    // Only the just-backgrounded foreground app can use the unlabeled-card fallback.
    var douyinWasForeground = isDouyinForeground();
    var recentsOpened = openRecents();
    if (recentsOpened === false) {
      logger.warn("抖音发布成功后无法打开最近任务，继续返回燎原星火", { taskId: taskId });
      return fallbackToHome(taskId, "RECENTS_UNAVAILABLE");
    }
    wait(recentsReadyWaitMs);
    var douyinCard = findDouyinCard(findCardTimeoutMs);
    if (!douyinCard && douyinWasForeground && isMiuiRecentsVisible()) {
      douyinCard = findCenteredMiuiTaskCard();
      if (douyinCard) {
        logger.info("抖音任务标题未暴露，已按前台任务定位居中卡片", { taskId: taskId });
      }
    }
    var cleanupReason = "";
    if (!douyinCard) {
      cleanupReason = "DOUYIN_RECENTS_CARD_NOT_FOUND";
      logger.warn("抖音最近任务识别失败", {
        taskId: taskId,
        douyinWasForeground: douyinWasForeground,
        currentPackage: getCurrentPackage(),
        miuiTaskCardCount: miuiTaskCardCount()
      });
      logger.warn("抖音发布成功后未识别到抖音任务卡片，继续返回燎原星火", { taskId: taskId });
    } else if (dismissCard(douyinCard) === false) {
      cleanupReason = "DOUYIN_RECENTS_DISMISS_FAILED";
      logger.warn("抖音发布成功后未能滑出任务卡片，继续返回燎原星火", { taskId: taskId });
    } else {
      logger.info("抖音发布成功后后台清理完成", { taskId: taskId });
    }
    if (lifecycle && lifecycle.beforeReturnToAgent) lifecycle.beforeReturnToAgent();
    wait(agentCardReadyWaitMs);
    var agentCard = findAgentCard(findAgentCardTimeoutMs);
    if (!agentCard) return fallbackToHome(taskId, cleanupReason || "AGENT_RECENTS_CARD_NOT_FOUND");
    if (openAgentCard(agentCard) === false) return fallbackToHome(taskId, cleanupReason || "AGENT_RECENTS_OPEN_FAILED");
    logger.info("已从最近任务返回燎原星火", { taskId: taskId });
    return cleanupReason ? { completed: true, cleanupReason: cleanupReason } : { completed: true };
  }

  return { run: run };
}

module.exports = {
  createDouyinPostPublishCleanup: createDouyinPostPublishCleanup
};
